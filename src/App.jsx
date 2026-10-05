import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [url, setUrl] = useState("");
  const [quality, setQuality] = useState("128");

  const [songData, setSongData] = useState({
    title: "",
    channel: "",
    thumbnail: "",
  });

  const [error, setError] = useState("");
  const [downloadId, setDownloadId] = useState(null);
  const [progress, setProgress] = useState(0);

  const [isLoadingSong, setIsLoadingSong] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [readyToSave, setReadyToSave] = useState(false);

  // const API_URL = "http://127.0.0.1:5001";
  const API_URL = "https://youtube-to-mp3-rhww.onrender.com";
  // ===============================================
  // --------------------------------------------------
  // LIVE DOWNLOAD PROGRESS
  // --------------------------------------------------

  useEffect(() => {
    if (!downloadId) return;

    const eventSource = new EventSource(
      `${API_URL}/api/progress/${downloadId}`,
    );

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const currentProgress = Number(data.progress) || 0;

        setProgress(currentProgress);

        if (currentProgress > 0) {
          setIsPreparing(false);
        }

        if (currentProgress >= 100) {
          eventSource.close();
        }
      } catch (err) {
        console.error("Progress error:", err);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [downloadId]);

  // --------------------------------------------------
  // YOUTUBE URL VALIDATION
  // --------------------------------------------------

  const isValidYouTubeUrl = (value) => {
    try {
      const parsedUrl = new URL(value);

      return [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "youtu.be",
        "www.youtu.be",
      ].includes(parsedUrl.hostname);
    } catch {
      return false;
    }
  };

  // --------------------------------------------------
  // GET SONG INFORMATION
  // --------------------------------------------------

  const getSongData = async (videoUrl) => {
    const response = await fetch(`${API_URL}/api/song`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: videoUrl,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Unable to get song information.");
    }

    return data;
  };

  // --------------------------------------------------
  // FIND SONG
  // --------------------------------------------------

  const handleConvert = async () => {
    setError("");

    const cleanUrl = url.trim();

    if (!cleanUrl) {
      setError("Paste a YouTube link to continue.");
      return;
    }

    if (!isValidYouTubeUrl(cleanUrl)) {
      setError("That doesn't look like a valid YouTube link.");
      return;
    }

    try {
      setIsLoadingSong(true);
      setReadyToSave(false);
      setProgress(0);

      const data = await getSongData(cleanUrl);

      setSongData({
        title: data.song_name || "",
        channel: data.singer || "",
        thumbnail: data.cover || "",
      });
    } catch (err) {
      console.error("Song error:", err);

      setSongData({
        title: "",
        channel: "",
        thumbnail: "",
      });

      setError(err.message || "Unable to fetch song information.");
    } finally {
      setIsLoadingSong(false);
    }
  };

  // --------------------------------------------------
  // START DOWNLOAD JOB
  // --------------------------------------------------

  const requestDownload = async (videoUrl, selectedQuality) => {
    const response = await fetch(`${API_URL}/api/download`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: videoUrl,
        quality: selectedQuality,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.downloadId) {
      throw new Error(data.error || "Unable to start download.");
    }

    setDownloadId(data.downloadId);

    return data.downloadId;
  };

  // --------------------------------------------------
  // SANITIZE FILE NAME
  // --------------------------------------------------

  const sanitizeFilename = (filename) => {
    return filename
      .replace(/[\/\\:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
  };

  // --------------------------------------------------
  // DOWNLOAD MP3
  // --------------------------------------------------

  const startDownload = async () => {
    if (!url.trim()) {
      setError("Paste a YouTube link first.");
      return;
    }

    setError("");
    setIsDownloading(true);
    setIsPreparing(true);
    setReadyToSave(false);
    setProgress(0);

    try {
      // Start backend download job
      const targetId = await requestDownload(url.trim(), quality);

      // Give SSE a little time to connect
      await new Promise((resolve) => setTimeout(resolve, 700));

      // If progress has not started yet, keep preparing state
      setIsPreparing(false);

      // Get actual MP3 file
      const response = await fetch(
        `${API_URL}/api/download-file?id=${encodeURIComponent(targetId)}`,
      );

      if (!response.ok) {
        let message = "MP3 conversion failed.";

        try {
          message = await response.text();
        } catch {}

        throw new Error(message || "MP3 conversion failed.");
      }

      const blob = await response.blob();

      if (!blob || blob.size === 0) {
        throw new Error("The generated MP3 file is empty.");
      }

      setProgress(100);

      // Create browser download
      const downloadUrl = URL.createObjectURL(blob);

      const anchor = document.createElement("a");

      anchor.href = downloadUrl;

      anchor.download = `${sanitizeFilename(
        songData.title || "YouTube Audio",
      )}-${quality}kbps.mp3`;

      document.body.appendChild(anchor);

      anchor.click();

      anchor.remove();

      setTimeout(() => {
        URL.revokeObjectURL(downloadUrl);
      }, 1000);

      setReadyToSave(true);
    } catch (err) {
      console.error("Download error:", err);

      setError(err.message || "Something went wrong while downloading.");
    } finally {
      setIsPreparing(false);
      setIsDownloading(false);
    }
  };

  // --------------------------------------------------
  // RESET
  // --------------------------------------------------

  const resetSong = () => {
    setUrl("");

    setSongData({
      title: "",
      channel: "",
      thumbnail: "",
    });

    setError("");
    setDownloadId(null);
    setProgress(0);
    setReadyToSave(false);
    setIsDownloading(false);
    setIsPreparing(false);
  };

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  return (
    <div className="min-h-screen overflow-hidden bg-[#f8f9fc] text-slate-900">
      {/* BACKGROUND */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-[500px] w-[500px] rounded-full bg-red-300/15 blur-[120px]" />

        <div className="absolute -right-40 top-20 h-[500px] w-[500px] rounded-full bg-pink-300/15 blur-[130px]" />

        <div className="absolute bottom-[-200px] left-[30%] h-[500px] w-[500px] rounded-full bg-purple-300/10 blur-[140px]" />

        <div className="absolute inset-0 opacity-[0.025] [background-image:linear-gradient(#000_1px,transparent_1px),linear-gradient(90deg,#000_1px,transparent_1px)] [background-size:50px_50px]" />
      </div>

      {/* NAVBAR */}
      <nav className="sticky top-0 z-50 border-b border-white/70 bg-white/50 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-red-500 via-pink-500 to-purple-500 text-white shadow-lg shadow-red-200 transition-all duration-300 hover:scale-105">
              <span className="absolute inset-0 bg-white/20" />

              <svg
                className="relative"
                width="19"
                height="19"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>

            <div>
              <div className="text-lg font-bold tracking-tight">
                YouTube<span className="text-red-500">MP3</span>
              </div>

              <div className="text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                Music Converter
              </div>
            </div>
          </div>

          <div className="hidden items-center gap-2 rounded-full border border-white bg-white/60 px-4 py-2 text-xs font-semibold text-slate-500 shadow-sm backdrop-blur-xl sm:flex">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />

              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Online
          </div>
        </div>
      </nav>

      {/* MAIN */}
      <main className="mx-auto max-w-5xl px-5 pb-24">
        {/* HERO */}
        <section className="relative pb-4 pt-20 text-center sm:pt-28">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white bg-white/55 px-4 py-2 text-xs font-semibold text-slate-500 shadow-[0_10px_35px_rgba(30,30,60,0.06)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:bg-white/75">
            <span className="text-red-500">✦</span>
            Your music, your way
            <span className="text-slate-300">•</span>
            MP3
          </div>

          <h1 className="mx-auto max-w-4xl text-5xl font-black leading-[1.02] tracking-[-0.04em] text-slate-900 sm:text-7xl">
            Turn your favorite
            <br />
            <span className="bg-gradient-to-r from-red-500 via-pink-500 to-purple-500 bg-clip-text text-transparent">
              videos into music.
            </span>
          </h1>

          <p className="mx-auto mt-7 max-w-xl text-sm leading-7 text-slate-500 sm:text-base">
            Paste a YouTube link, choose your quality, and create your MP3 with
            artwork in seconds.
          </p>
        </section>

        {/* URL INPUT */}
        <section className="mx-auto mt-10 max-w-3xl">
          <div className="group rounded-[30px] border border-white/90 bg-white/55 p-3 shadow-[0_25px_80px_rgba(30,30,60,0.08)] backdrop-blur-2xl transition-all duration-500 hover:-translate-y-1 hover:bg-white/65 hover:shadow-[0_35px_100px_rgba(30,30,60,0.11)]">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <div className="pointer-events-none absolute left-5 top-1/2 z-10 -translate-y-1/2 text-slate-400 transition-colors duration-300 group-focus-within:text-red-400">
                  <svg
                    width="19"
                    height="19"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                </div>

                <input
                  type="url"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setError("");

                    if (songData.title) {
                      setSongData({
                        title: "",
                        channel: "",
                        thumbnail: "",
                      });

                      setReadyToSave(false);
                      setProgress(0);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleConvert();
                    }
                  }}
                  placeholder="Paste a YouTube link..."
                  className="h-16 w-full rounded-[22px] border border-white bg-white/60 pl-14 pr-5 text-sm font-medium text-slate-800 outline-none backdrop-blur-xl transition-all duration-300 placeholder:text-slate-400 focus:border-red-200 focus:bg-white/90 focus:ring-4 focus:ring-red-100/60 focus:shadow-[0_10px_40px_rgba(239,68,68,0.08)]"
                />
              </div>

              <button
                onClick={handleConvert}
                disabled={isLoadingSong}
                className="group h-16 rounded-[22px] bg-gradient-to-r from-red-500 via-pink-500 to-red-500 bg-[length:200%_100%] px-8 font-bold text-white shadow-lg shadow-red-200/70 transition-all duration-500 hover:-translate-y-1 hover:bg-[position:100%_0] hover:shadow-xl hover:shadow-red-200 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoadingSong ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Finding
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    Find Song
                    <span className="transition-transform duration-300 group-hover:translate-x-1">
                      →
                    </span>
                  </span>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-red-100 bg-red-50/70 px-4 py-3 text-center text-sm font-medium text-red-600 shadow-sm backdrop-blur-xl">
              {error}
            </div>
          )}
        </section>

        {/* SONG CARD */}
        {songData.title && (
          <section className="mx-auto mt-10 max-w-3xl">
            <div className="relative overflow-hidden rounded-[32px] border border-white/90 bg-white/55 p-5 shadow-[0_30px_100px_rgba(30,30,60,0.09)] backdrop-blur-2xl transition-all duration-500 hover:-translate-y-1 hover:bg-white/65">
              <div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-red-300/10 blur-3xl" />

              {/* SONG INFO */}
              <div className="relative flex flex-col gap-6 sm:flex-row">
                <div className="group relative mx-auto h-52 w-52 shrink-0 overflow-hidden rounded-[24px] bg-slate-100 shadow-[0_20px_50px_rgba(30,30,60,0.14)] sm:mx-0">
                  {songData.thumbnail ? (
                    <img
                      src={songData.thumbnail}
                      alt={songData.title}
                      className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-red-100 via-pink-100 to-purple-100">
                      <span className="text-6xl text-red-400">♫</span>
                    </div>
                  )}

                  <div className="absolute left-3 top-3 rounded-full border border-white/60 bg-white/65 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600 shadow-sm backdrop-blur-xl">
                    YouTube
                  </div>

                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-all duration-300 group-hover:bg-black/10">
                    <div className="flex h-14 w-14 scale-75 items-center justify-center rounded-full bg-white/80 text-red-500 opacity-0 shadow-xl backdrop-blur-xl transition-all duration-300 group-hover:scale-100 group-hover:opacity-100">
                      ▶
                    </div>
                  </div>
                </div>

                <div className="flex min-w-0 flex-1 flex-col justify-center">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-red-500" />

                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-500">
                      Ready to convert
                    </span>
                  </div>

                  <h2 className="line-clamp-3 text-2xl font-black leading-tight tracking-tight text-slate-900">
                    {songData.title}
                  </h2>

                  <p className="mt-3 text-sm font-medium text-slate-500">
                    {songData.channel || "Unknown Channel"}
                  </p>

                  <div className="mt-6 flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white bg-white/70 text-red-500 shadow-sm backdrop-blur-xl">
                      ♪
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-slate-600">
                        MP3 Audio
                      </p>

                      <p className="text-[10px] text-slate-400">
                        Artwork included
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* QUALITY */}
              <div className="relative mt-8">
                <div className="mb-4 flex items-end justify-between">
                  <div>
                    <p className="text-sm font-bold text-slate-800">
                      Choose your quality
                    </p>

                    <p className="mt-1 text-xs text-slate-400">
                      Select the bitrate for your MP3
                    </p>
                  </div>

                  <span className="rounded-full border border-white bg-white/60 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {quality} kbps
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    {
                      value: "128",
                      title: "128 kbps",
                      subtitle: "Smaller file",
                    },
                    {
                      value: "320",
                      title: "320 kbps",
                      subtitle: "Maximum quality",
                    },
                  ].map((item) => {
                    const active = quality === item.value;

                    return (
                      <button
                        key={item.value}
                        onClick={() => setQuality(item.value)}
                        disabled={isDownloading}
                        className={`
                          group
                          relative
                          overflow-hidden
                          rounded-[22px]
                          border
                          p-4
                          text-left
                          backdrop-blur-xl
                          transition-all
                          duration-300
                          hover:-translate-y-1
                          disabled:cursor-not-allowed
                          ${
                            active
                              ? "border-red-300 bg-red-50/80 shadow-lg shadow-red-100/70"
                              : "border-white/80 bg-white/50 hover:bg-white/75 hover:shadow-lg"
                          }
                        `}
                      >
                        {active && (
                          <div className="absolute right-0 top-0 h-16 w-16 rounded-full bg-red-300/20 blur-2xl" />
                        )}

                        <div className="relative flex items-center justify-between">
                          <div>
                            <p
                              className={
                                active
                                  ? "font-bold text-red-600"
                                  : "font-bold text-slate-700"
                              }
                            >
                              {item.title}
                            </p>

                            <p className="mt-1 text-[11px] text-slate-400">
                              {item.subtitle}
                            </p>
                          </div>

                          <div
                            className={`
                              flex
                              h-6
                              w-6
                              items-center
                              justify-center
                              rounded-full
                              border
                              transition-all
                              duration-300
                              ${
                                active
                                  ? "scale-110 border-red-500 bg-red-500 shadow-md shadow-red-200"
                                  : "border-slate-300 bg-white/50 group-hover:border-red-300"
                              }
                            `}
                          >
                            {active && (
                              <span className="h-2 w-2 rounded-full bg-white" />
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* DOWNLOAD / PROGRESS */}
              {isDownloading && (
                <div className="mt-6 overflow-hidden rounded-[24px] border border-white/90 bg-white/55 p-6 shadow-inner backdrop-blur-xl">
                  {/* PREPARING */}
                  {isPreparing ? (
                    <div className="text-center">
                      {/* Main animated loader */}
                      <div className="relative mx-auto mb-5 flex h-20 w-20 items-center justify-center">
                        {/* Outer pulse */}
                        <div className="absolute inset-0 animate-ping rounded-full bg-red-200/30" />

                        {/* Spinning ring */}
                        <div className="absolute inset-2 animate-[spin_2s_linear_infinite] rounded-full border-2 border-transparent border-t-red-500 border-r-pink-400" />

                        {/* Center */}
                        <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-red-500 via-pink-500 to-purple-500 text-white shadow-lg shadow-red-200">
                          <span className="animate-pulse text-xl">♫</span>
                        </div>
                      </div>

                      <p className="text-base font-bold text-slate-800">
                        Preparing your download
                      </p>

                      <p className="mt-1 text-xs text-slate-400">
                        Connecting to the audio converter...
                      </p>

                      {/* Animated dots */}
                      <div className="mt-4 flex justify-center gap-1.5">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-red-500 [animation-delay:-0.3s]" />

                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-pink-500 [animation-delay:-0.15s]" />

                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-purple-500" />
                      </div>

                      {/* Moving loading bar */}
                      <div className="mx-auto mt-5 h-1.5 max-w-xs overflow-hidden rounded-full bg-slate-200/70">
                        <div className="h-full w-1/3 animate-[loading_1.5s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-red-500 via-pink-500 to-purple-500" />
                      </div>
                    </div>
                  ) : (
                    /* REAL PROGRESS */
                    <div>
                      <div className="mb-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-50 text-red-500">
                            <span className="animate-pulse">♪</span>
                          </div>

                          <div>
                            <p className="text-sm font-bold text-slate-700">
                              Creating your MP3
                            </p>

                            <p className="text-[10px] text-slate-400">
                              Converting audio...
                            </p>
                          </div>
                        </div>

                        <span className="text-lg font-black text-red-500">
                          {Math.round(progress)}%
                        </span>
                      </div>

                      <div className="h-3 overflow-hidden rounded-full bg-slate-200/70">
                        <div
                          className="relative h-full rounded-full bg-gradient-to-r from-red-500 via-pink-500 to-purple-500 shadow-[0_0_15px_rgba(239,68,68,0.3)] transition-all duration-500"
                          style={{
                            width: `${Math.min(progress, 100)}%`,
                          }}
                        >
                          <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* DOWNLOAD BUTTON */}
              {!isDownloading && !readyToSave && (
                <button
                  onClick={startDownload}
                  className="group relative mt-6 h-16 w-full overflow-hidden rounded-[22px] bg-gradient-to-r from-red-500 via-pink-500 to-purple-500 bg-[length:200%_100%] font-bold text-white shadow-xl shadow-red-200/60 transition-all duration-500 hover:-translate-y-1 hover:bg-[position:100%_0] hover:shadow-2xl hover:shadow-pink-200/60 active:translate-y-0"
                >
                  <span className="absolute inset-y-0 -left-20 w-16 rotate-12 bg-white/20 blur-sm transition-all duration-700 group-hover:left-[110%]" />

                  <span className="relative flex items-center justify-center gap-3">
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
                    <span className="transition-transform duration-300 group-hover:translate-y-1">
                      ↓
                    </span>
                  </span>
                </button>
              )}

              {/* SUCCESS */}
              {readyToSave && !isDownloading && (
                <div className="mt-6">
                  <div className="rounded-[22px] border border-emerald-100 bg-emerald-50/70 p-5 text-center backdrop-blur-xl">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-xl text-emerald-600 shadow-sm">
                      ✓
                    </div>

                    <p className="font-bold text-emerald-700">
                      Your MP3 is ready
                    </p>

                    <p className="mt-1 text-xs text-emerald-600/70">
                      The download has started automatically.
                    </p>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <button
                      onClick={startDownload}
                      className="rounded-[18px] border border-white bg-white/65 py-3.5 text-sm font-bold text-slate-700 shadow-sm backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:bg-white hover:shadow-lg"
                    >
                      Download Again
                    </button>

                    <button
                      onClick={resetSong}
                      className="rounded-[18px] bg-slate-900 py-3.5 text-sm font-bold text-white shadow-lg transition-all duration-300 hover:-translate-y-1 hover:bg-slate-800 hover:shadow-xl"
                    >
                      New Song
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* FEATURES */}
        <section className="mx-auto mt-14 max-w-3xl">
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                icon: "♫",
                title: "High Quality",
                text: "Up to 320 kbps audio.",
                bg: "bg-red-50",
                textColor: "text-red-500",
              },
              {
                icon: "◈",
                title: "Artwork",
                text: "Album artwork included.",
                bg: "bg-pink-50",
                textColor: "text-pink-500",
              },
              {
                icon: "↯",
                title: "Live Progress",
                text: "Watch conversion in real time.",
                bg: "bg-purple-50",
                textColor: "text-purple-500",
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="group rounded-[24px] border border-white/90 bg-white/45 p-5 text-center shadow-sm backdrop-blur-xl transition-all duration-300 hover:-translate-y-2 hover:bg-white/70 hover:shadow-xl"
              >
                <div
                  className={`
                    mx-auto
                    flex
                    h-12
                    w-12
                    items-center
                    justify-center
                    rounded-2xl
                    ${feature.bg}
                    ${feature.textColor}
                    transition-all
                    duration-300
                    group-hover:scale-110
                    group-hover:rotate-3
                  `}
                >
                  {feature.icon}
                </div>

                <h3 className="mt-4 text-sm font-bold text-slate-800">
                  {feature.title}
                </h3>

                <p className="mt-1 text-xs leading-5 text-slate-400">
                  {feature.text}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* FOOTER */}
        <footer className="mt-16 text-center">
          <div className="mx-auto mb-3 h-px max-w-xs bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">
            YouTubeMP3
          </p>

          <p className="mt-1 text-xs text-slate-400">Simple audio conversion</p>
        </footer>
      </main>
    </div>
  );
}

export default App;
