import { useEffect, useRef, useState } from "react";
import "./App.css";

const API_URL =
  import.meta.env.VITE_API_URL || "https://youtube-to-mp3-rhww.onrender.com";

const YT_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
];
const EMPTY_SONG = {
  title: "",
  artist: "",
  thumbnail: "",
  album: "",
  year: "",
  composer: "",
  duration: 0,
};
const QUALITIES = [
  { value: "128", title: "128 kbps", note: "Smaller file" },
  { value: "320", title: "320 kbps", note: "Best quality" },
];
const STEPS = ["Prepare", "Convert", "Save"];
const STEP_OF = { preparing: 0, converting: 1, saving: 2 };

const glass =
  "border border-white/90 bg-white/60 backdrop-blur-2xl shadow-[0_25px_80px_rgba(30,30,60,0.08)]";
const gradient = "bg-gradient-to-r from-red-500 via-pink-500 to-purple-500";

const isValidYouTubeUrl = (v) => {
  try {
    return YT_HOSTS.includes(new URL(v).hostname);
  } catch {
    return false;
  }
};

const toSong = (d) => ({
  title: d.song_name || "",
  artist: d.artist || d.singer || "",
  thumbnail: d.cover || "",
  album: d.album || "",
  year: d.releaseYear || "",
  composer: d.composer || "",
  duration: Number(d.duration) || 0,
});

const fmtDuration = (s) =>
  s
    ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`
    : "";
const fmtMB = (b) => (b / 1048576).toFixed(1);
const sanitize = (n) =>
  n
    .replace(/[\/\\:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

async function postJson(path, body, signal) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

const Spinner = ({ className = "h-4 w-4" }) => (
  <span
    className={`inline-block animate-spin rounded-full border-2 border-current/30 border-t-current ${className}`}
  />
);

function SongSkeleton() {
  return (
    <div
      className={`${glass} mx-auto mt-8 max-w-3xl animate-pulse rounded-[32px] p-5`}
      aria-hidden="true"
    >
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="mx-auto h-52 w-52 shrink-0 rounded-[24px] bg-slate-200/70 sm:mx-0" />
        <div className="flex-1 space-y-3 self-center">
          <div className="h-7 w-4/5 rounded-lg bg-slate-200/70" />
          <div className="h-4 w-2/5 rounded-lg bg-slate-200/70" />
          <div className="h-3 w-1/3 rounded-lg bg-slate-200/70" />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [url, setUrl] = useState("");
  const [quality, setQuality] = useState(
    () => localStorage.getItem("quality") || "128",
  );
  const [song, setSong] = useState(EMPTY_SONG);
  const [error, setError] = useState("");
  const [loadingSong, setLoadingSong] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | preparing | converting | saving
  const [progress, setProgress] = useState(0);
  const [savedBytes, setSavedBytes] = useState({ got: 0, total: 0 });
  const [downloadId, setDownloadId] = useState(null);
  const [done, setDone] = useState(false);

  const songRun = useRef(0);
  const abortRef = useRef(null);
  const busy = phase !== "idle";

  useEffect(() => localStorage.setItem("quality", quality), [quality]);

  // Live conversion progress (server-sent events)
  useEffect(() => {
    if (!downloadId) return;
    const es = new EventSource(`${API_URL}/api/progress/${downloadId}`);
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        const p = Number(d.progress) || 0;
        if (p > 0) {
          setProgress(p);
          setPhase((cur) => (cur === "preparing" ? "converting" : cur));
        }
        if (p >= 100 || d.error) es.close();
      } catch {}
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [downloadId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // ---- song lookup ------------------------------------------------------------
  const loadDetails = async (videoUrl, run) => {
    setLoadingDetails(true);
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline && run === songRun.current) {
      await new Promise((r) => setTimeout(r, 2500));
      if (run !== songRun.current) return;
      try {
        const d = await postJson("/api/song-details", { url: videoUrl });
        if (d.ready) {
          setSong(toSong(d));
          break;
        }
        if (d.failed) break;
      } catch {}
    }
    if (run === songRun.current) setLoadingDetails(false);
  };

  const findSong = async (raw = url) => {
    const clean = raw.trim();
    setError("");
    if (!clean) return setError("Paste a YouTube link to continue.");
    if (!isValidYouTubeUrl(clean))
      return setError(
        "That doesn't look like a YouTube link. Copy it from the address bar or the Share button.",
      );

    const run = ++songRun.current;
    setLoadingSong(true);
    setLoadingDetails(false);
    setDone(false);
    setProgress(0);
    setSong(EMPTY_SONG);
    try {
      const data = await postJson("/api/song", { url: clean });
      if (run !== songRun.current) return;
      setSong(toSong(data));
      if (!data.detailsReady) loadDetails(clean, run);
    } catch (err) {
      if (run === songRun.current)
        setError(
          err.message ||
            "Couldn't load this video. Check the link and try again.",
        );
    } finally {
      if (run === songRun.current) setLoadingSong(false);
    }
  };

  const handleChange = (e) => {
    songRun.current++;
    setUrl(e.target.value);
    setError("");
    setLoadingSong(false);
    setLoadingDetails(false);
    if (song.title) setSong(EMPTY_SONG);
    setDone(false);
  };

  const handlePaste = (e) => {
    const text = e.clipboardData?.getData("text") || "";
    if (isValidYouTubeUrl(text.trim())) {
      e.preventDefault();
      setUrl(text.trim());
      findSong(text);
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      setUrl(text);
      findSong(text);
    } catch {
      setError(
        "Couldn't read the clipboard. Paste the link into the box instead.",
      );
    }
  };

  // ---- download -----------------------------------------------------------------
  const startDownload = async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError("");
    setDone(false);
    setProgress(0);
    setSavedBytes({ got: 0, total: 0 });
    setPhase("preparing");

    try {
      const { downloadId: id } = await postJson(
        "/api/download",
        { url: url.trim(), quality },
        ctrl.signal,
      );
      setDownloadId(id);

      const res = await fetch(
        `${API_URL}/api/download-file?id=${encodeURIComponent(id)}`,
        { signal: ctrl.signal },
      );
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(
          res.status === 503
            ? "The converter is busy right now. Try again in a few seconds."
            : msg ||
                "Conversion failed. YouTube may be blocking this video. Try again or pick another.",
        );
      }

      setPhase("saving");
      setProgress(100);

      // Read the file with byte progress
      const total = Number(res.headers.get("Content-Length")) || 0;
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        chunks.push(value);
        got += value.length;
        setSavedBytes({ got, total });
      }
      if (!got) throw new Error("The MP3 came back empty. Please try again.");

      // Use the server's "Artist - Title" file name when available
      const cd = res.headers.get("Content-Disposition") || "";
      const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
      const fileName = star
        ? decodeURIComponent(star[1])
        : `${sanitize(song.title || "YouTube Audio")}-${quality}kbps.mp3`;

      const blobUrl = URL.createObjectURL(
        new Blob(chunks, { type: "audio/mpeg" }),
      );
      const a = Object.assign(document.createElement("a"), {
        href: blobUrl,
        download: fileName,
      });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
      setDone(true);
    } catch (err) {
      setError(
        err.name === "AbortError"
          ? "Download cancelled."
          : err.message || "Something went wrong while downloading.",
      );
    } finally {
      setPhase("idle");
      setDownloadId(null);
      abortRef.current = null;
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    songRun.current++;
    setUrl("");
    setSong(EMPTY_SONG);
    setError("");
    setProgress(0);
    setDone(false);
    setLoadingSong(false);
    setLoadingDetails(false);
  };

  const meta = [song.album, song.year, fmtDuration(song.duration)]
    .filter(Boolean)
    .join(" · ");
  const step = STEP_OF[phase] ?? 0;
  const barPct =
    phase === "saving" && savedBytes.total
      ? (savedBytes.got / savedBytes.total) * 100
      : phase === "saving"
        ? 100
        : progress;
  const statusText = {
    preparing:
      "Contacting YouTube. The first request can take a little longer.",
    converting: "Converting to MP3 and adding artwork and tags.",
    saving: savedBytes.total
      ? `Receiving file: ${fmtMB(savedBytes.got)} of ${fmtMB(savedBytes.total)} MB`
      : "Receiving file…",
  }[phase];

  return (
    <div className="min-h-screen bg-[#f8f9fc] text-slate-900">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-[500px] w-[500px] rounded-full bg-red-300/15 blur-[120px]" />
        <div className="absolute -right-40 top-20 h-[500px] w-[500px] rounded-full bg-pink-300/15 blur-[130px]" />
      </div>

      <header className="border-b border-white/70 bg-white/50 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-4">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl ${gradient} text-white shadow-lg shadow-red-200`}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight">
            YouTube<span className="text-red-500">MP3</span>
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 pb-24">
        <section className="pt-16 text-center sm:pt-24">
          <h1 className="mx-auto max-w-3xl text-4xl font-black leading-[1.05] tracking-[-0.035em] sm:text-6xl">
            Turn a YouTube link into a tagged MP3
          </h1>
          <p className="mx-auto mt-5 max-w-lg text-sm leading-7 text-slate-500 sm:text-base">
            Paste a link. You get the file with artist, title, album and cover
            art already filled in.
          </p>
        </section>

        {/* LINK INPUT */}
        <section className="mx-auto mt-9 max-w-3xl">
          <div className={`${glass} rounded-[28px] p-3`}>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <label htmlFor="yt-url" className="sr-only">
                  YouTube link
                </label>
                <input
                  id="yt-url"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  value={url}
                  onChange={handleChange}
                  onPaste={handlePaste}
                  onKeyDown={(e) => e.key === "Enter" && findSong()}
                  placeholder="https://www.youtube.com/watch?v=…"
                  className="h-16 w-full rounded-[20px] border border-white bg-white/70 pl-5 pr-24 text-sm font-medium outline-none transition placeholder:text-slate-400 focus:border-red-200 focus:ring-4 focus:ring-red-100/70"
                />
                <button
                  type="button"
                  onClick={pasteFromClipboard}
                  disabled={busy}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-600 transition hover:border-red-200 hover:text-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400 disabled:opacity-50"
                >
                  Paste
                </button>
              </div>
              <button
                onClick={() => findSong()}
                disabled={loadingSong || busy}
                className={`h-16 rounded-[20px] ${gradient} px-8 font-bold text-white shadow-lg shadow-red-200/70 transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {loadingSong ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner /> Finding
                  </span>
                ) : (
                  "Find song"
                )}
              </button>
            </div>
          </div>

          <div aria-live="polite">
            {error && (
              <div
                role="alert"
                className="mt-4 flex items-start justify-between gap-3 rounded-2xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm font-medium text-red-600"
              >
                <span>{error}</span>
                {song.title && !busy && (
                  <button
                    onClick={startDownload}
                    className="shrink-0 font-bold underline underline-offset-2"
                  >
                    Try again
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        {loadingSong && !song.title && <SongSkeleton />}

        {/* SONG CARD */}
        {song.title && (
          <section
            className={`${glass} mx-auto mt-8 max-w-3xl rounded-[32px] p-5`}
          >
            <div className="flex flex-col gap-6 sm:flex-row">
              <div className="mx-auto h-52 w-52 shrink-0 overflow-hidden rounded-[24px] bg-slate-100 shadow-[0_20px_50px_rgba(30,30,60,0.14)] sm:mx-0">
                {song.thumbnail ? (
                  <img
                    src={song.thumbnail}
                    alt={`Cover art for ${song.title}`}
                    className="h-full w-full object-cover"
                    onError={(e) => (e.currentTarget.style.display = "none")}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-red-100 via-pink-100 to-purple-100 text-6xl text-red-400">
                    ♫
                  </div>
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col justify-center">
                <h2 className="line-clamp-3 text-2xl font-black leading-tight tracking-tight">
                  {song.title}
                </h2>
                <p className="mt-2 text-base font-semibold text-slate-600">
                  {song.artist || "Unknown artist"}
                </p>

                {loadingDetails ? (
                  <p className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                    <Spinner className="h-3 w-3" /> Looking up album and
                    credits…
                  </p>
                ) : (
                  meta && <p className="mt-2 text-sm text-slate-400">{meta}</p>
                )}
                {song.composer && (
                  <p className="mt-1 text-sm text-slate-400">
                    Music by {song.composer}
                  </p>
                )}
              </div>
            </div>

            {/* QUALITY */}
            <fieldset className="mt-7" disabled={busy}>
              <legend className="mb-3 text-sm font-bold text-slate-800">
                Audio quality
              </legend>
              <div className="grid grid-cols-2 gap-3">
                {QUALITIES.map((q) => {
                  const active = quality === q.value;
                  return (
                    <label
                      key={q.value}
                      className={`flex cursor-pointer items-center justify-between rounded-[20px] border p-4 transition has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-red-400 ${
                        active
                          ? "border-red-300 bg-red-50/80"
                          : "border-white/80 bg-white/50 hover:bg-white/80"
                      } ${busy ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      <input
                        type="radio"
                        name="quality"
                        value={q.value}
                        checked={active}
                        onChange={() => setQuality(q.value)}
                        className="sr-only"
                      />
                      <span>
                        <span
                          className={`block font-bold ${active ? "text-red-600" : "text-slate-700"}`}
                        >
                          {q.title}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-400">
                          {q.note}
                        </span>
                      </span>
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full border ${active ? "border-red-500 bg-red-500" : "border-slate-300"}`}
                      >
                        {active && (
                          <span className="h-2 w-2 rounded-full bg-white" />
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {/* PROGRESS */}
            {busy && (
              <div
                className="mt-6 rounded-[22px] border border-white/90 bg-white/60 p-5"
                aria-live="polite"
              >
                <ol className="mb-4 flex items-center gap-2 text-xs font-semibold">
                  {STEPS.map((label, i) => (
                    <li key={label} className="flex flex-1 items-center gap-2">
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${i < step ? "bg-emerald-500 text-white" : i === step ? `${gradient} text-white` : "bg-slate-200 text-slate-500"}`}
                      >
                        {i < step ? "✓" : i + 1}
                      </span>
                      <span
                        className={
                          i === step ? "text-slate-800" : "text-slate-400"
                        }
                      >
                        {label}
                      </span>
                      {i < STEPS.length - 1 && (
                        <span className="h-px flex-1 bg-slate-200" />
                      )}
                    </li>
                  ))}
                </ol>

                <div
                  className="h-2.5 overflow-hidden rounded-full bg-slate-200/70"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(barPct)}
                >
                  {phase === "preparing" ? (
                    <div
                      className={`h-full w-1/3 animate-pulse rounded-full ${gradient}`}
                    />
                  ) : (
                    <div
                      className={`h-full rounded-full ${gradient} transition-all duration-500`}
                      style={{ width: `${Math.min(barPct, 100)}%` }}
                    />
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">{statusText}</p>
                  <div className="flex items-center gap-3">
                    {phase !== "preparing" && (
                      <span className="text-sm font-black text-red-500">
                        {Math.round(barPct)}%
                      </span>
                    )}
                    <button
                      onClick={() => abortRef.current?.abort()}
                      className="text-xs font-bold text-slate-500 underline underline-offset-2 hover:text-red-500"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ACTIONS */}
            {!busy && !done && (
              <button
                onClick={startDownload}
                className={`mt-6 flex h-16 w-full items-center justify-center gap-3 rounded-[22px] ${gradient} font-bold text-white shadow-xl shadow-red-200/60 transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500`}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 3v12" />
                  <path d="m7 10 5 5 5-5" />
                  <path d="M5 21h14" />
                </svg>
                Download MP3
              </button>
            )}

            {done && !busy && (
              <div className="mt-6">
                <div className="rounded-[20px] border border-emerald-100 bg-emerald-50/80 p-4 text-center">
                  <p className="font-bold text-emerald-700">
                    Saved to your downloads
                  </p>
                  <p className="mt-1 text-xs text-emerald-600/80">
                    If nothing appeared, check your browser's download
                    permissions.
                  </p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <button
                    onClick={startDownload}
                    className="rounded-[16px] border border-white bg-white/70 py-3.5 text-sm font-bold text-slate-700 transition hover:bg-white"
                  >
                    Download again
                  </button>
                  <button
                    onClick={reset}
                    className="rounded-[16px] bg-slate-900 py-3.5 text-sm font-bold text-white transition hover:bg-slate-800"
                  >
                    Convert another
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        <p className="mt-16 text-center text-xs text-slate-400">
          Only convert videos you have the right to download.
        </p>
      </main>
    </div>
  );
}
