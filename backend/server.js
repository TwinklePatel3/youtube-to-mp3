"use strict";

const cluster = require("cluster");
const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { pipeline } = require("stream/promises");

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
  "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"
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

  // ---- metadata (parallel sources + cache + in-flight dedupe) -------------
  const metaCache = new Map(); // videoId -> { meta, exp }
  const metaInflight = new Map(); // videoId -> Promise

  function runYtDlpJson(url, timeoutMs = 25_000) {
    return new Promise((resolve, reject) => {
      const args = [
        "--ignore-config",
        "--dump-single-json",
        "--skip-download",
        "--ignore-no-formats-error", // metadata doesn't need formats
        ...ytDlpBaseArgs(),
        url,
      ];
      const child = spawn(YT_DLP_PATH, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("yt-dlp metadata timed out"));
      }, timeoutMs);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
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
  }

  async function fetchOEmbed(url) {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) throw new Error(`oEmbed status ${res.status}`);
    return res.json();
  }

  async function loadMeta(videoId, url) {
    const [oe, yt] = await Promise.allSettled([
      fetchOEmbed(url),
      runYtDlpJson(url),
    ]);
    const o = oe.status === "fulfilled" ? oe.value : {};
    const v = yt.status === "fulfilled" ? yt.value : {};
    if (yt.status === "rejected")
      console.error("yt-dlp metadata error:", yt.reason.message);
    if (oe.status === "rejected")
      console.error("oEmbed error:", oe.reason.message);
    if (!o.title && !v.title)
      throw new Error("Could not retrieve video information");

    const singer =
      (Array.isArray(v.artists) ? v.artists.join(", ") : "") ||
      v.artist ||
      v.track_artist ||
      v.album_artist ||
      "";
    const uploadDate = v.upload_date || "";
    const releaseYear = v.release_year
      ? String(v.release_year)
      : uploadDate.slice(0, 4);

    // YouTube Music / "Topic" uploads expose real square album art
    const squareCover =
      (Array.isArray(v.thumbnails) ? v.thumbnails : [])
        .filter((t) => t.url && t.width && t.width === t.height)
        .sort((a, b) => b.width - a.width)[0]?.url || "";

    return {
      squareCover,
      title: v.title || o.title || `audio-${Date.now()}`,
      singer: singer || "Unknown Artist",
      channel: v.channel || v.uploader || o.author_name || "Unknown Channel",
      album: v.album || "",
      duration: Number(v.duration) || 0,
      cover: v.thumbnail || o.thumbnail_url || "",
      uploadDate,
      releaseYear,
    };
  }

  function getMeta(videoId, url) {
    const hit = metaCache.get(videoId);
    if (hit && hit.exp > Date.now()) return Promise.resolve(hit.meta);
    if (metaInflight.has(videoId)) return metaInflight.get(videoId);

    const p = loadMeta(videoId, url)
      .then((meta) => {
        metaCache.set(videoId, { meta, exp: Date.now() + META_TTL });
        if (metaCache.size > 500)
          metaCache.delete(metaCache.keys().next().value);
        return meta;
      })
      .finally(() => metaInflight.delete(videoId));
    metaInflight.set(videoId, p);
    return p;
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

  // ---- audio stream ----------------------------------------------------------
  function startAudioProcess(url) {
    const args = [
      ...ytDlpBaseArgs(),
      "--no-check-certificates",
      "--http-chunk-size",
      "10M",
      "--concurrent-fragments",
      "4",
      "--no-part",
      "--format",
      "bestaudio/best",
      "--output",
      "-",
      url,
    ];
    const child = spawn(YT_DLP_PATH, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.on("error", (e) =>
      console.error("Failed to start yt-dlp:", e.message),
    );
    child.stderr.on("data", (d) =>
      console.error("yt-dlp:", d.toString().trim()),
    );
    return child;
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
  app.post("/api/song", async (req, res) => {
    const parsed = parseYouTubeUrl(req.body?.url);
    if (!parsed)
      return res.status(400).json({ error: "A valid YouTube URL is required" });
    try {
      // Always start the full lookup in the background so it is cached by the time the user clicks Download.
      const full = getMeta(parsed.id, parsed.url);
      full.catch(() => {});

      const cached = metaCache.get(parsed.id);
      let m;
      if (cached && cached.exp > Date.now()) {
        m = cached.meta;
      } else {
        try {
          const o = await fetchOEmbed(parsed.url); // fast path for the preview card
          m = {
            title: o.title || "",
            singer: o.author_name || "Unknown Artist",
            channel: o.author_name || "Unknown Channel",
            album: "",
            duration: 0,
            cover: o.thumbnail_url || "",
            releaseYear: "",
          };
          if (!m.title) m = await full;
        } catch {
          m = await full; // oEmbed failed: wait for the full lookup
        }
      }
      res.json({
        song_name: m.title,
        singer: m.singer,
        channel: m.channel,
        album: m.album,
        duration: m.duration,
        cover: m.cover,
        releaseYear: m.releaseYear,
      });
    } catch (e) {
      console.error("SONG METADATA ERROR:", e.message);
      res.status(500).json({ error: "Could not retrieve video information" });
    }
  });

  // PHASE 1: register a download job (fast)
  app.post("/api/download", async (req, res) => {
    const parsed = parseYouTubeUrl(req.body?.url);
    const quality = String(req.body?.quality);
    if (!parsed)
      return res.status(400).json({ error: "A valid YouTube URL is required" });
    if (quality !== "128" && quality !== "320") {
      return res.status(400).json({ error: "Invalid quality" });
    }
    try {
      getMeta(parsed.id, parsed.url).catch(() => {}); // warm cache (usually already done)
      const downloadId = crypto.randomUUID();
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

  // PHASE 2: convert + send the file
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

    const { videoId, url, quality } = job;
    const outPath = path.join(TEMP_DIR, `${id}.mp3`);
    const coverPath = path.join(TEMP_DIR, `${id}.jpg`);
    let downloadName = "audio.mp3";

    let aborted = false;
    let ytProc = null;
    let command = null;
    res.on("close", () => {
      if (res.writableFinished) return;
      aborted = true; // client left: stop all work
      if (ytProc) ytProc.kill("SIGKILL");
      if (command) {
        try {
          command.kill("SIGKILL");
        } catch {}
      }
    });

    let acquired = false;
    try {
      await limiter.acquire();
      acquired = true;
      if (aborted) throw new Error("Client disconnected");

      // Start downloading audio while cover art is prepared in parallel.
      ytProc = startAudioProcess(url); // download starts immediately...
      const meta = await getMeta(videoId, url); // ...while metadata (usually cached) resolves
      downloadName = `${safeFileName(meta.title)} [${quality}kbps].mp3`;
      const hasCover = await prepareCover(videoId, coverPath, meta.squareCover);
      if (aborted) throw new Error("Client disconnected");

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
          `artist=${clean(meta.singer)}`,
          "-metadata",
          `album=${clean(meta.album) || "YouTube Downloads"}`,
          "-metadata",
          `album_artist=${clean(meta.singer)}`,
          "-metadata",
          "genre=Music",
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
        command = ff;

        ytProc.stdout.pipe(ff.stdin);
        ff.stdin.on("error", () => {}); // ffmpeg may close stdin early
        ytProc.stdout.on("error", () => {});

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
            new Error(`ffmpeg exited with code ${code}: ${errTail.trim()}`),
          );
        });
      });

      limiter.release(); // free CPU slot before streaming the file to the client
      acquired = false;
      setProgress(id, 100);

      if (aborted) throw new Error("Client disconnected");

      const stat = await fs.promises.stat(outPath);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", stat.size);
      res.setHeader("X-Download-ID", id);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="song.mp3"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      );
      await pipeline(fs.createReadStream(outPath), res);
    } catch (e) {
      if (!aborted) console.error("Streaming error:", e.message);
      setProgress(id, -1);
      if (!res.headersSent) res.status(500).send("Audio compilation failed.");
      else res.destroy();
    } finally {
      if (acquired) limiter.release();
      if (ytProc) ytProc.kill("SIGKILL");
      await rm(outPath, coverPath);
      setTimeout(() => lastProgress.delete(id), 60_000).unref();
    }
  });

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
