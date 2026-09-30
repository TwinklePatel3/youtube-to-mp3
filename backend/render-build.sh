#!/usr/bin/env bash
set -o errexit

# 1. Install regular node package modules
npm install

# 2. Allocate space for global-mimicked binaries
mkdir -p ./bin

# 3. Pull standalone linux x86_64 binary for yt-dlp
echo "Downloading stable yt-dlp binary..."
curl -L https://github.com -o ./bin/yt-dlp
chmod a+rx ./bin/yt-dlp

# 4. Pull pre-compiled linux x86_64 binary for FFmpeg
echo "Downloading stable FFmpeg binary..."
curl -L https://github.com -o ./bin/ffmpeg
chmod a+rx ./bin/ffmpeg

echo "Monorepo backend pipeline compiled completely!"
