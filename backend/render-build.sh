#!/usr/bin/env bash
set -o errexit

# 1. Install standard npm dependencies
npm install

# 2. Create custom execution bin directory
mkdir -p ./bin

# 3. Pull latest Linux standalone binary for yt-dlp
echo "Downloading static yt-dlp binary..."
curl -L https://github.com -o ./bin/yt-dlp
chmod a+rx ./bin/yt-dlp

# 4. Pull pre-compiled stable Linux static binary for FFmpeg
echo "Downloading static FFmpeg binary..."
curl -L https://github.com -o ./bin/ffmpeg
chmod a+rx ./bin/ffmpeg

echo "Render custom pipeline dependencies built successfully!"
