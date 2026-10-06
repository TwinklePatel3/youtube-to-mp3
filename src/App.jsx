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
  {
    value: "128",
    title: "128 kbps",
    note: "Smaller file",
    badge: "Light",
  },
  {
    value: "320",
    title: "320 kbps",
    note: "Higher quality",
    badge: "Hi-Fi",
  },
];

const STEPS = ["Prepare", "Convert", "Save"];
const STEP_OF = {
  preparing: 0,
  converting: 1,
  saving: 2,
};

const FEATURES = [
  {
    title: "Cover artwork",
    text: "Embedded in the MP3",
  },
  {
    title: "Music tags",
    text: "Artist, album & title",
  },
  {
    title: "Two qualities",
    text: "128 or 320 kbps",
  },
];

const glass =
  "border border-white/80 bg-white/65 backdrop-blur-2xl shadow-[0_24px_80px_rgba(60,40,120,0.10),inset_0_1px_0_rgba(255,255,255,0.95)]";

const gradient = "bg-gradient-to-r from-red-500 via-pink-500 to-purple-500";

const isValidYouTubeUrl = (value) => {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return YT_HOSTS.includes(hostname);
  } catch {
    return false;
  }
};

const toSong = (data) => ({
  title: data.song_name || "",
  artist: data.artist || data.singer || "",
  thumbnail: data.cover || "",
  album: data.album || "",
  year: data.releaseYear || "",
  composer: data.composer || "",
  duration: Number(data.duration) || 0,
});

const fmtDuration = (seconds) =>
  seconds
    ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(
        2,
        "0",
      )}`
    : "";

const fmtMB = (bytes) => (bytes / 1048576).toFixed(1);

const sanitize = (name) =>
  name
    .replace(/[\/\\:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

async function postJson(path, body, signal) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong. Please try again.");
  }

  return data;
}

/* -------------------------------------------------------------------------- */
/* ICONS                                                                       */
/* -------------------------------------------------------------------------- */

const Icon = ({ children, size = 20, className = "", strokeWidth = 1.8 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
);

const LinkIcon = ({ size = 20 }) => (
  <Icon size={size}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </Icon>
);

const PasteIcon = ({ size = 16 }) => (
  <Icon size={size}>
    <rect x="8" y="4" width="12" height="16" rx="2" />
    <path d="M16 4V3a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h3" />
  </Icon>
);

const ArrowRightIcon = ({ size = 18 }) => (
  <Icon size={size}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </Icon>
);

const DownloadIcon = ({ size = 20 }) => (
  <Icon size={size}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </Icon>
);

const CheckIcon = ({ size = 18 }) => (
  <Icon size={size} strokeWidth={2.4}>
    <path d="m5 12 4 4L19 6" />
  </Icon>
);

const MusicIcon = ({ size = 22 }) => (
  <Icon size={size}>
    <path d="M9 18V5l10-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="16" cy="16" r="3" />
  </Icon>
);

const SparkleIcon = ({ size = 16 }) => (
  <Icon size={size}>
    <path d="m12 3-1.2 4.2L7 8.5l3.8 1.3L12 14l1.2-4.2L17 8.5l-3.8-1.3L12 3Z" />
    <path d="m19 14-.6 2.1-2 .7 2 .7.6 2.1.6-2.1 2-.7-2-.7L19 14Z" />
  </Icon>
);

const ShieldIcon = ({ size = 17 }) => (
  <Icon size={size}>
    <path d="M12 3 5 6v5c0 4.4 2.9 8.3 7 10 4.1-1.7 7-5.6 7-10V6l-7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);

const XIcon = ({ size = 16 }) => (
  <Icon size={size}>
    <path d="m6 6 12 12" />
    <path d="m18 6-12 12" />
  </Icon>
);

/* -------------------------------------------------------------------------- */
/* LOGO                                                                         */
/* -------------------------------------------------------------------------- */

const Logo = ({ size = 42 }) => (
  <div
    className="relative shrink-0 overflow-hidden rounded-[15px] shadow-[0_10px_30px_rgba(236,72,153,0.22)]"
    style={{ width: size, height: size }}
  >
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      className="relative z-10"
    >
      <defs>
        <linearGradient id="logo-main" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ef4444" />
          <stop offset=".48" stopColor="#ec4899" />
          <stop offset="1" stopColor="#9333ea" />
        </linearGradient>

        <linearGradient id="logo-light" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".62" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".08" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect x="2" y="2" width="60" height="60" rx="17" fill="url(#logo-main)" />

      <rect
        x="2"
        y="2"
        width="60"
        height="30"
        rx="17"
        fill="url(#logo-light)"
      />

      <rect
        x="3"
        y="3"
        width="58"
        height="58"
        rx="16"
        fill="none"
        stroke="white"
        strokeOpacity=".5"
      />

      <path
        d="M27 17v27.5c0 3.8-3.4 6.5-7 6.5-3.3 0-5.5-1.7-5.5-4.3 0-3.1 2.9-5.4 6.8-5.4 1.2 0 2.2.2 3.2.6V20.2l20-4.2v20.5c0 3.8-3.4 6.5-7 6.5-3.3 0-5.5-1.7-5.5-4.3 0-3.1 2.9-5.4 6.8-5.4 1.2 0 2.2.2 3.2.6V22l-15 3.2V17h-5Z"
        fill="white"
      />
    </svg>
  </div>
);

/* -------------------------------------------------------------------------- */
/* SMALL COMPONENTS                                                            */
/* -------------------------------------------------------------------------- */

const Spinner = ({ className = "h-4 w-4" }) => (
  <span
    className={`inline-block animate-spin rounded-full border-2 border-current/25 border-t-current ${className}`}
  />
);

function FeaturePill({ children }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/90 bg-white/65 px-3.5 py-2 text-xs font-semibold text-slate-500 shadow-sm backdrop-blur-xl">
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
        <CheckIcon size={10} />
      </span>
      {children}
    </span>
  );
}

function SongSkeleton() {
  return (
    <div
      className={`${glass} mx-auto mt-8 max-w-3xl overflow-hidden rounded-[32px] p-5`}
      aria-hidden="true"
    >
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="mx-auto h-56 w-56 shrink-0 animate-pulse rounded-[26px] bg-slate-200/70 sm:mx-0" />

        <div className="flex flex-1 flex-col justify-center space-y-4">
          <div className="h-3 w-24 animate-pulse rounded-full bg-slate-200/70" />
          <div className="h-8 w-4/5 animate-pulse rounded-xl bg-slate-200/70" />
          <div className="h-4 w-2/5 animate-pulse rounded-full bg-slate-200/70" />
          <div className="h-3 w-1/3 animate-pulse rounded-full bg-slate-200/70" />
        </div>
      </div>
    </div>
  );
}

function QualityCard({ quality, active, busy, onChange }) {
  return (
    <label
      className={`group relative cursor-pointer overflow-hidden rounded-[22px] border p-4 transition-all duration-300 ${
        active
          ? "border-pink-300 bg-gradient-to-br from-pink-50/95 via-white/80 to-purple-50/80 shadow-[0_14px_40px_rgba(236,72,153,0.14)]"
          : "border-white/80 bg-white/45 hover:-translate-y-0.5 hover:bg-white/75 hover:shadow-lg"
      } ${busy ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <input
        type="radio"
        name="quality"
        value={quality.value}
        checked={active}
        onChange={() => onChange(quality.value)}
        className="sr-only"
        disabled={busy}
      />

      {active && (
        <div className="absolute right-0 top-0 h-16 w-16 rounded-bl-[40px] bg-gradient-to-br from-pink-200/30 to-purple-200/20" />
      )}

      <div className="relative flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`text-base font-black ${
                active ? "text-pink-600" : "text-slate-800"
              }`}
            >
              {quality.title}
            </span>

            {active && (
              <span className="rounded-full bg-pink-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-pink-600">
                Selected
              </span>
            )}
          </div>

          <p className="mt-1 text-xs font-medium text-slate-400">
            {quality.note}
          </p>
        </div>

        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition ${
            active
              ? "border-pink-400 bg-pink-500 text-white shadow-md shadow-pink-500/25"
              : "border-slate-300 bg-white/70 text-transparent"
          }`}
        >
          <CheckIcon size={13} />
        </span>
      </div>

      <div className="relative mt-4 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
          MP3 Audio
        </span>

        <span
          className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-wider ${
            active ? "bg-white/80 text-pink-500" : "bg-slate-100 text-slate-400"
          }`}
        >
          {quality.badge}
        </span>
      </div>
    </label>
  );
}

function Stepper({ currentStep }) {
  return (
    <ol className="flex items-center">
      {STEPS.map((label, index) => {
        const complete = index < currentStep;
        const active = index === currentStep;

        return (
          <li key={label} className="flex min-w-0 flex-1 items-center">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-black transition-all ${
                  complete
                    ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/20"
                    : active
                      ? `${gradient} text-white shadow-md shadow-pink-500/20`
                      : "bg-slate-100 text-slate-400"
                }`}
              >
                {complete ? <CheckIcon size={13} /> : index + 1}
              </span>

              <span
                className={`hidden text-[11px] font-bold sm:block ${
                  active
                    ? "text-slate-800"
                    : complete
                      ? "text-emerald-600"
                      : "text-slate-400"
                }`}
              >
                {label}
              </span>
            </div>

            {index < STEPS.length - 1 && (
              <div
                className={`mx-2 h-px flex-1 transition-colors ${
                  index < currentStep ? "bg-emerald-300" : "bg-slate-200"
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Visualizer({ active = false }) {
  return (
    <div className="flex h-6 items-center gap-[3px]">
      {[0.45, 0.8, 1, 0.65, 0.9, 0.55, 0.75].map((height, index) => (
        <span
          key={index}
          className={`w-[3px] rounded-full transition-all ${
            active ? gradient : "bg-slate-300"
          }`}
          style={{
            height: `${Math.max(6, height * 22)}px`,
            animation: active
              ? `musicBar ${0.7 + index * 0.08}s ease-in-out infinite alternate`
              : "none",
          }}
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* APP                                                                          */
/* -------------------------------------------------------------------------- */

export default function App() {
  const [url, setUrl] = useState("");

  const [quality, setQuality] = useState(
    () => localStorage.getItem("quality") || "128",
  );

  const [song, setSong] = useState(EMPTY_SONG);
  const [error, setError] = useState("");
  const [loadingSong, setLoadingSong] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const [phase, setPhase] = useState("idle");
  const [progress, setProgress] = useState(0);

  const [savedBytes, setSavedBytes] = useState({
    got: 0,
    total: 0,
  });

  const [downloadId, setDownloadId] = useState(null);
  const [done, setDone] = useState(false);

  const songRun = useRef(0);
  const abortRef = useRef(null);

  const busy = phase !== "idle";

  useEffect(() => {
    localStorage.setItem("quality", quality);
  }, [quality]);

  /* ------------------------------------------------------------------------ */
  /* SERVER-SENT PROGRESS                                                     */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (!downloadId) return;

    const es = new EventSource(`${API_URL}/api/progress/${downloadId}`);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const currentProgress = Number(data.progress) || 0;

        if (currentProgress > 0) {
          setProgress(currentProgress);

          setPhase((current) =>
            current === "preparing" ? "converting" : current,
          );
        }

        if (currentProgress >= 100 || data.error) {
          es.close();
        }
      } catch {
        // Ignore malformed SSE messages.
      }
    };

    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, [downloadId]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  /* ------------------------------------------------------------------------ */
  /* SONG LOOKUP                                                              */
  /* ------------------------------------------------------------------------ */

  const loadDetails = async (videoUrl, run) => {
    setLoadingDetails(true);

    const deadline = Date.now() + 90000;

    while (Date.now() < deadline && run === songRun.current) {
      await new Promise((resolve) => setTimeout(resolve, 2500));

      if (run !== songRun.current) return;

      try {
        const data = await postJson("/api/song-details", {
          url: videoUrl,
        });

        if (data.ready) {
          setSong(toSong(data));
          break;
        }

        if (data.failed) break;
      } catch {
        // Keep polling.
      }
    }

    if (run === songRun.current) {
      setLoadingDetails(false);
    }
  };

  const findSong = async (raw = url) => {
    const clean = raw.trim();

    setError("");

    if (!clean) {
      setError("Paste a YouTube link to continue.");
      return;
    }

    if (!isValidYouTubeUrl(clean)) {
      setError(
        "That doesn't look like a YouTube link. Copy it from the address bar or the Share button.",
      );
      return;
    }

    const run = ++songRun.current;

    setLoadingSong(true);
    setLoadingDetails(false);
    setDone(false);
    setProgress(0);
    setSong(EMPTY_SONG);

    try {
      const data = await postJson("/api/song", {
        url: clean,
      });

      if (run !== songRun.current) return;

      setSong(toSong(data));

      if (!data.detailsReady) {
        loadDetails(clean, run);
      }
    } catch (err) {
      if (run === songRun.current) {
        setError(
          err.message ||
            "Couldn't load this video. Check the link and try again.",
        );
      }
    } finally {
      if (run === songRun.current) {
        setLoadingSong(false);
      }
    }
  };

  const handleChange = (event) => {
    songRun.current++;

    setUrl(event.target.value);
    setError("");
    setLoadingSong(false);
    setLoadingDetails(false);
    setDone(false);

    if (song.title) {
      setSong(EMPTY_SONG);
    }
  };

  const handlePaste = (event) => {
    const text = event.clipboardData?.getData("text") || "";

    if (isValidYouTubeUrl(text.trim())) {
      event.preventDefault();

      const clean = text.trim();

      setUrl(clean);
      findSong(clean);
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();

      if (!text) {
        setError("Your clipboard doesn't contain a link.");
        return;
      }

      setUrl(text);
      findSong(text);
    } catch {
      setError(
        "Couldn't read the clipboard. Paste the link into the box instead.",
      );
    }
  };

  /* ------------------------------------------------------------------------ */
  /* DOWNLOAD                                                                  */
  /* ------------------------------------------------------------------------ */

  const startDownload = async () => {
    const controller = new AbortController();

    abortRef.current = controller;

    setError("");
    setDone(false);
    setProgress(0);
    setSavedBytes({
      got: 0,
      total: 0,
    });

    setPhase("preparing");

    try {
      const { downloadId: id } = await postJson(
        "/api/download",
        {
          url: url.trim(),
          quality,
        },
        controller.signal,
      );

      setDownloadId(id);

      const response = await fetch(
        `${API_URL}/api/download-file?id=${encodeURIComponent(id)}`,
        {
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const message = await response.text().catch(() => "");

        throw new Error(
          response.status === 503
            ? "The converter is busy right now. Try again in a few seconds."
            : message ||
                "Conversion failed. YouTube may be blocking this video. Try again or pick another.",
        );
      }

      setPhase("saving");
      setProgress(100);

      const total = Number(response.headers.get("Content-Length")) || 0;

      const reader = response.body.getReader();

      const chunks = [];
      let received = 0;

      for (;;) {
        const { done: finished, value } = await reader.read();

        if (finished) break;

        chunks.push(value);

        received += value.length;

        setSavedBytes({
          got: received,
          total,
        });
      }

      if (!received) {
        throw new Error("The MP3 came back empty. Please try again.");
      }

      const contentDisposition =
        response.headers.get("Content-Disposition") || "";

      const encodedFilename = contentDisposition.match(
        /filename\*=UTF-8''([^;]+)/i,
      );

      const normalFilename = contentDisposition.match(/filename="([^"]+)"/i);

      let fileName;

      if (encodedFilename) {
        try {
          fileName = decodeURIComponent(encodedFilename[1]);
        } catch {
          fileName = encodedFilename[1];
        }
      } else if (normalFilename) {
        fileName = normalFilename[1];
      } else {
        fileName = `${sanitize(
          song.title || "YouTube Audio",
        )}-${quality}kbps.mp3`;
      }

      const blob = new Blob(chunks, {
        type: "audio/mpeg",
      });

      const blobUrl = URL.createObjectURL(blob);

      const anchor = Object.assign(document.createElement("a"), {
        href: blobUrl,
        download: fileName,
      });

      document.body.appendChild(anchor);

      anchor.click();

      anchor.remove();

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
    setPhase("idle");
    setSavedBytes({
      got: 0,
      total: 0,
    });
  };

  /* ------------------------------------------------------------------------ */
  /* DISPLAY VALUES                                                            */
  /* ------------------------------------------------------------------------ */

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

  const safeBarPct = Math.min(Math.max(barPct || 0, 0), 100);

  const statusText = {
    preparing:
      "Contacting YouTube. The first request can take a little longer.",
    converting: "Converting your audio and adding artwork & tags.",
    saving: savedBytes.total
      ? `Receiving file · ${fmtMB(savedBytes.got)} of ${fmtMB(savedBytes.total)} MB`
      : "Preparing your MP3 for download…",
  }[phase];

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#f7f7fb] text-slate-900 antialiased">
      <style>{`
        @keyframes drift {
          0%, 100% {
            transform: translate3d(0, 0, 0) scale(1);
          }
          50% {
            transform: translate3d(35px, 25px, 0) scale(1.1);
          }
        }

        @keyframes rise {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes shimmer {
          from {
            background-position: 200% 0;
          }
          to {
            background-position: -200% 0;
          }
        }

        @keyframes musicBar {
          from {
            transform: scaleY(.45);
          }
          to {
            transform: scaleY(1);
          }
        }

        @keyframes pulseGlow {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(236,72,153,.08);
          }
          50% {
            box-shadow: 0 0 0 8px rgba(236,72,153,.03);
          }
        }

        .rise {
          animation: rise .55s cubic-bezier(.2,.8,.2,1) both;
        }

        .shimmer {
          background-size: 200% 100%;
          animation: shimmer 2.2s linear infinite;
        }

        .pulse-glow {
          animation: pulseGlow 2s ease-in-out infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .rise,
          .shimmer,
          .pulse-glow,
          .drift {
            animation: none !important;
          }
        }
      `}</style>

      {/* ------------------------------------------------------------------ */}
      {/* BACKGROUND                                                          */}
      {/* ------------------------------------------------------------------ */}

      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div
          className="absolute -left-44 -top-48 h-[600px] w-[600px] rounded-full bg-red-300/30 blur-[145px]"
          style={{
            animation: "drift 18s ease-in-out infinite",
          }}
        />

        <div
          className="absolute -right-48 top-10 h-[620px] w-[620px] rounded-full bg-purple-300/30 blur-[155px]"
          style={{
            animation: "drift 22s ease-in-out infinite reverse",
          }}
        />

        <div
          className="absolute -bottom-60 left-[30%] h-[520px] w-[520px] rounded-full bg-pink-300/25 blur-[155px]"
          style={{
            animation: "drift 25s ease-in-out infinite",
          }}
        />

        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_35%,#f7f7fb_100%)]" />

        <div className="absolute inset-0 opacity-[0.035] [background-image:linear-gradient(#64748b_1px,transparent_1px),linear-gradient(90deg,#64748b_1px,transparent_1px)] [background-size:56px_56px]" />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* HEADER                                                              */}
      {/* ------------------------------------------------------------------ */}

      <header className="sticky top-0 z-30 border-b border-white/70 bg-white/55 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-3">
            <Logo />

            <div>
              <div className="text-[15px] font-black tracking-tight sm:text-lg">
                YouTube
                <span className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">
                  Audio
                </span>
              </div>

              <div className="hidden text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 sm:block">
                Simple · Fast · Beautiful
              </div>
            </div>
          </div>

          <div className="hidden items-center gap-2 rounded-full border border-white bg-white/60 px-3.5 py-2 text-[10px] font-bold text-slate-500 shadow-sm sm:flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            Ready to convert
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* MAIN                                                                */}
      {/* ------------------------------------------------------------------ */}

      <main className="mx-auto max-w-5xl px-5 pb-24">
        {/* HERO */}

        <section className="rise pt-14 text-center sm:pt-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/90 bg-white/65 px-4 py-2 text-[11px] font-bold text-slate-500 shadow-sm backdrop-blur-xl">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-purple-500 text-white">
              <SparkleIcon size={11} />
            </span>
            Free to use · No sign-up
          </div>

          <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-black leading-[1.02] tracking-[-0.055em] sm:text-6xl lg:text-7xl">
            Your music.
            <br />
            <span className={`bg-clip-text text-transparent ${gradient}`}>
              Your MP3.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-sm leading-7 text-slate-500 sm:text-base">
            Paste a YouTube link and turn it into a polished MP3 with artwork,
            title, artist and album information ready for your music library.
          </p>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* URL INPUT                                                         */}
        {/* ---------------------------------------------------------------- */}

        <section className="rise mx-auto mt-10 max-w-3xl [animation-delay:80ms]">
          <div
            className={`${glass} rounded-[30px] p-2.5 transition-all duration-300 focus-within:border-pink-300 focus-within:shadow-[0_0_0_5px_rgba(236,72,153,0.08),0_28px_80px_rgba(60,40,120,0.12)]`}
          >
            <div className="flex flex-col gap-2.5 sm:flex-row">
              <div className="relative flex-1">
                <label htmlFor="yt-url" className="sr-only">
                  YouTube link
                </label>

                <div className="pointer-events-none absolute left-5 top-1/2 z-10 -translate-y-1/2 text-slate-400">
                  <LinkIcon size={19} />
                </div>

                <input
                  id="yt-url"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  value={url}
                  onChange={handleChange}
                  onPaste={handlePaste}
                  onKeyDown={(event) => event.key === "Enter" && findSong()}
                  placeholder="Paste your YouTube link…"
                  className="h-[62px] w-full rounded-[22px] border border-white bg-white/80 pl-12 pr-24 text-sm font-semibold text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-pink-200 focus:bg-white"
                />

                <button
                  type="button"
                  onClick={pasteFromClipboard}
                  disabled={busy}
                  className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-full border border-slate-200/80 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-500 shadow-sm transition hover:border-pink-200 hover:text-pink-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <PasteIcon size={13} />
                  Paste
                </button>
              </div>

              <button
                onClick={() => findSong()}
                disabled={loadingSong || busy}
                className={`group flex h-[62px] items-center justify-center gap-2 rounded-[22px] ${gradient} px-7 font-black text-white shadow-[0_12px_30px_rgba(236,72,153,0.24)] transition-all duration-300 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_16px_36px_rgba(236,72,153,0.30)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {loadingSong ? (
                  <>
                    <Spinner />
                    Finding
                  </>
                ) : (
                  <>
                    Find song
                    <ArrowRightIcon
                      size={17}
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  </>
                )}
              </button>
            </div>
          </div>

          {!song.title && !loadingSong && (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <FeaturePill>Cover artwork</FeaturePill>
              <FeaturePill>Music tags</FeaturePill>
              <FeaturePill>128 / 320 kbps</FeaturePill>
            </div>
          )}

          {/* ERROR */}

          <div aria-live="polite">
            {error && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-3 rounded-[20px] border border-red-100 bg-red-50/80 px-4 py-3.5 text-sm font-medium text-red-600 shadow-sm"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-100 font-black text-red-500">
                  !
                </span>

                <span className="flex-1 leading-6">{error}</span>

                {song.title && !busy && (
                  <button
                    onClick={startDownload}
                    className="shrink-0 font-black text-red-700 underline underline-offset-2"
                  >
                    Try again
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        {loadingSong && !song.title && <SongSkeleton />}

        {/* ---------------------------------------------------------------- */}
        {/* SONG CARD                                                         */}
        {/* ---------------------------------------------------------------- */}

        {song.title && (
          <section
            className={`${glass} rise relative mx-auto mt-8 max-w-3xl overflow-hidden rounded-[34px] p-4 sm:p-6`}
          >
            {/* blurred artwork background */}

            {song.thumbnail && (
              <>
                <img
                  src={song.thumbnail}
                  alt=""
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-[0.13] blur-3xl"
                />

                <div className="pointer-events-none absolute inset-0 bg-white/60" />
              </>
            )}

            <div className="relative">
              {/* MEDIA INFO */}

              <div className="flex flex-col gap-6 sm:flex-row">
                {/* ARTWORK */}

                <div className="group relative mx-auto h-56 w-56 shrink-0 sm:mx-0">
                  <div className="absolute -inset-2 rounded-[30px] bg-gradient-to-br from-red-300/20 via-pink-300/20 to-purple-300/20 blur-xl transition-opacity group-hover:opacity-100" />

                  <div className="relative h-full w-full overflow-hidden rounded-[27px] bg-gradient-to-br from-red-100 via-pink-100 to-purple-100 shadow-[0_25px_60px_rgba(30,30,60,0.20)] ring-1 ring-white">
                    {song.thumbnail ? (
                      <img
                        src={song.thumbnail}
                        alt={`Cover art for ${song.title}`}
                        className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-pink-400">
                        <MusicIcon size={58} />
                      </div>
                    )}

                    <div className="pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-white/30 to-transparent" />

                    <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full border border-white/50 bg-black/25 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-white backdrop-blur-xl">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                      YouTube
                    </div>
                  </div>
                </div>

                {/* INFO */}

                <div className="flex min-w-0 flex-1 flex-col justify-center">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-pink-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.15em] text-pink-500">
                      <SparkleIcon size={10} />
                      Ready
                    </span>

                    <Visualizer active={!busy} />
                  </div>

                  <h2 className="line-clamp-3 text-[25px] font-black leading-[1.08] tracking-[-0.035em] text-slate-900 sm:text-3xl">
                    {song.title}
                  </h2>

                  <p className="mt-2 text-base font-bold text-slate-600">
                    {song.artist || "Unknown artist"}
                  </p>

                  {loadingDetails ? (
                    <p className="mt-3 flex items-center gap-2 text-xs font-medium text-slate-400">
                      <Spinner className="h-3 w-3" />
                      Looking up album and credits…
                    </p>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {song.album && (
                        <span className="rounded-full border border-white bg-white/70 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                          {song.album}
                        </span>
                      )}

                      {song.year && (
                        <span className="rounded-full border border-white bg-white/70 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                          {song.year}
                        </span>
                      )}

                      {song.duration > 0 && (
                        <span className="rounded-full border border-white bg-white/70 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                          {fmtDuration(song.duration)}
                        </span>
                      )}
                    </div>
                  )}

                  {song.composer && (
                    <p className="mt-3 text-xs font-medium text-slate-400">
                      Music by{" "}
                      <span className="font-bold text-slate-500">
                        {song.composer}
                      </span>
                    </p>
                  )}
                </div>
              </div>

              {/* DIVIDER */}

              <div className="my-6 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

              {/* QUALITY */}

              <fieldset disabled={busy}>
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div>
                    <legend className="text-sm font-black text-slate-800">
                      Audio quality
                    </legend>

                    <p className="mt-1 text-[11px] font-medium text-slate-400">
                      Choose the balance between size and quality.
                    </p>
                  </div>

                  <span className="hidden rounded-full border border-white bg-white/60 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-slate-400 sm:block">
                    MP3
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {QUALITIES.map((item) => (
                    <QualityCard
                      key={item.value}
                      quality={item}
                      active={quality === item.value}
                      busy={busy}
                      onChange={setQuality}
                    />
                  ))}
                </div>
              </fieldset>

              {/* ---------------------------------------------------------------- */}
              {/* PROGRESS                                                           */}
              {/* ---------------------------------------------------------------- */}

              {busy && (
                <div
                  className={`${glass} pulse-glow relative mt-5 rounded-[25px] bg-white/55 p-5`}
                  aria-live="polite"
                >
                  <Stepper currentStep={step} />

                  <div className="mt-5">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex h-7 w-7 items-center justify-center rounded-full ${
                            phase === "saving"
                              ? "bg-emerald-100 text-emerald-600"
                              : "bg-pink-100 text-pink-500"
                          }`}
                        >
                          {phase === "saving" ? (
                            <CheckIcon size={14} />
                          ) : (
                            <Spinner className="h-3.5 w-3.5" />
                          )}
                        </span>

                        <span className="text-xs font-black text-slate-700">
                          {phase === "preparing"
                            ? "Preparing"
                            : phase === "converting"
                              ? "Converting"
                              : "Saving"}
                        </span>
                      </div>

                      {phase !== "preparing" && (
                        <span className="text-sm font-black text-pink-500">
                          {Math.round(safeBarPct)}%
                        </span>
                      )}
                    </div>

                    <div
                      className="h-2.5 overflow-hidden rounded-full bg-slate-200/70"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(safeBarPct)}
                    >
                      {phase === "preparing" ? (
                        <div
                          className={`h-full w-1/3 rounded-full ${gradient}`}
                          style={{
                            animation: "shimmer 1.5s linear infinite",
                            backgroundSize: "200% 100%",
                          }}
                        />
                      ) : (
                        <div
                          className="shimmer h-full rounded-full bg-gradient-to-r from-red-500 via-pink-400 to-purple-500 transition-all duration-500"
                          style={{
                            width: `${safeBarPct}%`,
                          }}
                        />
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p className="min-w-0 text-[11px] font-medium leading-5 text-slate-400">
                        {statusText}
                      </p>

                      <button
                        onClick={() => abortRef.current?.abort()}
                        className="shrink-0 rounded-full border border-white bg-white/70 px-3 py-1.5 text-[10px] font-black text-slate-500 transition hover:border-red-200 hover:text-red-500"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ---------------------------------------------------------------- */}
              {/* DOWNLOAD BUTTON                                                   */}
              {/* ---------------------------------------------------------------- */}

              {!busy && !done && (
                <button
                  onClick={startDownload}
                  className={`group relative mt-5 flex h-[62px] w-full items-center justify-center gap-3 overflow-hidden rounded-[22px] ${gradient} font-black text-white shadow-[0_18px_40px_rgba(236,72,153,0.25)] transition-all duration-300 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_22px_48px_rgba(236,72,153,0.30)] active:translate-y-0`}
                >
                  <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />

                  <span className="relative flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
                      <DownloadIcon size={19} />
                    </span>
                    Download MP3
                    <ArrowRightIcon
                      size={17}
                      className="transition-transform group-hover:translate-x-1"
                    />
                  </span>
                </button>
              )}

              {/* ---------------------------------------------------------------- */}
              {/* DONE                                                              */}
              {/* ---------------------------------------------------------------- */}

              {done && !busy && (
                <div className="relative mt-5">
                  <div className="overflow-hidden rounded-[24px] border border-emerald-100 bg-gradient-to-br from-emerald-50/90 via-white/70 to-teal-50/70 p-5 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/20">
                      <CheckIcon size={24} />
                    </div>

                    <p className="mt-3 text-base font-black text-emerald-700">
                      Your MP3 is ready
                    </p>

                    <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-emerald-600/75">
                      The download has been sent to your browser. Check your
                      Downloads folder if you don't see it immediately.
                    </p>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <button
                      onClick={startDownload}
                      className="rounded-[17px] border border-white bg-white/70 py-3.5 text-sm font-black text-slate-700 shadow-sm transition hover:bg-white hover:shadow-md"
                    >
                      Download again
                    </button>

                    <button
                      onClick={reset}
                      className="rounded-[17px] bg-slate-900 py-3.5 text-sm font-black text-white shadow-lg shadow-slate-900/10 transition hover:-translate-y-0.5 hover:bg-slate-800"
                    >
                      Convert another
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* TRUST / FOOTER                                                    */}
        {/* ------------------------------------------------------------------ */}

        <div className="mx-auto mt-10 flex max-w-3xl flex-col items-center justify-center gap-3 text-center sm:flex-row">
          <div className="flex items-center justify-center gap-3 text-xs text-slate-400">
            <span className="h-px w-8 bg-slate-200" />

            <span className="font-medium tracking-wide">
              Made for your music library
            </span>

            <span className="h-px w-8 bg-slate-200" />
          </div>
        </div>
      </main>
    </div>
  );
}
