"use strict";

const cluster = require("cluster");
const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { pipeline } = require("stream/promises");
const { PassThrough } = require("stream");

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 5001;
const isProduction = process.env.NODE_ENV === "production";
const CPU_COUNT = os.availableParallelism
  ? os.availableParallelism()
  : os.cpus().length;
const WORKERS =
  Number(process.env.WORKERS) || (isProduction ? 1 : Math.min(CPU_COUNT, 4));
const MAX_JOBS = Number(process.env.MAX_JOBS) || 2; // concurrent conversions PER worker
const MAX_QUEUE = Number(process.env.MAX_QUEUE) || 20; // waiting jobs PER worker
// Apple recommends square art between 1400 and 3000 px
const COVER_SIZE = Math.min(
  Math.max(Number(process.env.COVER_SIZE) || 1400, 1400),
  3000,
);
// "crop" = centre-crop to square (default), "blur" = full frame on a blurred background (nothing cut off)
const COVER_MODE = process.env.COVER_MODE === "blur" ? "blur" : "crop";
const META_TTL = 10 * 60 * 1000; // metadata cache
const JOB_TTL = 15 * 60 * 1000; // unclaimed job expiry
const PROGRESS_TTL = 30 * 60 * 1000;
const TEMP_DIR = path.join(__dirname, "temp");
const COOKIE_PATH = path.join(__dirname, "youtube-cookies.txt");
const NODE_PATH = process.execPath;

// Resolve binaries: env override -> bundled locations -> system PATH
function resolveBinary(envName, candidates, fallback) {
  if (process.env[envName]) return process.env[envName];
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch {}
  }
  return fallback;
}
let ffmpegStatic = null;
try {
  ffmpegStatic = require("ffmpeg-static"); // optional: npm i ffmpeg-static
} catch {}

const FFMPEG_PATH = resolveBinary(
  "FFMPEG_PATH",
  [path.join(__dirname, "bin", "ffmpeg"), ffmpegStatic],
  "ffmpeg",
);
const YT_DLP_PATH = resolveBinary(
  "YT_DLP_PATH",
  [
    path.join(__dirname, ".venv", "bin", "yt-dlp"),
    path.join(__dirname, "bin", "yt-dlp"),
  ],
  "yt-dlp",
);

// CORS_ORIGINS="*" allows every origin; otherwise a comma-separated list.
const ALLOW_ALL_ORIGINS = process.env.CORS_ORIGINS === "*";
const ALLOWED_ORIGINS = (
  process.env.CORS_ORIGINS ||
  "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,https://youtube-to-audio.netlify.app,https://youtube-to-mp3-rho.vercel.app"
)
  .split(",")
  .map((s) => s.trim().replace(/\/$/, "")) // tolerate a trailing slash
  .filter(Boolean);

// ---------------------------------------------------------------------------
// SHARED STATE STORE (in-memory Map with TTL)
// In cluster mode the primary process owns the Map and workers talk to it
// over IPC, so any worker can serve any request for a given download id.
// ---------------------------------------------------------------------------
class MemStore {
  constructor() {
    this.map = new Map();
  }
  set(key, value, ttl) {
    this.map.set(key, { value, exp: Date.now() + ttl });
  }
  get(key) {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.exp < Date.now()) {
      this.map.delete(key);
      return null;
    }
    return e.value;
  }
  take(key) {
    const v = this.get(key);
    this.map.delete(key);
    return v;
  }
  del(key) {
    this.map.delete(key);
  }
  sweep() {
    const now = Date.now();
    for (const [k, e] of this.map) if (e.exp < now) this.map.delete(k);
  }
}

// ---------------------------------------------------------------------------
// PRIMARY PROCESS (load balancer / supervisor)
// ---------------------------------------------------------------------------
if (cluster.isPrimary && WORKERS > 1) {
  console.log(`Primary ${process.pid} starting ${WORKERS} workers`);

  fs.rmSync(TEMP_DIR, { recursive: true, force: true }); // clear stale files
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  const store = new MemStore();
  setInterval(() => store.sweep(), 30_000).unref();

  const handleMessage = (worker, msg) => {
    if (!msg || msg.type !== "store") return;
    let out = null;
    switch (msg.op) {
      case "set":
        store.set(msg.key, msg.value, msg.ttl);
        break;
      case "get":
        out = store.get(msg.key);
        break;
      case "take":
        out = store.take(msg.key);
        break;
      case "del":
        store.del(msg.key);
        break;
    }
    if (msg.id && worker.isConnected()) {
      worker.send({ type: "store-reply", id: msg.id, value: out });
    }
  };

  const fork = () =>
    cluster.fork().on("message", function (m) {
      handleMessage(this, m);
    });
  for (let i = 0; i < WORKERS; i++) fork();

  cluster.on("exit", (worker, code, signal) => {
    console.error(
      `Worker ${worker.process.pid} died (${signal || code}). Restarting...`,
    );
    setTimeout(fork, 1000);
  });

  const shutdown = () => {
    for (const id in cluster.workers)
      cluster.workers[id].process.kill("SIGTERM");
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
} else {
  startWorker();
}

// ---------------------------------------------------------------------------
// WORKER / SINGLE-PROCESS SERVER
// ---------------------------------------------------------------------------
function startWorker() {
  const express = require("express");
  const cors = require("cors");
  const sharp = require("sharp");

  fs.mkdirSync(TEMP_DIR, { recursive: true });

  if (isProduction) {
    process.env.PATH = `${process.env.PATH}:${path.join(__dirname, "bin")}`;
  }

  // ---- store client ------------------------------------------------------
  let store;
  if (cluster.isWorker) {
    let seq = 0;
    const pending = new Map();
    process.on("message", (m) => {
      if (m && m.type === "store-reply") {
        const resolve = pending.get(m.id);
        if (resolve) {
          pending.delete(m.id);
          resolve(m.value);
        }
      }
    });
    const rpc = (op, key, value, ttl, wantReply = true) =>
      new Promise((resolve) => {
        if (!wantReply) {
          process.send({ type: "store", op, key, value, ttl });
          return resolve(null);
        }
        const id = ++seq;
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve(null);
        }, 2000);
        pending.set(id, (v) => {
          clearTimeout(timer);
          resolve(v);
        });
        process.send({ type: "store", id, op, key, value, ttl });
      });
    store = {
      set: (k, v, ttl) => rpc("set", k, v, ttl, false),
      get: (k) => rpc("get", k),
      take: (k) => rpc("take", k),
      del: (k) => rpc("del", k, null, 0, false),
    };
  } else {
    const local = new MemStore();
    setInterval(() => local.sweep(), 30_000).unref();
    fs.readdirSync(TEMP_DIR).forEach((f) =>
      fs.rmSync(path.join(TEMP_DIR, f), { force: true }),
    );
    store = {
      set: async (k, v, ttl) => local.set(k, v, ttl),
      get: async (k) => local.get(k),
      take: async (k) => local.take(k),
      del: async (k) => local.del(k),
    };
  }

  // ---- helpers -----------------------------------------------------------
  const lastProgress = new Map(); // per-worker throttle
  const setProgress = (id, value) => {
    if (lastProgress.get(id) === value) return;
    lastProgress.set(id, value);
    store.set(`${id}:p`, value, PROGRESS_TTL);
  };

  class Limiter {
    constructor(max) {
      this.max = max;
      this.active = 0;
      this.queue = [];
    }
    get waiting() {
      return this.queue.length;
    }
    acquire() {
      if (this.active < this.max) {
        this.active++;
        return Promise.resolve();
      }
      return new Promise((resolve) => this.queue.push(resolve));
    }
    release() {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
  const limiter = new Limiter(MAX_JOBS);

  const rm = (...files) =>
    Promise.all(
      files.map((f) => fs.promises.rm(f, { force: true }).catch(() => {})),
    );

  const UUID_RE = /^[0-9a-f-]{36}$/i;
  const VIDEO_ID_RE = /^[\w-]{11}$/;
  const YT_HOSTS = new Set([
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
  ]);

  /** Returns { id, url } with a canonical URL, or null if not a valid YouTube link. */
  function parseYouTubeUrl(input) {
    try {
      const u = new URL(String(input).trim());
      if (
        !["http:", "https:"].includes(u.protocol) ||
        !YT_HOSTS.has(u.hostname)
      )
        return null;
      let id = null;
      if (u.hostname === "youtu.be") {
        id = u.pathname.slice(1).split("/")[0];
      } else if (u.pathname === "/watch") {
        id = u.searchParams.get("v");
      } else {
        const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
        if (m) id = m[1];
      }
      if (!id || !VIDEO_ID_RE.test(id)) return null;
      return { id, url: `https://www.youtube.com/watch?v=${id}` };
    } catch {
      return null;
    }
  }

  const safeFileName = (title) =>
    String(title || "")
      .replace(/[\/\\:*?"<>|\u0000-\u001f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 150) || "audio";

  const ytDlpBaseArgs = () => {
    const args = [
      "--no-playlist",
      "--no-warnings",
      "--js-runtimes",
      `node:${NODE_PATH}`,
    ];
    if (fs.existsSync(COOKIE_PATH)) args.push("--cookies", COOKIE_PATH);
    return args;
  };

  // ---- metadata ---------------------------------------------------------------
  // /api/song uses YouTube's fast oEmbed. The full tags come from the SAME yt-dlp
  // process that downloads the audio (no second yt-dlp run = no CPU contention).
  const metaCache = new Map(); // videoId -> { meta, exp }

  async function fetchOEmbed(url) {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) throw new Error(`oEmbed status ${res.status}`);
    return res.json();
  }

  // "Artist - Topic" / "ArtistVEVO" -> "Artist"
  const cleanArtist = (n) =>
    String(n || "")
      .replace(/\s*-\s*Topic$/i, "")
      .replace(/(?<=.)VEVO$/i, "")
      .trim();

  // Record-label channels upload "Song - Movie" titles; artist / VEVO channels use "Artist - Song"
  const LABEL_CHANNEL_RE =
    /\b(t-?series|zee music|sony music|saregama|tips|eros now|times music|speed records|yrf|venus|universal music|warner music|lahari|aditya music|think music|muzik247)\b/i;

  // ---- artist list helpers -------------------------------------------------------
  /** "A, B & C" / "A feat. B" / ["A","B"]  ->  ["A","B","C"]  (keeps "Simon & Garfunkel" intact) */
  function splitNames(input, alwaysAmp = false) {
    const out = [];
    for (const raw of Array.isArray(input) ? input : [input]) {
      const str = String(raw || "").trim();
      if (!str) continue;
      const segs = str
        .split(/\s*[;,]\s*|\s+(?:feat\.?|ft\.?|featuring)\s+/i)
        .map((x) => x.trim())
        .filter(Boolean);
      if (segs.length > 1 || alwaysAmp) {
        // list style ("A, B & C"): the last item may be joined with & / and
        const last = segs.pop();
        segs.push(
          ...last
            .split(/\s+(?:&|and)\s+/i)
            .map((x) => x.trim())
            .filter(Boolean),
        );
      }
      out.push(...segs);
    }
    return out;
  }

  function uniqueNames(list) {
    const seen = new Set();
    return list
      .map((n) => n.replace(/^[\s\-–—·•]+|[\s\-–—·•]+$/g, "").trim())
      .filter(
        (n) =>
          n &&
          n.length <= 80 &&
          !seen.has(n.toLowerCase()) &&
          seen.add(n.toLowerCase()),
      );
  }

  /** Credits found in a video description (labels / auto-generated music block). */
  function creditsFromDescription(desc) {
    const text = String(desc || "").slice(0, 8000);
    if (!text) return {};
    const year =
      (text.match(/(?:\u2117|\u00a9|\(c\)|\(p\))\s*(\d{4})/i) ||
        text.match(/Released on:\s*(\d{4})/i) ||
        [])[1] || "";

    // Auto-generated: "Provided to YouTube by X\n\nSong · Artist1 · Artist2 ..."
    const prov = text.match(/Provided to YouTube by[^\n]*\n+\s*([^\n]+)/i);
    if (prov && prov[1].includes(" · ")) {
      const parts = prov[1].split(" · ").map((x) => x.trim());
      parts.shift(); // song title
      if (parts.length) return { artists: parts, year };
    }

    // Label style: "Singer: A, B" / "Music: C" (also several on one line separated by | or •)
    const grab = (re) => {
      const m = text.match(re);
      if (!m) return "";
      return m[1]
        .split(/\s+[|•]\s+/)[0]
        .replace(/https?:\/\/\S+/g, "")
        .replace(/\([^)]*\)/g, "")
        .trim();
    };
    const composer = grab(
      /(?:^|\n|[|•])\s*(?:music(?:\s*(?:director|composed(?:\s*by)?|by))?|composer|composed\s*by)\s*[:\-–—]\s*([^\n]+)/i,
    );
    const singers = grab(
      /(?:^|\n|[|•])\s*(?:singers?|vocals?|sung\s*by|performed\s*by|artists?)\s*[:\-–—]\s*([^\n]+)/i,
    );
    return { composer, singers, year };
  }

  // Removes "(Official Video)", "[Lyrical Video]", "(Full Song)", "(HD)" ... but keeps "(From "Movie")", "(Remix)"
  const NOISE_RE =
    /\s*[\(\[][^\)\]]*\b(?:official|video|audio|lyrics?|lyrical|visuali[sz]er|mv|full\s+song|hd|4k)\b[^\)\]]*[\)\]]\s*/gi;
  /** "Song (Full Video) | Movie | Cast" -> "Song" */
  function cleanTitle(raw) {
    const first = String(raw || "").split(/\s+[|\uFF5C]\s+/)[0];
    const cleaned = first
      .replace(NOISE_RE, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    return cleaned || String(raw || "").trim();
  }
  // "Artist - Song" -> { artist: "Artist", song: "Song" }
  function parseArtistTitle(raw) {
    const m = String(raw || "")
      .trim()
      .match(/^(.{1,70}?)\s+[-\u2013\u2014]\s+(.+)$/);
    if (!m) return null;
    const artist = m[1].trim();
    const song = cleanTitle(m[2]);
    return artist && song ? { artist, song } : null;
  }

  /** Build tag data from yt-dlp's info JSON (v) and/or oEmbed (o). Either may be empty. */
  function buildMeta(v, o) {
    v = v || {};
    o = o || {};
    const channel = v.channel || v.uploader || o.author_name || "";

    // Artist priority:
    //  1) official artist fields   2) "Provided to YouTube" block   3) description credits (singers + music)
    //  4) "Artist - Song" in the title   5) channel name
    const credits = creditsFromDescription(v.description);
    let names = uniqueNames(
      splitNames(
        Array.isArray(v.artists) && v.artists.length
          ? v.artists
          : [v.artist || v.track_artist || v.album_artist || ""],
      ),
    );
    if (!names.length && credits.artists)
      names = uniqueNames(splitNames(credits.artists, true));
    if (!names.length && credits.singers) {
      names = uniqueNames([
        ...splitNames(credits.composer, true),
        ...splitNames(credits.singers, true),
      ]);
    }
    let artist = names.join(", ");

    const cleanedTitle = cleanTitle(v.title || o.title);
    let title = v.track || cleanedTitle || `audio-${Date.now()}`;
    const parsed = v.track ? null : parseArtistTitle(cleanedTitle);
    let albumGuess = "";
    if (parsed) {
      const known = artist.toLowerCase();
      const isArtist = (x) => x.length > 2 && known.includes(x.toLowerCase());
      if (!artist) {
        // no credits: "Artist - Song" on artist channels; label channels mean "Song - Movie", keep the title whole
        if (!LABEL_CHANNEL_RE.test(channel)) {
          artist = uniqueNames(splitNames(parsed.artist)).join(", ");
          title = parsed.song;
        }
      } else if (isArtist(parsed.artist)) {
        title = parsed.song; // "Artist - Song"
      } else if (isArtist(parsed.song)) {
        title = parsed.artist; // "Song - Artist"
      } else {
        title = parsed.artist; // "Song - Movie": song is the title, the movie is the album
        albumGuess = parsed.song;
      }
    }
    // alternative readings of "A - B", used when searching Apple Music
    const titleCandidates = [
      ...new Set(
        [title, ...(parsed ? [parsed.artist, parsed.song] : [])]
          .map((t) => t.trim())
          .filter((t) => t.length > 1),
      ),
    ];
    if (!artist) artist = cleanArtist(channel) || "Unknown Artist";

    const composer = uniqueNames(splitNames(credits.composer || "", true)).join(
      ", ",
    );
    const uploadDate = String(v.upload_date || "");
    const releaseYear = v.release_year
      ? String(v.release_year)
      : String(v.release_date || "").slice(0, 4) || credits.year || "";

    // YouTube Music / "Topic" uploads expose real square album art
    const squareCover =
      (Array.isArray(v.thumbnails) ? v.thumbnails : [])
        .filter((t) => t.url && t.width && t.width === t.height)
        .sort((x, y) => y.width - x.width)[0]?.url || "";

    return {
      title,
      rawTitle: String(v.title || o.title || ""),
      artist,
      composer,
      channel: channel || "Unknown Channel",
      album: v.album || albumGuess || "",
      titleCandidates,
      duration: Number(v.duration) || 0,
      cover: v.thumbnail || o.thumbnail_url || "",
      squareCover,
      uploadDate,
      releaseYear,
    };
  }

  // Rich metadata is kept locally and in the shared store (so any worker can serve it).
  function cacheMeta(videoId, meta) {
    metaCache.set(videoId, { meta, exp: Date.now() + META_TTL });
    if (metaCache.size > 500) metaCache.delete(metaCache.keys().next().value);
    return store.set(`meta:${videoId}`, meta, META_TTL);
  }

  async function getCachedMeta(videoId) {
    const hit = metaCache.get(videoId);
    if (hit && hit.exp > Date.now()) return hit.meta;
    return (await store.get(`meta:${videoId}`)) || null;
  }

  // ---- background "full details" lookup for the preview card ------------------------
  // One low-priority yt-dlp run per worker. It is cancelled as soon as the user starts the
  // download (the download's own yt-dlp run supplies the same data), so they never compete.
  const BACKGROUND_META = process.env.BACKGROUND_META !== "0";
  const metaLimiter = new Limiter(1);
  const metaJobs = new Map(); // videoId -> { proc, cancelled }

  function spawnInfoJson(url) {
    const args = [
      "--ignore-config",
      "--dump-single-json",
      "--skip-download",
      "--ignore-no-formats-error",
      ...ytDlpBaseArgs(),
      url,
    ];
    const proc = spawn(YT_DLP_PATH, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err = (err + d).slice(-1500)));
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error("yt-dlp metadata timed out"));
      }, INFO_TIMEOUT);
      proc.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      // killed (cancelled / timeout): finish immediately, don't wait for pipes to drain
      proc.on("exit", (code, signal) => {
        if (signal) {
          clearTimeout(timer);
          reject(new Error(`yt-dlp stopped (${signal})`));
        }
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0)
          return reject(
            new Error(err.trim() || `yt-dlp exited with code ${code}`),
          );
        try {
          resolve(JSON.parse(out));
        } catch {
          reject(new Error("Could not parse yt-dlp JSON"));
        }
      });
    });
    return { proc, promise };
  }

  function startMetaFetch(videoId, url) {
    if (!BACKGROUND_META || metaJobs.has(videoId)) return;
    const job = { proc: null, cancelled: false };
    metaJobs.set(videoId, job);

    (async () => {
      let acquired = false;
      let watcher = null;
      try {
        await metaLimiter.acquire();
        acquired = true;
        // a download for this video already started (or is running): its own yt-dlp run supplies the data
        if (job.cancelled || (await store.get(`metastop:${videoId}`))) return;

        const { proc, promise } = spawnInfoJson(url);
        job.proc = proc;
        // cancellation may come from another worker (cluster) through the shared store
        watcher = setInterval(async () => {
          if (await store.get(`metastop:${videoId}`)) {
            job.cancelled = true;
            proc.kill("SIGKILL");
          }
        }, 1000);

        const [info, o] = await Promise.all([
          promise,
          fetchOEmbed(url).catch(() => null),
        ]);
        if (job.cancelled) return;
        await cacheMeta(
          videoId,
          await enrichWithItunes(videoId, buildMeta(info, o)),
        );
      } catch (e) {
        if (!job.cancelled) {
          console.error("background metadata failed:", e.message);
          await store.set(`metafail:${videoId}`, 1, 120_000);
        }
      } finally {
        if (watcher) clearInterval(watcher);
        if (acquired) metaLimiter.release();
        metaJobs.delete(videoId);
      }
    })();
  }

  function cancelMetaFetch(videoId) {
    store.set(`metastop:${videoId}`, 1, 10 * 60_000);
    const job = metaJobs.get(videoId);
    if (job) {
      job.cancelled = true;
      if (job.proc) job.proc.kill("SIGKILL");
    }
  }

  const publicMeta = (m, detailsReady) => ({
    song_name: m.title,
    artist: m.artist,
    singer: m.artist, // legacy alias for older frontends
    channel: m.channel,
    album: m.album || "",
    duration: m.duration,
    cover: m.squareCover || m.cover, // prefer real square album art
    releaseYear: m.releaseYear,
    composer: m.composer || "",
    genre: m.genre || "",
    verified: !!m.verified,
    detailsReady,
  });

  // ---- Apple Music (iTunes Search API) matching --------------------------------------
  // Gives the real artist list, album, year, genre and official square cover. It only
  // overrides the YouTube data when the match is confident (wrong tags are worse than basic tags).
  const ITUNES_ENABLED = process.env.ITUNES !== "0";
  const ITUNES_COUNTRIES = (process.env.ITUNES_COUNTRIES || "IN,US")
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
  const LABEL_RE =
    /\b(t-?series|zee music|sony music|saregama|tips (?:official|music)|eros now|times music|speed records|yrf|universal music|warner|vevo|records|official)\b/i;

  const plain = (x) =>
    String(x || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const normTitle = (x) =>
    plain(String(x || "").replace(/[\(\[][^\)\]]*[\)\]]/g, " "));

  function titleSimilarity(a, b) {
    const x = normTitle(a);
    const y = normTitle(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    const A = new Set(x.split(" "));
    const B = new Set(y.split(" "));
    let inter = 0;
    for (const w of A) if (B.has(w)) inter++;
    const jaccard = inter / (A.size + B.size - inter);
    const [small, big] = A.size <= B.size ? [A, B] : [B, A];
    const contained = small.size >= 2 && [...small].every((w) => big.has(w));
    return Math.max(jaccard, contained ? 0.85 : 0);
  }

  function pickItunesMatch(results, q) {
    const hints = plain(`${q.rawTitle} ${q.channel} ${q.artist}`);
    const cands = [];
    for (const c of results || []) {
      if (!c.trackName || !c.artistName) continue;
      const sim = Math.max(
        ...q.titles.map((t) => titleSimilarity(c.trackName, t)),
      );
      if (sim < 0.7) continue;
      const artistOk = splitNames(c.artistName).some((n) => {
        const p = plain(n);
        return p.length > 2 && hints.includes(p);
      });
      const durOk =
        q.duration > 0 &&
        c.trackTimeMillis &&
        Math.abs(c.trackTimeMillis / 1000 - q.duration) <= 8;
      // movie / album name appears in the video title ("Song | Aashiqui 2 | ..."); a single named
      // after the song itself says nothing, so it is excluded
      const alb = normTitle(
        String(c.collectionName || "").replace(/\s+-\s+(?:single|ep)$/i, ""),
      );
      const albumOk =
        alb.length >= 4 &&
        alb !== normTitle(c.trackName) &&
        hints.includes(alb);
      cands.push({
        c,
        sim,
        artistOk,
        durOk,
        albumOk,
        score:
          sim + (artistOk ? 0.3 : 0) + (durOk ? 0.3 : 0) + (albumOk ? 0.3 : 0),
      });
    }
    // artist / duration support is enough; an album-name hit only counts for a (near) exact title
    const supported = cands
      .filter((x) => x.artistOk || x.durOk || (x.albumOk && x.sim >= 0.95))
      .sort((a, b) => b.score - a.score);
    if (supported.length) return supported[0].c;
    const exact = cands.filter((x) => x.sim === 1); // unambiguous exact title is enough
    return exact.length === 1 ? exact[0].c : null;
  }

  async function findItunes(meta) {
    const hint =
      meta.artist &&
      meta.artist !== "Unknown Artist" &&
      !LABEL_RE.test(meta.artist)
        ? meta.artist.split(",").slice(0, 2).join(" ")
        : "";
    const titles =
      meta.titleCandidates && meta.titleCandidates.length
        ? meta.titleCandidates.slice(0, 3)
        : [meta.title];
    const q = {
      titles,
      title: meta.title,
      rawTitle: meta.rawTitle || meta.title,
      channel: meta.channel,
      artist: meta.artist,
      duration: meta.duration,
    };
    const terms = hint
      ? [...titles.map((t) => `${t} ${hint}`), ...titles]
      : titles;
    const signal = AbortSignal.timeout(5000);
    for (const country of ITUNES_COUNTRIES) {
      for (const term of terms) {
        try {
          const params = new URLSearchParams({
            term,
            media: "music",
            entity: "song",
            limit: "10",
            country,
          });
          const r = await fetch(`https://itunes.apple.com/search?${params}`, {
            signal,
          });
          if (!r.ok) continue;
          const hit = pickItunesMatch((await r.json()).results, q);
          if (hit) return hit;
        } catch {
          return null; // timeout / network problem: keep the YouTube data
        }
      }
    }
    return null;
  }

  const hiResArt = (u) =>
    u
      ? String(u).replace(
          /\/\d+x\d+(?:bb|cc)?\.(?:jpg|png|webp)$/i,
          "/1400x1400bb.jpg",
        )
      : "";

  function applyItunes(meta, t) {
    const names = uniqueNames(splitNames(t.artistName));
    return {
      ...meta,
      title: t.trackName || meta.title,
      artist: names.join(", ") || meta.artist,
      album: t.collectionName || meta.album,
      releaseYear: String(t.releaseDate || "").slice(0, 4) || meta.releaseYear,
      genre: t.primaryGenreName || "",
      trackNumber: t.trackNumber || 0,
      trackCount: t.trackCount || 0,
      squareCover: hiResArt(t.artworkUrl100) || meta.squareCover,
      verified: true,
    };
  }

  async function enrichWithItunes(videoId, meta) {
    if (!ITUNES_ENABLED || !meta || !meta.title) return meta;
    const key = `itunes:${videoId}:${meta.duration > 0 ? "d" : "n"}`; // better matching once duration is known
    let entry = await store.get(key);
    if (!entry) {
      const t = await findItunes(meta);
      entry = {
        hit: t && {
          trackName: t.trackName,
          artistName: t.artistName,
          collectionName: t.collectionName,
          releaseDate: t.releaseDate,
          primaryGenreName: t.primaryGenreName,
          trackNumber: t.trackNumber,
          trackCount: t.trackCount,
          artworkUrl100: t.artworkUrl100,
        },
      };
      store.set(key, entry, t ? 24 * 3600_000 : 10 * 60_000);
    }
    return entry.hit ? applyItunes(meta, entry.hit) : meta;
  }

  // ---- cover art -----------------------------------------------------------
  async function fetchImage(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
  }

  /**
   * Builds an Apple Music-friendly cover: square, sRGB, baseline JPEG, no alpha,
   * no EXIF/ICC extras. Prefers YouTube's real square album art when available.
   */
  async function prepareCover(videoId, outPath, squareUrl) {
    const sources = [];
    if (squareUrl) sources.push({ url: squareUrl, square: true });
    for (const n of ["maxresdefault", "sddefault", "hqdefault"]) {
      sources.push({
        url: `https://i.ytimg.com/vi/${videoId}/${n}.jpg`,
        square: false,
      });
    }

    for (const src of sources) {
      try {
        const input = await fetchImage(src.url);
        if (!input) continue;

        let img;
        if (src.square || COVER_MODE === "crop") {
          img = sharp(input).resize(COVER_SIZE, COVER_SIZE, {
            fit: "cover",
            position: "centre",
          });
        } else {
          // keep the whole frame, fill the rest with a blurred, darkened copy
          const bg = await sharp(input)
            .resize(COVER_SIZE, COVER_SIZE, { fit: "cover" })
            .blur(40)
            .modulate({ brightness: 0.7 })
            .toBuffer();
          const fg = await sharp(input)
            .resize(COVER_SIZE, COVER_SIZE, { fit: "inside" })
            .toBuffer();
          img = sharp(bg).composite([{ input: fg, gravity: "centre" }]);
        }

        await img
          .flatten({ background: "#000000" }) // no transparency
          .toColorspace("srgb") // never CMYK / grayscale
          .jpeg({ quality: 92, progressive: false, chromaSubsampling: "4:2:0" }) // baseline JPEG
          .toFile(outPath); // metadata (EXIF/ICC) is stripped by default

        return true;
      } catch (e) {
        console.error("Cover failed:", src.url, e.message);
      }
    }
    return false;
  }

  // ---- audio stream + metadata in ONE yt-dlp run -------------------------------
  const INFO_TIMEOUT = Number(process.env.INFO_TIMEOUT_MS) || 120_000;

  function startAudioProcess(url, infoPath) {
    const args = [
      ...ytDlpBaseArgs(),
      "--no-check-certificates",
      "--http-chunk-size",
      "10M",
      "--concurrent-fragments",
      "4",
      "--no-part",
      // write the full info JSON to a file right before the download starts
      "--print-to-file",
      "before_dl:%()j",
      infoPath.replace(/%/g, "%%"),
      "--format",
      "bestaudio/best",
      "--output",
      "-",
      url,
    ];
    const proc = spawn(YT_DLP_PATH, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.ytErr = "";
    proc.on("error", (e) => {
      proc.ytErr += e.message;
      console.error("Failed to start yt-dlp:", e.message);
    });
    proc.stderr.on("data", (d) => {
      const t = d.toString().trim();
      proc.ytErr = (proc.ytErr + "\n" + t).slice(-1500);
      if (t) console.error("yt-dlp:", t);
    });

    // Buffer audio while we wait for the info JSON (so yt-dlp can keep downloading).
    const audio = new PassThrough({ highWaterMark: 4 * 1024 * 1024 });
    proc.stdout.pipe(audio);
    proc.stdout.on("error", () => {});

    const started = Date.now();
    let firstByteAt = 0;
    proc.stdout.once("data", () => (firstByteAt = Date.now()));

    const readInfo = () => {
      try {
        const line = fs.readFileSync(infoPath, "utf8").split("\n")[0].trim();
        return line ? JSON.parse(line) : null;
      } catch {
        return null; // not written yet / partially written
      }
    };

    const infoReady = new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        resolve(v);
      };
      const timer = setInterval(() => {
        const info = readInfo();
        if (info) return finish(info);
        if (firstByteAt && Date.now() - firstByteAt > 1500) return finish(null); // audio flowing, no info file
        if (Date.now() - started > INFO_TIMEOUT) finish(null);
      }, 100);
      proc.on("close", () => finish(readInfo()));
    });

    return { proc, audio, infoReady };
  }

  // ---- express app -------------------------------------------------------------
  const app = express();
  app.disable("x-powered-by");
  app.use(
    cors({
      origin: ALLOW_ALL_ORIGINS ? true : ALLOWED_ORIGINS,
      exposedHeaders: ["X-Download-ID", "Content-Disposition"],
    }),
  );
  app.use(express.json({ limit: "10kb" }));

  app.get("/", (req, res) => res.send("Backend is working"));

  // ---- startup self-check (shows up in Render logs and /health) --------------
  const run = (cmd, args) =>
    new Promise((resolve) => {
      const c = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      c.stdout.on("data", (d) => (out += d));
      c.stderr.on("data", (d) => (out += d));
      c.on("error", (e) => resolve({ ok: false, out: e.message }));
      c.on("close", (code) => resolve({ ok: code === 0, out }));
    });

  let toolStatus = { checking: true };
  (async () => {
    const [yt, ff, enc] = await Promise.all([
      run(YT_DLP_PATH, ["--version"]),
      run(FFMPEG_PATH, ["-version"]),
      run(FFMPEG_PATH, ["-hide_banner", "-encoders"]),
    ]);
    toolStatus = {
      ytDlp: yt.ok
        ? yt.out.trim()
        : `MISSING (${YT_DLP_PATH}): ${yt.out.trim().slice(0, 120)}`,
      ffmpeg: ff.ok
        ? ff.out.split("\n")[0]
        : `MISSING (${FFMPEG_PATH}): ${ff.out.trim().slice(0, 120)}`,
      mp3Encoder: enc.ok && /libmp3lame/.test(enc.out),
      cookiesFile: fs.existsSync(COOKIE_PATH),
      node: process.version,
    };
    console.log(`[${process.pid}] TOOL CHECK:`, JSON.stringify(toolStatus));
    if (!toolStatus.mp3Encoder)
      console.error(
        "WARNING: ffmpeg has no libmp3lame, MP3 conversion will fail.",
      );
  })();

  app.get("/health", (req, res) =>
    res.json({
      ok: true,
      pid: process.pid,
      activeJobs: limiter.active,
      queued: limiter.waiting,
      workers: WORKERS,
      allowedOrigins: ALLOW_ALL_ORIGINS ? "*" : ALLOWED_ORIGINS,
      tools: toolStatus,
    }),
  );

  // Metadata only (for preview)
  // Instant preview (oEmbed) - full details are fetched in the background
  app.post("/api/song", async (req, res) => {
    const parsed = parseYouTubeUrl(req.body?.url);
    if (!parsed)
      return res.status(400).json({ error: "A valid YouTube URL is required" });
    try {
      let m = await getCachedMeta(parsed.id);
      let detailsReady = !!m;
      if (!m) {
        const o = await fetchOEmbed(parsed.url);
        m = await enrichWithItunes(parsed.id, buildMeta(null, o));
        startMetaFetch(parsed.id, parsed.url);
      }
      res.json(publicMeta(m, detailsReady));
    } catch (e) {
      console.error("SONG METADATA ERROR:", e.message);
      res.status(500).json({ error: "Could not retrieve video information" });
    }
  });

  // Poll this until { ready: true } to upgrade the preview with the full details
  app.post("/api/song-details", async (req, res) => {
    const parsed = parseYouTubeUrl(req.body?.url);
    if (!parsed)
      return res.status(400).json({ error: "A valid YouTube URL is required" });
    const m = await getCachedMeta(parsed.id);
    if (m) return res.json({ ready: true, ...publicMeta(m, true) });
    const failed = !!(await store.get(`metafail:${parsed.id}`));
    if (!failed) startMetaFetch(parsed.id, parsed.url); // no-op if already running
    res.json({ ready: false, failed });
  });

  // ---- conversion job (shared by the link flow and the legacy streaming flow) --------
  const FILE_TTL = 20 * 60 * 1000; // converted files stay downloadable this long

  const makeCtl = () => ({
    aborted: false,
    ytProc: null,
    command: null,
    abort() {
      this.aborted = true;
      if (this.ytProc) this.ytProc.kill("SIGKILL");
      if (this.command) {
        try {
          this.command.kill("SIGKILL");
        } catch {}
      }
    },
  });

  const dispositionFor = (name) => {
    const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
    const encoded = encodeURIComponent(name).replace(
      /['()*]/g,
      (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
    );
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
  };

  const friendlyError = (e, ytErr) => {
    const t = `${e && e.message} ${ytErr || ""}`;
    if (/sign in to confirm|not a bot|HTTP Error 429/i.test(t)) {
      return "YouTube is blocking the server right now. Please try again in a little while.";
    }
    if (/private video|unavailable|has been removed|copyright/i.test(t)) {
      return "This video isn't available for download.";
    }
    return "Conversion failed. Please try again.";
  };

  /** Downloads the audio, converts it to a tagged MP3 and returns { outPath, downloadName }. */
  async function convertJob({ id, videoId, url, quality, ctl }) {
    const outPath = path.join(TEMP_DIR, `${id}.mp3`);
    const coverPath = path.join(TEMP_DIR, `${id}.jpg`);
    const infoPath = path.join(TEMP_DIR, `${id}.info.json`);
    let acquired = false;
    try {
      await limiter.acquire();
      acquired = true;
      if (ctl.aborted) throw new Error("Cancelled");

      // Start downloading audio while metadata and cover art are prepared in parallel.
      const oembedP = fetchOEmbed(url).catch(() => null);
      const started = startAudioProcess(url, infoPath);
      ctl.ytProc = started.proc;
      const audioStream = started.audio;

      const info = await started.infoReady; // arrives just before audio starts flowing
      if (ctl.aborted) throw new Error("Cancelled");
      const meta = await enrichWithItunes(
        videoId,
        buildMeta(info, await oembedP),
      );
      if (!info)
        console.warn(
          `[${process.pid}] ${id}: no yt-dlp info JSON, using oEmbed tags only`,
        );
      cacheMeta(videoId, meta);
      const downloadName = `${safeFileName(meta.title)} [${quality}kbps].mp3`;
      const hasCover = await prepareCover(videoId, coverPath, meta.squareCover);
      if (ctl.aborted) throw new Error("Cancelled");

      console.log(
        `[${process.pid}] ${id}: cover=${hasCover ? "yes" : "NO"} title="${meta.title}"`,
      );

      await new Promise((resolve, reject) => {
        const clean = (v) =>
          String(v || "")
            .replace(/\u0000/g, "")
            .trim();
        const args = [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostats",
          "-progress",
          "pipe:1",
          "-i",
          "pipe:0",
        ];
        if (hasCover) args.push("-i", coverPath);

        args.push("-map", "0:a:0");
        if (hasCover) args.push("-map", "1:v:0");

        args.push(
          "-c:a",
          "libmp3lame",
          "-b:a",
          `${quality}k`,
          "-compression_level",
          "7",
        );
        if (hasCover) args.push("-c:v", "copy");

        args.push(
          "-id3v2_version",
          "3",
          "-write_id3v1",
          "1",
          "-metadata",
          `title=${clean(meta.title)}`,
          "-metadata",
          `artist=${clean(meta.artist)}`,
          "-metadata",
          `album=${clean(meta.album) || clean(meta.title)}`,
          "-metadata",
          `album_artist=${clean(meta.artist)}`,
          ...(meta.composer
            ? ["-metadata", `composer=${clean(meta.composer)}`]
            : []),
          "-metadata",
          `genre=${clean(meta.genre) || "Music"}`,
          ...(meta.trackNumber
            ? [
                "-metadata",
                `track=${meta.trackNumber}${meta.trackCount ? "/" + meta.trackCount : ""}`,
              ]
            : []),
          "-metadata",
          `date=${clean(meta.releaseYear)}`,
        );
        if (hasCover) {
          args.push(
            "-metadata:s:v",
            "title=Album cover",
            "-metadata:s:v",
            "comment=Cover (front)",
            "-disposition:v:0",
            "attached_pic",
          );
        }
        args.push("-f", "mp3", "-y", outPath);

        // args are passed as an array: no shell, no space-splitting problems
        const ff = spawn(FFMPEG_PATH, args, {
          stdio: ["pipe", "pipe", "pipe"],
        });
        ctl.command = ff;

        audioStream.pipe(ff.stdin);
        ff.stdin.on("error", () => {}); // ffmpeg may close stdin early

        let errTail = "";
        ff.stderr.on("data", (d) => (errTail = (errTail + d).slice(-2000)));

        let buf = "";
        ff.stdout.on("data", (d) => {
          buf += d;
          const lines = buf.split("\n");
          buf = lines.pop();
          for (const line of lines) {
            const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
            if (!m) continue;
            const secs = Number(m[1]) / 1e6;
            if (secs <= 0) continue;
            const pct =
              meta.duration > 0
                ? (secs / meta.duration) * 100
                : 99 * (1 - Math.exp(-secs / 180));
            setProgress(id, Math.min(Math.max(Math.round(pct), 0), 99));
          }
        });

        ff.on("error", (e) =>
          reject(new Error(`ffmpeg failed to start: ${e.message}`)),
        );
        ff.on("close", (code) => {
          if (code === 0) return resolve();
          reject(
            new Error(
              ctl.aborted
                ? "Cancelled"
                : `ffmpeg exited with code ${code}: ${errTail.trim()}`,
            ),
          );
        });
      });

      return { outPath, downloadName };
    } catch (e) {
      e.ytErr = ctl.ytProc && ctl.ytProc.ytErr;
      await rm(outPath);
      throw e;
    } finally {
      if (acquired) limiter.release();
      if (ctl.ytProc) ctl.ytProc.kill("SIGKILL");
      await rm(coverPath, infoPath);
    }
  }

  // Link flow: convert in the background, then serve the finished file from a normal URL
  // (a real download link works in Safari and in-app browsers such as the Documents app).
  const activeJobs = new Map(); // id -> ctl

  async function runLinkJob(id, job, ctl) {
    const watcher = setInterval(async () => {
      if (await store.get(`${id}:cancel`)) ctl.abort();
    }, 1000);
    try {
      const { outPath, downloadName } = await convertJob({ id, ...job, ctl });
      const stat = await fs.promises.stat(outPath);
      await store.set(
        `${id}:ready`,
        { name: downloadName, size: stat.size },
        FILE_TTL,
      );
      setProgress(id, 100); // only after "ready" is stored
    } catch (e) {
      if (!ctl.aborted)
        console.error(
          "Conversion error:",
          e.message,
          e.ytErr ? `| yt-dlp: ${e.ytErr}` : "",
        );
      await store.set(
        `${id}:err`,
        ctl.aborted ? "Download cancelled." : friendlyError(e, e.ytErr),
        PROGRESS_TTL,
      );
      setProgress(id, -1);
    } finally {
      clearInterval(watcher);
      activeJobs.delete(id);
      setTimeout(() => lastProgress.delete(id), 60_000).unref();
    }
  }

  // PHASE 1: register a download job
  app.post("/api/download", async (req, res) => {
    const parsed = parseYouTubeUrl(req.body?.url);
    const quality = String(req.body?.quality);
    if (!parsed)
      return res.status(400).json({ error: "A valid YouTube URL is required" });
    if (quality !== "128" && quality !== "320") {
      return res.status(400).json({ error: "Invalid quality" });
    }
    try {
      const downloadId = crypto.randomUUID();

      if (req.body?.delivery === "link") {
        if (limiter.waiting >= MAX_QUEUE) {
          res.setHeader("Retry-After", "10");
          return res
            .status(503)
            .json({
              error:
                "The converter is busy right now. Try again in a few seconds.",
            });
        }
        cancelMetaFetch(parsed.id); // the conversion supplies the same metadata
        setProgress(downloadId, 0);
        const ctl = makeCtl();
        activeJobs.set(downloadId, ctl);
        runLinkJob(
          downloadId,
          { videoId: parsed.id, url: parsed.url, quality },
          ctl,
        ); // runs in the background
        return res.json({ success: true, downloadId, delivery: "link" });
      }

      // legacy flow: the client calls /api/download-file next
      await store.set(
        `${downloadId}:job`,
        { videoId: parsed.id, url: parsed.url, quality },
        JOB_TTL,
      );
      setProgress(downloadId, 0);
      res.setHeader("X-Download-ID", downloadId);
      res.json({ success: true, downloadId });
    } catch (e) {
      console.error("Initialization error:", e.message);
      res.status(400).json({ error: e.message });
    }
  });

  // Polling-friendly status (more reliable than SSE on mobile / in-app browsers)
  app.get("/api/status/:id", async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Invalid ID" });
    const p = (await store.get(`${id}:p`)) ?? 0;
    const out = { progress: Math.max(p, 0), error: false };
    if (p < 0) {
      out.error = true;
      out.message =
        (await store.get(`${id}:err`)) ||
        "Conversion failed. Please try again.";
    } else if (p >= 100) {
      const ready = await store.get(`${id}:ready`);
      if (ready)
        Object.assign(out, { ready: true, name: ready.name, size: ready.size });
    }
    res.setHeader("Cache-Control", "no-store");
    res.json(out);
  });

  app.post("/api/cancel", async (req, res) => {
    const id = String(req.body?.id || "");
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Invalid ID" });
    await store.set(`${id}:cancel`, 1, 5 * 60_000);
    const ctl = activeJobs.get(id);
    if (ctl) ctl.abort();
    res.json({ ok: true });
  });

  // The finished MP3: a plain GET that answers with a download (Range requests supported)
  app.get("/api/file/:id", async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id))
      return res.status(400).send("Invalid download link.");
    const ready = await store.get(`${id}:ready`);
    const filePath = path.join(TEMP_DIR, `${id}.mp3`);
    if (!ready || !fs.existsSync(filePath)) {
      return res
        .status(404)
        .send("This download has expired. Please convert the song again.");
    }
    res.setHeader("Content-Disposition", dispositionFor(ready.name));
    res.setHeader("Cache-Control", "private, no-cache");
    res.type("audio/mpeg");
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent)
        res.status(500).send("Could not send the file.");
    });
  });

  // Legacy flow: convert + stream in one request (kept for older frontends)
  app.get("/api/download-file", async (req, res) => {
    const id = String(req.query.id || "");
    if (!UUID_RE.test(id))
      return res.status(400).send("Invalid or expired session tracking ID");

    const job = await store.take(`${id}:job`); // atomic: a job can only be claimed once
    if (!job)
      return res.status(400).send("Invalid or expired session tracking ID");

    if (limiter.waiting >= MAX_QUEUE) {
      setProgress(id, -1);
      res.setHeader("Retry-After", "10");
      return res.status(503).send("Server busy, please retry shortly.");
    }

    cancelMetaFetch(job.videoId);
    const ctl = makeCtl();
    res.on("close", () => {
      if (!res.writableFinished) ctl.abort(); // client left: stop all work
    });
    const outPath = path.join(TEMP_DIR, `${id}.mp3`);

    try {
      const { downloadName } = await convertJob({ id, ...job, ctl });
      setProgress(id, 100);
      if (ctl.aborted) throw new Error("Cancelled");
      const stat = await fs.promises.stat(outPath);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", stat.size);
      res.setHeader("X-Download-ID", id);
      res.setHeader("Content-Disposition", dispositionFor(downloadName));
      await pipeline(fs.createReadStream(outPath), res);
    } catch (e) {
      if (!ctl.aborted)
        console.error(
          "Streaming error:",
          e.message,
          e.ytErr ? `| yt-dlp: ${e.ytErr}` : "",
        );
      setProgress(id, -1);
      if (!res.headersSent) res.status(500).send(friendlyError(e, e.ytErr));
      else res.destroy();
    } finally {
      await rm(outPath);
      setTimeout(() => lastProgress.delete(id), 60_000).unref();
    }
  });

  // Remove converted files nobody picked up
  setInterval(async () => {
    try {
      for (const f of await fs.promises.readdir(TEMP_DIR)) {
        const p = path.join(TEMP_DIR, f);
        const st = await fs.promises.stat(p).catch(() => null);
        if (st && Date.now() - st.mtimeMs > FILE_TTL + 5 * 60_000) await rm(p);
      }
    } catch {}
  }, 5 * 60_000).unref();

  // Progress via Server-Sent Events (works across workers via shared store)
  app.get("/api/progress/:id", (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).end();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // stop nginx from buffering SSE
    res.flushHeaders();

    let closed = false;
    let last = -2;
    const tick = async () => {
      if (closed) return;
      const p = (await store.get(`${id}:p`)) ?? 0;
      if (closed) return;
      if (p !== last) {
        last = p;
        res.write(
          `data: ${JSON.stringify({ progress: Math.max(p, 0), error: p < 0 })}\n\n`,
        );
      }
      if (p >= 100 || p < 0) {
        clearInterval(timer);
        setTimeout(() => res.end(), 300);
      }
    };
    const timer = setInterval(tick, 500);
    const heartbeat = setInterval(
      () => !closed && res.write(": ping\n\n"),
      15_000,
    );
    req.on("close", () => {
      closed = true;
      clearInterval(timer);
      clearInterval(heartbeat);
    });
    tick();
  });

  const server = app.listen(PORT, () =>
    console.log(
      `[${process.pid}] Server live on port ${PORT} (${cluster.isWorker ? "worker" : "single"})`,
    ),
  );

  process.on("SIGTERM", () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
