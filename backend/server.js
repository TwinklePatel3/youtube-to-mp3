const express = require("express");
const cors = require("cors");
const app = express();
const ffmpeg = require("fluent-ffmpeg");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const nodeID3 = require("node-id3");
const sharp = require("sharp");
const NODE_PATH = process.execPath;
console.log("Node executable:", NODE_PATH);

app.use(cors());
app.use(express.json());
// 2. NOW IT IS SAFE TO COMPUTE PRODUCTION ENV PATHS
const isProduction = process.env.NODE_ENV === "production";

const YT_DLP_PATH = isProduction
  ? path.join(__dirname, ".venv", "bin", "yt-dlp")
  : "yt-dlp";
console.log("yt-dlp executable:", YT_DLP_PATH);

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
  let title = "";
  let duration = 0;
  let cover = "";
  let album = "";
  let channel = "";
  let singer = "";
  let uploadDate = "";
  let releaseYear = "";

  // Define the cookie path
  const cookiePath = path.join(__dirname, "youtube-cookies.txt");

  // 1. Get basic metadata using YouTube oEmbed
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;

    const response = await fetch(oembedUrl);

    if (!response.ok) {
      throw new Error(`oEmbed returned status ${response.status}`);
    }

    const data = await response.json();

    title = data.title || "";
    channel = data.author_name || "";
    cover = data.thumbnail_url || "";
  } catch (error) {
    console.error("oEmbed error:", error.message);
  }

  // 2. Get detailed metadata using yt-dlp
  try {
    const spawnArgs = [
      "--ignore-config",
      "--dump-single-json",
      "--skip-download",
      "--no-playlist",
      "--no-warnings",
      "--no-check-formats",
      "--extractor-args",
      "youtube:player_client=web",
      "--js-runtimes",
      `node:${NODE_PATH}`,
    ];

    // Add cookies only if the file exists
    if (fs.existsSync(cookiePath)) {
      console.log("Using YouTube cookies for metadata.");

      spawnArgs.push("--cookies", cookiePath);
    }

    // URL must be included after the options
    spawnArgs.push(url);

    const videoData = await new Promise((resolve, reject) => {
      const ytDlpProcess = spawn(YT_DLP_PATH, spawnArgs);

      let stdout = "";
      let stderr = "";

      ytDlpProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      ytDlpProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      ytDlpProcess.on("error", (error) => {
        reject(error);
      });

      ytDlpProcess.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
          return;
        }

        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error("Could not parse yt-dlp JSON"));
        }
      });
    });

    // Title
    title = videoData.title || title;

    // Duration in seconds
    duration = Number(videoData.duration) || 0;

    // Channel / uploader
    channel = videoData.channel || videoData.uploader || channel;

    // Singer / artist
    singer =
      (Array.isArray(videoData.artists) ? videoData.artists.join(", ") : "") ||
      videoData.artist ||
      videoData.track_artist ||
      videoData.album_artist ||
      "";

    // Album
    album = videoData.album || "";

    // Release year (if supplied by metadata)
    releaseYear = videoData.release_year ? String(videoData.release_year) : "";

    // Upload date
    uploadDate = videoData.upload_date || "";

    // Use upload year as a fallback, not as a confirmed music release year
    if (!releaseYear && uploadDate.length >= 4) {
      releaseYear = uploadDate.substring(0, 4);
    }

    // Thumbnail
    cover = videoData.thumbnail || cover;
  } catch (error) {
    console.error("yt-dlp metadata error:", error.message);
    console.log("Using available oEmbed metadata as fallback.");
  }

  return {
    title: title || `audio-${Date.now()}`,
    singer: singer || "Unknown Artist",
    channel: channel || "Unknown Channel",
    album: album || "",
    duration,
    cover,
    uploadDate,
    releaseYear,
  };
}

function streamAudio(url) {
  console.log("Starting yt-dlp audio stream...");

  const cookiePath = path.join(__dirname, "youtube-cookies.txt");

  const spawnArgs = [
    "--no-warnings",
    "--no-playlist",
    "--no-check-certificates",
    "--no-check-formats",
    "--js-runtimes",
    `node:${NODE_PATH}`,
    "--format",
    "ba/b",
    "--output",
    "-",
  ];

  if (fs.existsSync(cookiePath)) {
    console.log("Using configured YouTube cookies.");
    spawnArgs.push("--cookies", cookiePath);
  } else {
    console.warn("No cookie file found. Trying without authentication.");
  }

  // Place the URL after the options.
  spawnArgs.push(url);

  const ytDlpProcess = spawn(YT_DLP_PATH, spawnArgs, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  ytDlpProcess.on("error", (err) => {
    console.error("Failed to start yt-dlp:", err.message);
  });

  ytDlpProcess.stderr.on("data", (data) => {
    console.error("yt-dlp:", data.toString().trim());
  });

  ytDlpProcess.on("close", (code) => {
    if (code !== 0) {
      console.error(`yt-dlp failed with exit code: ${code}`);
    } else {
      console.log("yt-dlp stream completed.");
    }
  });

  // Keep the child process accessible for error monitoring.
  const audioStream = ytDlpProcess.stdout;
  audioStream.ytDlpProcess = ytDlpProcess;

  return audioStream;
}

app.get("/", (req, res) => {
  console.log("ROOT ROUTE HIT");
  res.status(200).send("Backend is working");
});

app.post("/api/song", async (req, res) => {
  const youtubeUrl = req.body.url;

  console.log("URL RECEIVED:", youtubeUrl);

  try {
    if (!youtubeUrl) {
      return res.status(400).json({
        error: "YouTube URL is required",
      });
    }

    const data = await fetchVideoMeta(youtubeUrl);

    console.log("METADATA:", data);

    res.json({
      song_name: data.title || "Unknown Title",

      // Actual singer/artist from yt-dlp
      singer: data.singer || "Unknown Artist",

      // YouTube channel/uploader
      channel: data.channel || "Unknown Channel",

      // Album if available
      album: data.album || "",

      // Duration in seconds
      duration: Number(data.duration) || 0,

      // Album artwork
      cover: data.cover || "",
      releaseYear: data.uploadDate ? data.uploadDate.substring(0, 4) : "",
    });
  } catch (error) {
    console.error("SONG METADATA ERROR:", error);

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

  if (!url) {
    return res.status(400).json({
      error: "URL is required",
    });
  }

  if (quality !== "128" && quality !== "320") {
    return res.status(400).json({
      error: "Invalid quality",
    });
  }

  const downloadId = `dl-${Date.now()}`;

  progressTracker[downloadId] = 0;

  try {
    const meta = await fetchVideoMeta(url);

    progressTracker[`${downloadId}-meta`] = {
      meta,
      url,
      quality,
    };

    res.setHeader("X-Download-ID", downloadId);

    res.setHeader("Access-Control-Expose-Headers", "X-Download-ID");

    return res.json({
      success: true,
      downloadId,
    });
  } catch (error) {
    console.error("Initialization error:", error.message);

    delete progressTracker[downloadId];

    return res.status(400).json({
      error: error.message,
    });
  }
});

// PHASE 2: Raw Audio Processing & Streaming Endpoint

app.get("/api/download-file", async (req, res) => {
  const { id } = req.query;

  if (!id || !progressTracker[id + "-meta"]) {
    return res.status(400).send("Invalid or expired session tracking ID");
  }

  const { meta, url, quality } = progressTracker[id + "-meta"];
  // const safeFilename = meta.title.replace(/[\/\\:*?"<>]/g, "").trim();
  const safeFilename = meta.title.replace(/[\/\\:*?"<>]/g, "").trim();
  console.log(meta, "META");

  const tempFilename = `${safeFilename}-${quality}kbps.mp3`;
  // const tempFilename = `${safeFilename}.mp3`;

  const tempFilePath = path.join(__dirname, tempFilename);

  console.log("FFmpeg output path:", tempFilePath);

  const rawImagePath = path.join(__dirname, `raw-thumb-${id}.jpg`);

  const optimizedImagePath = path.join(__dirname, `thumb-${id}.jpg`);
  const tempDir = path.join(__dirname, "temp");

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  let hasImage = false;

  try {
    // =========================================================
    // 1. EXTRACT YOUTUBE VIDEO ID
    // =========================================================

    let extractedId = null;

    try {
      const urlObj = new URL(url);

      if (urlObj.hostname.includes("youtu.be")) {
        extractedId = urlObj.pathname.slice(1).split("/")[0];
      } else if (urlObj.hostname.includes("youtube.com")) {
        extractedId = urlObj.searchParams.get("v");
      }
    } catch (e) {
      console.error("Could not extract YouTube video ID:", e.message);
    }

    if (!extractedId) {
      throw new Error("Could not determine YouTube video ID.");
    }

    console.log(`YouTube Video ID: ${extractedId}`);

    // =========================================================
    // 2. DOWNLOAD HIGH-RESOLUTION YOUTUBE ARTWORK
    // =========================================================

    let targetCoverUrl = `https://i.ytimg.com/vi/${extractedId}/maxresdefault.jpg`;

    console.log(`Targeting artwork: ${targetCoverUrl}`);

    try {
      let imgRes = await fetch(targetCoverUrl);

      // -------------------------------------------------------
      // FALLBACK 1
      // -------------------------------------------------------

      if (!imgRes.ok) {
        console.log("maxresdefault unavailable. Trying sddefault...");

        targetCoverUrl = `https://i.ytimg.com/vi/${extractedId}/sddefault.jpg`;

        imgRes = await fetch(targetCoverUrl);
      }

      // -------------------------------------------------------
      // FALLBACK 2
      // -------------------------------------------------------

      if (!imgRes.ok) {
        console.log("sddefault unavailable. Trying hqdefault...");

        targetCoverUrl = `https://i.ytimg.com/vi/${extractedId}/hqdefault.jpg`;

        imgRes = await fetch(targetCoverUrl);
      }

      // -------------------------------------------------------
      // PROCESS IMAGE
      // -------------------------------------------------------

      if (imgRes.ok) {
        const arrayBuffer = await imgRes.arrayBuffer();

        fs.writeFileSync(rawImagePath, Buffer.from(arrayBuffer));

        console.log(`Artwork downloaded: ${targetCoverUrl}`);

        // =====================================================
        // CREATE EXACT 4000 x 4000 JPEG
        // =====================================================

        await sharp(rawImagePath)
          .resize(4000, 4000, {
            fit: "cover",
            position: "centre",
          })
          .jpeg({
            quality: 90,
            chromaSubsampling: "4:4:4",
            progressive: false,
          })
          .toFile(optimizedImagePath);

        hasImage = true;

        console.log("4000x4000 JPEG artwork created successfully.");
      } else {
        console.error("Could not download any YouTube artwork.");
      }
    } catch (imgErr) {
      console.error("Artwork processing failed:", imgErr.message);
    }

    // =========================================================
    // 3. CREATE AUDIO STREAM
    // =========================================================

    const audioStream = streamAudio(url);

    if (!audioStream) {
      throw new Error(
        "Failed to initialize system yt-dlp audio stream pipeline.",
      );
    }

    // =========================================================
    // 4. CREATE FFMPEG COMMAND
    // =========================================================

    // =========================================================
    // FFMPEG AUDIO SETTINGS
    // =========================================================

    // let ffmpegCommand = ffmpeg(audioStream);
    // =========================================================
    // FFMPEG COMMAND
    // =========================================================

    let ffmpegCommand = ffmpeg(audioStream);

    // =========================================================
    // ADD ARTWORK AS INPUT
    // =========================================================

    if (hasImage && fs.existsSync(optimizedImagePath)) {
      console.log("Embedding artwork:", optimizedImagePath);

      ffmpegCommand.input(optimizedImagePath);
    } else {
      console.log("No artwork available. Creating audio-only MP3.");
    }

    // =========================================================
    // OUTPUT
    // =========================================================

    ffmpegCommand
      .output(tempFilePath)

      .audioCodec("libmp3lame")
      .audioBitrate(`${quality}k`)

      .outputOptions(
        "-f",
        "mp3",

        // =====================================================
        // ID3 METADATA
        // =====================================================

        "-id3v2_version",
        "3",

        "-metadata",
        `title=${meta.title || "Unknown Title"}`,
        "-metadata",
        `artist=${meta.singer || "Unknown Artist"}`,
        "-metadata",
        `album=${meta.album || "YouTube Downloads"}`,
        "-metadata",
        `album_artist=${meta.singer || "Unknown Artist"}`,
        "-metadata",
        "genre=Music",
        "-metadata",
        `date=${meta.uploadDate ? meta.uploadDate.substring(0, 4) : ""}`,
        "-metadata",
        "track=1",
        "-metadata",
        "disc=1",
        // =====================================================
        // AUDIO
        // =====================================================

        "-map",
        "0:a:0",
      );

    // =========================================================
    // COVER ART
    // =========================================================

    if (hasImage && fs.existsSync(optimizedImagePath)) {
      ffmpegCommand.outputOptions(
        "-map",
        "1:v:0",

        "-c:v",
        "mjpeg",

        "-metadata:s:v:0",
        "title=Cover",

        "-metadata:s:v:0",
        "comment=Front Cover",

        "-disposition:v:0",
        "attached_pic",
      );
    }

    // =========================================================
    // RESPONSE HEADERS
    // =========================================================

    res.setHeader("X-Download-ID", id);

    res.setHeader(
      "Access-Control-Expose-Headers",
      "X-Download-ID, Content-Disposition",
    );

    // =========================================================
    // FFMPEG EVENTS
    // =========================================================
    let lastFFmpegPercent = 0;
    let progressTimer = null;
    ffmpegCommand

      .on("start", (commandLine) => {
        console.log("========== FFMPEG START ==========");
        console.log(commandLine);
        console.log("==================================");

        progressTracker[id] = 0;

        progressTimer = setInterval(() => {
          const current = progressTracker[id] ?? 0;

          // Don't artificially go backwards
          if (current > lastFFmpegPercent) {
            lastFFmpegPercent = current;
          }

          progressTracker[id] = lastFFmpegPercent;
        }, 500);
      })

      .on("progress", (progress) => {
        console.log("RAW FFMPEG PROGRESS:", progress);

        // 1. Ensure duration is extracted as a clean, valid number
        let duration = 0;
        if (meta && meta.duration) {
          duration = Number(meta.duration);
        }

        // 🚀 CRITICAL ENGINE FALLBACK: If duration is missing, un-parseable, or 0,
        // we use a safe standard track length default (e.g., 3 minutes / 180s)
        // so the progress percentage bar doesn't stay frozen at 0%!
        if (!duration || isNaN(duration) || duration <= 0) {
          console.warn(
            "Warning: Video duration was invalid or 0. Using 180s tracker fallback.",
          );
          duration = 180;
        }

        if (progress.timemark && typeof progress.timemark === "string") {
          const timeParts = progress.timemark.split(":");

          // Safely parse time elements regardless of single digit layouts
          const hours = parseFloat(timeParts[0]) || 0;
          const minutes = parseFloat(timeParts[1]) || 0;
          const seconds = parseFloat(timeParts[2]) || 0;

          const secondsProcessed = hours * 3600 + minutes * 60 + seconds;

          // 2. Prevent NaN division crashes and constrain progress between 0% and 99%
          let percent = 0;
          if (secondsProcessed > 0) {
            percent = Math.round((secondsProcessed / duration) * 100);
          }

          percent = Math.min(Math.max(percent, 0), 99); // Lock at 99% maximum until file fully saves

          // 3. Write securely to your global stream memory tracking dictionary maps
          progressTracker[id] = percent;

          console.log(
            `FFMPEG progress [${id}]: ${percent}% | Processed: ${Math.round(secondsProcessed)}s / Total: ${duration}s (Timemark: ${progress.timemark})`,
          );
        } else {
          console.log(
            "Progress event triggered but timemark formatting was un-parseable.",
          );
        }
      })
      .on("error", (error) => {
        console.error("FFMPEG ERROR:", error.message);
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = null;
        }

        console.error("FFMPEG ERROR:", error.message);

        delete progressTracker[id];

        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }

        if (fs.existsSync(rawImagePath)) {
          fs.unlinkSync(rawImagePath);
        }

        if (fs.existsSync(optimizedImagePath)) {
          fs.unlinkSync(optimizedImagePath);
        }

        delete progressTracker[id + "-meta"];

        if (!res.headersSent) {
          res.status(500).send("Audio compilation failed.");
        }
      })

      .on("end", () => {
        console.log("FFMPEG Conversion Success!");
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = null;
        }

        // IMPORTANT: only here do we set 100%
        progressTracker[id] = 100;

        console.log(`FFMPEG progress ${id}: 100%`);
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="song.mp3"; filename*=UTF-8''${encodeURIComponent(tempFilename)}`,
        );

        res.setHeader("Content-Type", "audio/mpeg");

        const fileStream = fs.createReadStream(tempFilePath);

        fileStream.on("error", (streamErr) => {
          console.error("File stream error:", streamErr.message);

          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }

          if (fs.existsSync(rawImagePath)) {
            fs.unlinkSync(rawImagePath);
          }

          if (fs.existsSync(optimizedImagePath)) {
            fs.unlinkSync(optimizedImagePath);
          }

          delete progressTracker[id];
          delete progressTracker[id + "-meta"];
        });

        fileStream.pipe(res).on("finish", () => {
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }

          if (fs.existsSync(rawImagePath)) {
            fs.unlinkSync(rawImagePath);
          }

          if (fs.existsSync(optimizedImagePath)) {
            fs.unlinkSync(optimizedImagePath);
          }

          delete progressTracker[id];
          delete progressTracker[id + "-meta"];

          console.log("Temporary files cleaned successfully.");
        });
      });

    ffmpegCommand.run();
  } catch (error) {
    console.error("Streaming error:", error.message);

    delete progressTracker[id];

    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    if (fs.existsSync(rawImagePath)) {
      fs.unlinkSync(rawImagePath);
    }

    if (fs.existsSync(optimizedImagePath)) {
      fs.unlinkSync(optimizedImagePath);
    }

    if (!res.headersSent) {
      res.status(400).send(error.message);
    }
  }
});

app.get("/api/progress/:id", (req, res) => {
  const trackerId = req.params.id;
  const requestOrigin = req.headers.origin || "*";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", requestOrigin);

  res.flushHeaders();

  console.log("SSE connected:", trackerId);

  const sendProgress = () => {
    const currentProgress = progressTracker[trackerId] ?? 0;

    console.log(`SSE ${trackerId}: ${currentProgress}%`);

    res.write(
      `data: ${JSON.stringify({
        progress: currentProgress,
      })}\n\n`,
    );

    if (currentProgress >= 100) {
      clearInterval(interval);

      setTimeout(() => {
        res.end();
      }, 300);
    }
  };

  // Send current value immediately
  sendProgress();

  // Continue sending updates
  const interval = setInterval(() => {
    sendProgress();
  }, 500);

  req.on("close", () => {
    console.log("SSE disconnected:", trackerId);
    clearInterval(interval);
  });
});
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server live on port ${PORT}`));
