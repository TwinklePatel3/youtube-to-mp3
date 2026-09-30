#!/usr/bin/env bash
set -o errexit

# 1. Install regular node package modules
npm install

# 2. Allocate space for our production binary execution directory
mkdir -p ./bin

# 3. 🚀 FIXED: Download the real raw python executable bundle script (Not an HTML redirect page)
echo "Downloading clean raw python yt-dlp source execution bundle..."
curl -L "https://github.com" -o ./bin/yt-dlp
chmod a+rx ./bin/yt-dlp

# 4. Download pre-compiled stable Linux static binary for FFmpeg
echo "Downloading stable Linux FFmpeg binary..."
curl -L https://github.com -o ./bin/ffmpeg
chmod a+rx ./bin/ffmpeg

echo "Production deployment binaries successfully mounted!"
