#!/usr/bin/env bash
set -o errexit

echo "Installing Node dependencies..."
npm install

mkdir -p ./bin

echo "Installing yt-dlp..."
python3 -m pip install --break-system-packages -U yt-dlp

echo "Downloading FFmpeg..."
curl -L \
  "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-gpl.tar.xz" \
  -o /tmp/ffmpeg.tar.xz

mkdir -p /tmp/ffmpeg

tar -xf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg

cp /tmp/ffmpeg/ffmpeg-master-latest-linux64-gpl/bin/ffmpeg ./bin/ffmpeg

chmod +x ./bin/ffmpeg

echo "Checking yt-dlp..."
python3 -m yt_dlp --version

echo "Checking FFmpeg..."
./bin/ffmpeg -version

echo "Production dependencies installed successfully!"