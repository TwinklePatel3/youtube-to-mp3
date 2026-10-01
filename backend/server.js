const express = require("express");
const cors = require("cors");
const app = express();
const ffmpeg = require("fluent-ffmpeg");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const nodeID3 = require("node-id3");
const sharp = require("sharp");

app.use(cors());
app.use(express.json());
// 2. NOW IT IS SAFE TO COMPUTE PRODUCTION ENV PATHS
const isProduction = process.env.NODE_ENV === "production";

const YT_DLP_PATH = isProduction
  ? path.join(__dirname, ".venv", "bin", "yt-dlp")
  : "yt-dlp";

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
      const cookiePath = path.join(__dirname, "youtube-cookies.txt");
      const spawnArgs = ["--print", "duration", "--no-playlist", url];

      if (fs.existsSync(cookiePath)) {
        spawnArgs.push("--cookies", cookiePath); // 👈 Add cookies here as well
      }

      const ytDlpObj = spawn(YT_DLP_PATH, spawnArgs);
      let dataBuffer = "";

      ytDlpObj.stdout.on("data", (data) => {
        dataBuffer += data.toString();
      });
      ytDlpObj.on("close", (code) => {
        resolve(
          code === 0 && dataBuffer.trim()
            ? parseFloat(dataBuffer.trim()) || 0
            : 0,
        );
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
  const cookiePath = path.join(__dirname, "youtube-cookies.txt");
  // Spawns the binary directly using our clean system environment pathing configurations
  const spawnArgs = [
    url,
    "--output",
    "-",
    "--format",
    "bestaudio/best",
    "--no-check-certificates",
    "--prefer-free-formats",
    "--limit-rate",
    "3M",
    "--js-runtimes",
    "node",
  ];
  if (fs.existsSync(cookiePath)) {
    console.log(
      "Verified cookie file discovered. Injecting human profile session tokens...",
    );
    spawnArgs.push("--cookies", cookiePath); // 👈 Instructs yt-dlp to read your local Netscape text array file
  } else {
    console.warn(
      "No youtube-cookies.txt found at root directory. Running anonymously.",
    );
  }

  const ytDlpProcess = spawn(YT_DLP_PATH, spawnArgs);
  ytDlpProcess.on("error", (err) => {
    console.error("Failed to start yt-dlp process binary:", err.message);
  });
  ytDlpProcess.on("close", (code) => {
    if (code !== 0) {
      console.error(`yt-dlp failed with exit code: ${code}`);
    } else {
      console.log("yt-dlp finished successfully");
    }
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
  const safeTitle = String(meta.title || "YouTube Song")
    .replace(/[\/\\?%*:|"<>]/g, "-")
    .replace(/[\x00-\x1F\x80-\x9F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  const tempFilename = `${safeTitle}-${quality}kbps.mp3`;
  // const tempFilePath = path.join(__dirname, tempFilename);

  const rawImagePath = path.join(__dirname, `raw-thumb-${id}.jpg`);

  const optimizedImagePath = path.join(__dirname, `thumb-${id}.jpg`);
  const tempDir = path.join(__dirname, "temp");

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempFilePath = path.join(tempDir, tempFilename);
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

    let ffmpegCommand = ffmpeg(audioStream);

    ffmpegCommand
      .audioCodec("libmp3lame")
      .audioBitrate(`${quality}k`)
      .format("mp3");

    // =========================================================
    // 5. METADATA
    // =========================================================

    const title = meta.title || "Unknown Title";

    const artist =
      meta.artist || meta.channel || meta.singer || "YouTube Downloader";

    const album = meta.album || "YouTube Downloads";

    ffmpegCommand.outputOptions([
      "-id3v2_version",
      "3",

      "-write_id3v1",
      "1",

      "-metadata",
      `title=${title}`,

      "-metadata",
      `artist=${artist}`,

      "-metadata",
      `album=${album}`,

      "-metadata",
      "comment=YouTube Download",
    ]);

    // =========================================================
    // 6. EMBED FRONT COVER
    // =========================================================

    if (hasImage && fs.existsSync(optimizedImagePath)) {
      console.log("Embedding JPEG artwork into MP3...");

      ffmpegCommand = ffmpegCommand.input(optimizedImagePath);

      ffmpegCommand.outputOptions([
        // Audio stream
        "-map",
        "0:a:0",

        // Artwork stream
        "-map",
        "1:v:0",

        // Convert artwork to JPEG
        "-c:v",
        "mjpeg",

        // Apple-friendly ID3
        "-id3v2_version",
        "3",

        // Cover metadata
        "-metadata:s:v:0",
        "title=Cover",

        "-metadata:s:v:0",
        "comment=Front Cover",

        // IMPORTANT:
        // Mark image as attached front cover
        "-disposition:v:0",
        "attached_pic",

        // MP3 metadata
        "-metadata",
        `title=${title}`,

        "-metadata",
        `artist=${artist}`,

        "-metadata",
        `album=${album}`,

        "-metadata",
        "comment=YouTube Download",
      ]);

      console.log("Apple Music-compatible front-cover configuration enabled.");
    } else {
      console.log("No artwork available. Creating audio-only MP3.");
    }

    // =========================================================
    // 7. RESPONSE HEADERS
    // =========================================================

    res.setHeader("X-Download-ID", id);

    res.setHeader(
      "Access-Control-Expose-Headers",
      "X-Download-ID, Content-Disposition",
    );

    // =========================================================
    // 8. FFMPEG PROGRESS
    // =========================================================

    ffmpegCommand
      .on("progress", (progress) => {
        if (meta.duration > 0 && progress.timemark) {
          const timeParts = progress.timemark.split(":");

          const hours = parseFloat(timeParts[0]) || 0;

          const minutes = parseFloat(timeParts[1]) || 0;

          const seconds = parseFloat(timeParts[2]) || 0;

          const secondsProcessed = hours * 3600 + minutes * 60 + seconds;

          let percent = Math.round((secondsProcessed / meta.duration) * 100);

          progressTracker[id] = Math.min(Math.max(percent, 0), 99);

          console.log(`FFMPEG progress: ${progressTracker[id]}%`);
        }
      })

      // =======================================================
      // 9. FFMPEG ERROR
      // =======================================================

      .on("error", (error) => {
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

        if (!res.headersSent) {
          res.status(500).send("Audio compilation failed.");
        }
      })

      // =======================================================
      // 10. FFMPEG SUCCESS
      // =======================================================

      .on("end", () => {
        console.log("FFMPEG Conversion Success!");

        console.log("MP3 created with embedded artwork and ID3v2.3 metadata.");

        // =====================================================
        // 11. PROGRESS = 100
        // =====================================================

        progressTracker[id] = 100;

        // =====================================================
        // 12. SEND MP3 TO CLIENT
        // =====================================================

        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(tempFilename)}"`,
        );

        res.setHeader("Content-Type", "audio/mpeg");

        const fileStream = fs.createReadStream(tempFilePath);

        // =====================================================
        // 13. FILE STREAM ERROR
        // =====================================================

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

          delete progressTracker[id + "-meta"];
        });

        // =====================================================
        // 14. SEND FILE
        // =====================================================

        fileStream.pipe(res).on("finish", () => {
          // -------------------------------------------------
          // CLEAN TEMPORARY FILES
          // -------------------------------------------------

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

          console.log("Temporary files cleaned successfully.");
        });
      })

      // =======================================================
      // 15. SAVE FINAL MP3
      // =======================================================

      .save(tempFilePath);
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
