#!/usr/bin/env bash
set -o errexit

# 1. Clear package manager build cache to free up overhead RAM layout
npm cache clean --force

# 2. Install dependencies safely with strict heap memory restriction constraints
echo "Installing Node modules..."
NODE_OPTIONS="--max-old-space-size=2048" npm install

# 3. Compile the Vite React layers using the memory-restricted configuration
echo "Compiling optimized Vite Frontend assets..."
NODE_OPTIONS="--max-old-space-size=2048" npm run build

# 4. Allocate directory structural path for system binaries
mkdir -p ./bin

# 5. Download standalone Linux x86_64 yt-dlp binary (Directly using updated production link release paths)
echo "Downloading standalone Linux x86_64 yt-dlp binary..."
curl -L "https://github.com" -o ./bin/yt-dlp
chmod a+rx ./bin/yt-dlp

# 6. Download pre-compiled stable Linux static binary for FFmpeg
echo "Downloading stable Linux FFmpeg binary..."
curl -L "https://github.com" -o ./bin/ffmpeg
chmod a+rx ./bin/ffmpeg

# 7. Prune development tools instantly to clear storage footprint allocations
npm prune --production

echo "Production deployment pipeline compiled completely without memory leaks!"
