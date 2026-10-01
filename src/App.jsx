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

  useEffect(() => {
    let eventSource = null;

    if (downloadId) {
      console.log("Connecting to progress pipeline for:", downloadId);

      // 🚀 FIXED: Changed downloadid to {downloadId} with a capital 'I'
      eventSource = new EventSource(
        `https://youtube-to-mp3-rhww.onrender.com/api/progress/${downloadId}`,
        {
          withCredentials: false,
        },
      );

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("React progress:", data.progress);
          setProgress(data.progress);

          if (data.progress >= 100) {
            setIsDownloading(false);
            eventSource.close();
          }
        } catch (err) {
          console.error("Error parsing progress JSON string payload:", err);
        }
      };

      eventSource.onerror = (err) => {
        console.error("Progress event pipeline closed or disconnected.");
        eventSource.close();
      };
    }

    return () => {
      if (eventSource) eventSource.close();
    };
  }, [downloadId]);

  async function requestDownload(url, quality) {
    setIsDownloading(true);
    setProgress(0);
    setDownloadId(null);

    try {
      const response = await fetch(
        "https://youtube-to-mp3-rhww.onrender.com/api/download",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url,
            quality,
          }),
        },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => null);

        throw new Error(data?.error || "Download request failed");
      }

      const trackedId = response.headers.get("X-Download-ID");

      console.log("Captured tracking ID:", trackedId);

      if (!trackedId) {
        throw new Error("Download ID was not returned by server");
      }

      setDownloadId(trackedId);

      return trackedId;
    } catch (err) {
      setIsDownloading(false);

      console.error("Download initialization error:", err.message);

      throw err;
    }
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
          {isDownloading && (
            <div className="mt-4 w-full">
              <div className="flex justify-between text-sm font-semibold mb-1 text-gray-700">
                <span>Transcoding File:</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-green-500 h-2.5 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
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
