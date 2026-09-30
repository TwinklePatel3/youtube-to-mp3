#!/usr/bin/env bash
set -o errexit

# 1. Clear any local npm cache arrays right away to free up system memory
npm cache clean --force

# 2. Install all dependencies but run node with a tight memory allocation limit cap
echo "Installing Node module dependencies..."
NODE_OPTIONS="--max-old-space-size=4096" npm install

# 3. Build the static production client asset dist layer
echo "Compiling Vite Frontend assets..."
NODE_OPTIONS="--max-old-space-size=4096" npm run build

# 4. Allocate space for production binary paths
mkdir -p ./bin

# 5. Download the exact pre-compiled static Linux binary for yt-dlp 
# (Switched to a high-speed direct download url to skip heavy pip installer memory steps)
echo "Downloading standalone Linux x86_64 yt-dlp binary..."
curl -L "https://github.com" -o ./bin/yt-dlp
chmod a+rx ./bin/yt-dlp

# 6. Download pre-compiled stable Linux static binary for FFmpeg
echo "Downloading stable Linux FFmpeg binary..."
curl -L "https://github.com" -o ./bin/ffmpeg
chmod a+rx ./bin/ffmpeg

# 7. Post-build cleanup step: scrub package manager footprints to free up disk container allocation
npm prune --production

echo "Production deployment pipeline compiled completely!"
