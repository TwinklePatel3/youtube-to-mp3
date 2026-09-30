
#!/usr/bin/env bash
set -e

echo "Installing production Node dependencies..."
npm install --omit=dev --no-audit --no-fund

echo "Creating Python virtual environment..."
python3 -m venv .venv

echo "Installing yt-dlp..."
./.venv/bin/python -m pip install --no-cache-dir --upgrade pip
./.venv/bin/python -m pip install --no-cache-dir -U "yt-dlp[default]"

echo "Checking yt-dlp..."
./.venv/bin/yt-dlp --version

echo "Creating FFmpeg directory..."
mkdir -p ./bin

echo "Downloading FFmpeg..."
curl -fL \
  "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-gpl.tar.xz" \
  -o /tmp/ffmpeg.tar.xz

echo "Extracting FFmpeg..."
mkdir -p /tmp/ffmpeg
tar -xf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg

cp /tmp/ffmpeg/ffmpeg-master-latest-linux64-gpl/bin/ffmpeg ./bin/ffmpeg
chmod +x ./bin/ffmpeg

echo "Checking FFmpeg..."
./bin/ffmpeg -version

echo "Build completed successfully!"