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
  const [isDownloading, setIsDownloading] = useState(false);
  const [readyToSave, setReadyToSave] = useState(false);
  // Paste this inside your App component function, right above your return/render block
  useEffect(() => {
    let eventSource = null;

    if (downloadId) {
      console.log(
        "Connecting to live progress line for session ID:",
        downloadId,
      );

      // 🚀 Open a live Server-Sent Events stream straight to your backend tracking route
      eventSource = new EventSource(`https://onrender.com{downloadId}`, {
        withCredentials: false,
      });

      // This triggers every single time your backend updates 'progressTracker[id] = percent'
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("Progress received from cloud server:", data.progress);

          // Update your React state so the UI animation re-renders instantly
          setProgress(data.progress);

          // Auto-close the stream path cleanly when the conversion finishes
          if (data.progress >= 100) {
            setIsDownloading(false);
            setReadyToSave(true); // Reveals the "Save Completed MP3" download button link
            eventSource.close();
          }
        } catch (err) {
          console.error(
            "Error parsing progress stream payload data packets:",
            err,
          );
        }
      };

      // Safety fallback: auto-close if connection breaks
      eventSource.onerror = (err) => {
        console.warn("Progress pipeline stream dropped or completed.");
        eventSource.close();
      };
    }

    // Cleanup: closes the stream path if the user navigates away or closes the app tab
    return () => {
      if (eventSource) eventSource.close();
    };
  }, [downloadId]); // 👈 Watches this token dynamically

  async function requestDownload(url, quality) {
    setIsDownloading(true);
    setProgress(0);
    setReadyToSave(false);
    setDownloadId(null); // Reset previous runs

    const response = await fetch("https://onrender.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, quality }),
    });

    if (!response.ok) {
      setIsDownloading(false);
      throw new Error("Download initialization handshake failed.");
    }

    const data = await response.json();
    console.log(
      "Handshake successful. Target token achieved:",
      data.downloadId,
    );

    if (data.downloadId) {
      setDownloadId(data.downloadId); // 👈 This instantly kicks off your useEffect EventSource hook above!
    }
    return data.downloadId;
  }

  async function getSongData(url) {
    const response = await fetch(
      "https://youtube-to-mp3-rhww.onrender.com/api/song",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: url,
        }),
      },
    );
    if (!response.ok) {
      throw new Error("Failed to get video information");
    }
    const data = await response.json();
    return data;
  }
  return (
    <>
      <section className="text-center py-12 px-4">
        <h1 className="text-5xl font-bold">YouTube to mp3</h1>
        <p className="mt-4 text-gray-600">
          Download songs in high quality direct from youtube with image for
          iphone
        </p>
      </section>

      <div className="ticks"></div>

      <section className="flex flex-col items-center justify-center gap-3 px-4 md:flex-row">
        <input
          className="w-full max-w-xl rounded-lg border px-4 py-3"
          placeholder="Place here youtube link"
          value={url}
          type="url"
          onChange={(event) => {
            setUrl(event.currentTarget.value);
            setSongData({
              title: "",
              channel: "",
              thumbnail: "",
            });
          }}
        />
        <button
          className="rounded-lg border bg-blue-500 px-6 py-3 font-semibold text-white hover:bg-blue-400 cursor-pointer"
          onClick={async () => {
            const trimmedUrl = url.trim();

            if (trimmedUrl === "") {
              alert("enter url");
              return;
            }
            try {
              const parsedUrl = new URL(trimmedUrl);

              if (
                parsedUrl.hostname !== "www.youtube.com" &&
                parsedUrl.hostname !== "youtube.com" &&
                parsedUrl.hostname !== "youtu.be"
              ) {
                alert("Enter YouTube URL");
                return;
              }
            } catch (err) {
              alert("Enter a valid URL");
              return;
            }
            try {
              const data = await getSongData(url);

              setSongData({
                title: data.song_name,
                channel: data.singer,
                thumbnail: data.cover,
              });
            } catch (err) {
              setError(err.message);
              return;
            }
          }}
        >
          Convert
        </button>
      </section>
      {error !== "" && <p className="mt-4 text-center text-red-500">{error}</p>}
      {songData.title !== "" && (
        <section className="mx-auto mt-10 max-w-sm rounded-2xl   p-6 shadow-lg">
          <img
            src={songData.thumbnail}
            alt="Selected preview"
            className="aspect-square w-full rounded-xl  "
          />

          <h2 className="mt-6 text-xl font-bold"> {songData.title}</h2>
          <p className="text-gray-600">{songData.channel}</p>
          <label className="mt-4 block">
            Quality:
            <select
              name="Quality"
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              className="ml-2 rounded-lg border px-2 py-2"
            >
              <option value="128">128 kbps</option>
              <option value="320">320 kbps</option>
            </select>
          </label>
          {/* PLACE THIS DIRECTLY UNDERNEATH YOUR QUALITY SELECT DROP-DOWN ELEMENT */}
          {(isDownloading || progress > 0) && (
            <div className="mt-6 w-full px-1">
              {/* Label Header Tracker */}
              <div className="flex justify-between text-sm font-semibold mb-2 text-gray-700">
                <span className="flex items-center gap-1.5">
                  {progress >= 100
                    ? "✨ Processing Complete!"
                    : "⚡ Converting Codecs..."}
                </span>
                <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-xs text-gray-600">
                  {progress}%
                </span>
              </div>

              {/* The Animated Tailwind Progress Rail Shell Container */}
              <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden shadow-inner">
                <div
                  className="bg-gradient-to-r from-green-400 to-green-500 h-3 rounded-full shadow transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }} // 👈 This maps your React numeric state straight to your element width!
                ></div>
              </div>
            </div>
          )}

          <button
            className={`mt-5 w-full rounded-lg px-6 py-3 font-semibold text-white transition-colors ${
              isDownloading
                ? "cursor-not-allowed bg-gray-400"
                : "cursor-pointer bg-red-500 hover:bg-red-600"
            }`}
            disabled={isDownloading}
            onClick={async () => {
              try {
                const targetId = await requestDownload(url, quality);

                if (!targetId) {
                  throw new Error("Download session could not be created.");
                }

                // Start the actual FFmpeg/download request
                window.location.href =
                  `https://youtube-to-mp3-rhww.onrender.com/api/download-file` +
                  `?url=${encodeURIComponent(url)}` +
                  `&quality=${encodeURIComponent(quality)}` +
                  `&id=${encodeURIComponent(targetId)}`;
              } catch (err) {
                setIsDownloading(false);
                setError(err.message);
              }
            }}
          >
            {isDownloading ? `Processing... ${progress}%` : "Download now"}
          </button>
        </section>
      )}
    </>
  );
}

export default App;
