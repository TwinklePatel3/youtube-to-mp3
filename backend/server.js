const express = require("express");
const cors = require("cors");
const app = express();
const ffmpeg = require("fluent-ffmpeg");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
app.use(cors());
app.use(express.json());
// 2. NOW IT IS SAFE TO COMPUTE PRODUCTION ENV PATHS
const isProduction = process.env.NODE_ENV === "production";

if (isProduction) {
  process.env.PATH = `${process.env.PATH}:${path.join(__dirname, "bin")}`;

  ffmpeg.setFfmpegPath(path.join(__dirname, "bin", "ffmpeg"));
}
const progressTracker = {};
let conversionProgress = 0;
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:5174", // 👈 ADDED: Matches your active React port
      "http://127.0.0.1:5174", // 👈 ADDED: Absolute mapping safety
    ],
    exposedHeaders: ["X-Download-ID", "Content-Disposition"],
  }),
);
// 🚀 Highly Optimized Metadata Fetcher
async function fetchVideoMeta(url) {
  let title = `audio-${Date.now()}`;
  let duration = 0;
  let cover = "";

  // 1. Instantly grab the Title using your lightweight OEmbed fetch logic
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
    );
    if (response.ok) {
      const oembedData = await response.json();
      if (oembedData.title) {
        title = oembedData.title;
        console.log(`Title captured via OEmbed API: "${title}"`);
      }
      if (oembedData.thumbnail_url) cover = oembedData.thumbnail_url;
    }
  } catch (error) {
    console.error(
      "OEmbed metadata fetch failed, using fallback tracking:",
      error.message,
    );
  }

  // 2. Fetch only the Duration using a fast, single-property yt-dlp check
  // (By asking ONLY for duration, yt-dlp executes significantly faster)
  try {
    duration = await new Promise((resolve) => {
      const ytDlpObj = isProduction
        ? spawn("python3", ["-m", "yt_dlp", "--print", "duration", url])
        : spawn("yt-dlp", ["--print", "duration", url]);
      let dataBuffer = "";

      ytDlpObj.stdout.on("data", (data) => {
        dataBuffer += data.toString();
      });

      ytDlpObj.on("close", (code) => {
        if (code === 0 && dataBuffer.trim()) {
          resolve(parseFloat(dataBuffer.trim()) || 0);
        } else {
          resolve(0);
        }
      });

      ytDlpObj.on("error", () => resolve(0));
    });
    console.log(`Duration captured via yt-dlp: ${duration} seconds`);
  } catch (err) {
    console.error("Failed to parse duration stream:", err.message);
  }

  return { title, duration, cover };
}

async function getYouTubeMetadata(url) {
  const response = await fetch(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
  );

  if (!response.ok) {
    throw new Error("Could not retrieve YouTube metadata");
  }
  return await response.json();
}
function getYouTubeVideoId(url) {
  const parsedUrl = new URL(url);

  return parsedUrl.searchParams.get("v");
}

function streamAudio(url) {
  console.log("Spawning system audio conversion stream...");

  const spawnCommand = isProduction ? "python3" : "yt-dlp";

  const spawnArgs = isProduction
    ? [
        "-m",
        "yt_dlp",
        url,
        "--output",
        "-",
        "--format",
        "bestaudio/best",
        "--no-check-certificates",
        "--prefer-free-formats",
        "--limit-rate",
        "3M",
      ]
    : [
        url,
        "--output",
        "-",
        "--format",
        "bestaudio/best",
        "--no-check-certificates",
        "--prefer-free-formats",
        "--limit-rate",
        "3M",
      ];

  console.log("yt-dlp command:", spawnCommand);
  console.log("yt-dlp args:", spawnArgs);

  const ytDlpProcess = spawn(spawnCommand, spawnArgs);

  ytDlpProcess.on("error", (err) => {
    console.error("Failed to start yt-dlp:", err.message);
  });

  ytDlpProcess.stderr.on("data", (data) => {
    console.log(`yt-dlp log: ${data.toString().trim()}`);
  });

  return ytDlpProcess.stdout;
}

app.get("/", (req, res) => {
  console.log("ROOT ROUTE HIT");
  res.status(200).send("Backend is working");
});

app.post("/api/song", async (req, res) => {
  const youtubeUrl = req.body.url;

  console.log("URL RECEIVED:", youtubeUrl);

  try {
    const data = await getYouTubeMetadata(youtubeUrl);

    res.json({
      song_name: data.title,
      singer: data.author_name,
      cover: data.thumbnail_url,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Could not retrieve video information",
    });
  }
});

app.post("/api/init", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  const downloadId = `dl-${Date.now()}`;
  progressTracker[downloadId] = 0;

  try {
    const meta = await fetchVideoMeta(url);
    // Temporarily cache metadata in memory so the download endpoint can access it
    progressTracker[`${downloadId}-meta`] = meta;

    // Send the tracking ID back to React instantly (takes milliseconds)
    res.json({ downloadId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PHASE 1: Quick Handshake Endpoint (Takes Milliseconds)
app.post("/api/download", async (req, res) => {
  const { url, quality } = req.body;

  if (!url) return res.status(400).json({ error: "URL is required" });
  if (quality !== "128" && quality !== "320")
    return res.status(400).json({ error: "Invalid quality" });

  const downloadId = `dl-${Date.now()}`;
  progressTracker[downloadId] = 0;

  try {
    const meta = await fetchVideoMeta(url);

    // Store metadata in global memory so the next GET route can access it
    progressTracker[`${downloadId}-meta`] = { meta, url, quality };

    // Send the tracking token back to React immediately so progress tracking starts!
    res.setHeader("X-Download-ID", downloadId);
    res.setHeader("Access-Control-Expose-Headers", "X-Download-ID");
    return res.json({ success: true, downloadId });
  } catch (error) {
    console.error("Initialization error:", error.message);
    delete progressTracker[downloadId];
    return res.status(400).json({ error: error.message });
  }
});

// PHASE 2: Raw Audio Processing & Streaming Endpoint
app.get("/api/download-file", async (req, res) => {
  const { id } = req.query;

  if (!id || !progressTracker[id + "-meta"]) {
    return res.status(400).send("Invalid or expired session tracking ID");
  }

  const { meta, url, quality } = progressTracker[id + "-meta"];
  const tempFilename = `${meta.title}-${quality}kbps.mp3`;
  const tempFilePath = path.join(__dirname, tempFilename);
  const tempImagePath = path.join(__dirname, `thumb-${id}.jpg`);

  try {
    // 1. Download and cache the OEmbed thumbnail locally before initializing FFmpeg
    if (meta.cover) {
      try {
        console.log(`Downloading cached OEmbed artwork asset: ${meta.cover}`);
        const imgRes = await fetch(meta.cover);
        if (imgRes.ok) {
          const arrayBuffer = await imgRes.arrayBuffer();
          fs.writeFileSync(tempImagePath, Buffer.from(arrayBuffer));
          console.log("Artwork cached locally successfully.");
        }
      } catch (imgErr) {
        console.error("Failed to compile thumbnail stream:", imgErr.message);
      }
    }

    const audioStream = await streamAudio(url);
    // console.log(audioStream, "audioStream");
    if (!audioStream)
      throw new Error(
        "Failed to initialize system yt-dlp audio stream pipeline.",
      );
    // 2. Build the FFmpeg command engine
    let ffmpegCommand = ffmpeg(audioStream);

    const hasImage = fs.existsSync(tempImagePath);
    if (hasImage) {
      ffmpegCommand = ffmpegCommand.input(tempImagePath);
    }
    ffmpegCommand.audioCodec("libmp3lame");
    ffmpegCommand.audioBitrate(`${quality}k`).format("mp3");

    // 🚀 FIXED: Combined options strings using '=' assignment to prevent space-parsing shell arguments crashes
    if (hasImage) {
      ffmpegCommand.outputOptions([
        "-map",
        "0:0", // Map yt-dlp audio stream

        "-map",
        "1:0", // Map cached local image

        "-c:v",
        "mjpeg", // Compress artwork using MJPEG

        "-vf",
        "scale=500:500:force_original_aspect_ratio=increase,crop=500:500",

        "-id3v2_version",
        "3", // ID3v2.3 for Apple/iPhone compatibility

        "-metadata:s:v:0",
        "title=Cover",

        "-metadata:s:v:0",
        "comment=Artwork",

        "-disposition:v:0",
        "attached_pic",
      ]);
    }

    ffmpegCommand
      .on("progress", (progress) => {
        if (meta.duration > 0 && progress.timemark) {
          const timeParts = progress.timemark.split(":");
          const secondsProcessed =
            parseFloat(timeParts[0]) * 3600 +
            parseFloat(timeParts[1]) * 60 +
            parseFloat(timeParts[2]);

          let percent = Math.round((secondsProcessed / meta.duration) * 100);
          progressTracker[id] = Math.min(Math.max(percent, 0), 99);
        }
      })
      .save(tempFilePath)
      .on("end", () => {
        console.log("FFMPEG Conversion Complete with Artwork Embedded!");
        progressTracker[id] = 100;

        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(tempFilename)}"`,
        );
        res.setHeader("Content-Type", "audio/mpeg");

        fs.createReadStream(tempFilePath)
          .pipe(res)
          .on("finish", () => {
            // 3. Cleanup Step: Delete BOTH local temp file assets off your server disk space
            fs.unlink(tempFilePath, (err) => {
              if (err) console.error("Audio cleanup error:", err);

              if (fs.existsSync(tempImagePath)) {
                fs.unlink(tempImagePath, (imgErr) => {
                  if (imgErr) console.error("Image cleanup error:", imgErr);
                  else
                    console.log(
                      "Temporary file workspace scrubbed successfully.",
                    );
                });
              }
              delete progressTracker[id + "-meta"];
            });
          });
      })
      .on("error", (error) => {
        console.error("FFMPEG Error:", error.message);
        delete progressTracker[id];
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        if (fs.existsSync(tempImagePath)) fs.unlinkSync(tempImagePath);
        if (!res.headersSent) res.status(500).send("Audio compilation failed.");
      });
  } catch (error) {
    console.error("Streaming error:", error.message);
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    if (fs.existsSync(tempImagePath)) fs.unlinkSync(tempImagePath);
  }
});

app.get("/api/progress/:id", (req, res) => {
  // Lock down the headers to unblock the React request loop instantly
  const requestOrigin = req.headers.origin || "*";
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // 👈 UPDATED: Tells the browser that port 5174 is safe to stream to!
  res.setHeader("Access-Control-Allow-Origin", requestOrigin);

  const trackerId = req.params.id;

  const interval = setInterval(() => {
    const currentProgress = progressTracker[trackerId] || 0;

    // Write out the live percentage array block
    res.write(`data: ${JSON.stringify({ progress: currentProgress })}\n\n`);

    if (currentProgress >= 100) {
      clearInterval(interval);
      delete progressTracker[trackerId];
      res.end();
    }
  }, 500);

  req.on("close", () => clearInterval(interval));
});
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server live on port ${PORT}`));
