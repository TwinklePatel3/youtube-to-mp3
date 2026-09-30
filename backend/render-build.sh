#!/usr/bin/env bash
set -o errexit

# 1. Install regular node package modules and compile frontend dist assets
npm install
echo "Building Vite Frontend..."
npm run build

# 2. Allocate space for our production execution directory
mkdir -p ./bin

# 3. 🚀 FIXED: Install absolute latest python executable of yt-dlp via pip to avoid HTML redirect blocks
echo "Installing official yt-dlp via pip..."
python3 -m pip install --upgrade --target=./bin yt-dlp

# Move or symlink the entry point so our server script can find it inside the ./bin folder
mv ./bin/bin/yt-dlp ./bin/yt-dlp || true

# 4. Download pre-compiled stable Linux static binary for FFmpeg
echo "Downloading stable Linux FFmpeg binary..."
curl -L "https://github.com" -o ./bin/ffmpeg
chmod a+rx ./bin/ffmpeg

echo "Production deployment binaries successfully mounted!"
