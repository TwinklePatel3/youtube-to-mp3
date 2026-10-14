# YouTube Audio – YouTube to tagged MP3

Paste a YouTube link and get an MP3 with the title, artist, album, year and cover art already filled in, ready for Apple Music or any other library.

- **Frontend:** React (Vite) + Tailwind CSS
- **Backend:** Node.js + Express, using `yt-dlp` for the audio, `ffmpeg` for conversion and `sharp` for cover art

> **Use it responsibly.** Downloading from YouTube can violate YouTube's Terms of Service and copyright law. Only convert content you have the right to download, and keep this a personal tool.

---

## Features

- **Link in, MP3 out:** works with normal links, `youtu.be`, YouTube Music and **Shorts** links
- **Two qualities:** 128 kbps or 320 kbps
- **Proper tags:** title, artist(s), album, year, genre, composer, track number (ID3v2.3), plus embedded cover art
- **Smart metadata:** reads the video's credits and title, then confirms against the **Apple Music catalog** (iTunes Search API) for the real artist list, album, year, genre and official cover. A match is used only when it is confident
- **Edit tags** before downloading, with a live preview
- **Cover picker:** automatic, Apple Music, YouTube thumbnail, or your own upload (JPG, PNG, WebP). Covers are made square, sRGB, baseline JPEG, which Apple Music displays correctly
- **Audio options:** even out the volume (loudness normalization to about −16 LUFS) and trim the start or end
- **Works on phones:** the finished file is served from a normal download link, so it saves correctly in Safari and in-app browsers such as the Documents app
- **Live progress and Cancel**
- **Built-in diagnostics** for YouTube's bot check (see [Troubleshooting](#troubleshooting))

---

## How it works

```
Browser (React)                         Backend (Express)
────────────────                        ─────────────────────────────────────────
1. POST /api/song           ───────►    quick preview from YouTube oEmbed + Apple Music
2. POST /api/song-details   ◄─ poll ─   full details from yt-dlp (background, low priority)
3. POST /api/download       ───────►    starts a background job, returns downloadId
4. GET  /api/status/:id     ◄─ poll ─   progress 0–100 → ready
5. GET  /api/file/:id       ───────►    the finished MP3 (a normal file download)

Background job:  yt-dlp (audio + info) ──► ffmpeg (MP3 + tags + cover) ──► temp file
```

One `yt-dlp` run per download supplies both the audio and the metadata. Converted files are kept for about 20 minutes and then deleted.

---

## Project structure

Adjust to your own layout.

```
.
├── backend/
│   ├── server.js              # the whole API
│   ├── youtube-cookies.txt    # optional, see "YouTube bot check"
│   ├── bin/                   # optional bundled ffmpeg / yt-dlp
│   └── .venv/                 # optional Python venv containing yt-dlp
└── frontend/
    └── src/
        ├── App.jsx            # the whole interface
        └── App.css
```

---

## Requirements

| Tool | Notes |
|---|---|
| **Node.js 18+** | 20 or 22 recommended. yt-dlp also uses Node to solve YouTube's JavaScript challenges |
| **yt-dlp** | install with `pip install -U "yt-dlp[default]"`. The `[default]` part matters. Keep it up to date |
| **ffmpeg** | must include the `libmp3lame` encoder |
| **Python 3.10+** | only to install yt-dlp |

The server looks for `ffmpeg` and `yt-dlp` in this order: environment override (`FFMPEG_PATH`, `YT_DLP_PATH`), `./bin/`, `./.venv/bin/` (yt-dlp), the `ffmpeg-static` npm package (ffmpeg), then your system `PATH`.

---

## Run locally

### Backend

```bash
cd backend
npm install express cors sharp
npm install ffmpeg-static            # optional, if ffmpeg is not installed
pip install -U "yt-dlp[default]"     # or use a virtualenv
node server.js
```

The API starts on `http://localhost:5001`. Open `http://localhost:5001/health` and check that `tools` shows yt-dlp and ffmpeg versions and `mp3Encoder: true`.

### Frontend

```bash
cd frontend
npm install
echo "VITE_API_URL=http://localhost:5001" > .env
npm run dev
```

Open the printed address (usually `http://localhost:5173`). That origin is already allowed by the backend's default CORS list.

---

## Configuration

All settings are environment variables on the **backend**, and all are optional.

### Server

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5001` | Port to listen on |
| `NODE_ENV` | – | Set to `production` on your host |
| `CORS_ORIGINS` | localhost ports + sample deployments | Comma-separated list of allowed frontend origins, or `*` for any. **Setting it replaces the whole default list** |
| `WORKERS` | `1` in production, up to 4 locally | Number of worker processes (cluster mode shares state through the primary process) |
| `MAX_JOBS` | `2` | Conversions running at once, per worker. Keep `WORKERS × MAX_JOBS` at or below your CPU cores |
| `MAX_QUEUE` | `20` | Waiting jobs per worker. Beyond this the API answers `503` |
| `FFMPEG_PATH`, `YT_DLP_PATH` | auto-detected | Explicit paths to the binaries |

### Tags and covers

| Variable | Default | Purpose |
|---|---|---|
| `ITUNES` | on | Set to `0` to turn off Apple Music matching |
| `ITUNES_COUNTRIES` | `IN,US` | Apple storefronts to search, in order |
| `COVER_SIZE` | `1400` | Cover size in pixels, limited to 1400–3000 |
| `COVER_MODE` | `crop` | `crop` centre-crops to a square. `blur` keeps the whole frame on a blurred background |
| `BACKGROUND_META` | on | Set to `0` to skip the background lookup used to enrich the preview card |
| `INFO_TIMEOUT_MS` | `120000` | How long to wait for yt-dlp to produce video information |

### YouTube access

| Variable | Purpose |
|---|---|
| `YT_COOKIES_B64` | Base64 of a `cookies.txt` file (see below) |
| `YT_COOKIES_FILE` | Path to a `cookies.txt` file |
| `YT_PROXY` | Proxy for yt-dlp, for example `http://user:pass@host:port` |
| `YT_EXTRA_ARGS` | Extra yt-dlp options, space separated |
| `YT_AUTO_CLIENT` | `1` = use the first working YouTube client for all downloads, and find one automatically when the bot check appears |
| `YT_CLIENT_CANDIDATES` | Clients tried by the sweep. Default `default,web_safari,mweb,tv,tv_simply,web_embedded,android_vr,ios` |
| `YT_SELFTEST` | Set to `0` to skip the startup check against YouTube |

### Frontend

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Backend address, for example `https://your-backend.onrender.com` |

---

## API

All JSON unless noted.

| Method and path | Body / query | Returns |
|---|---|---|
| `GET /health` | `?recheck=1&url=<video>` re-tests YouTube for one video. `?sweep=1&url=<video>` tries other YouTube clients | Server, tools and YouTube status |
| `POST /api/song` | `{ url }` | Preview: `song_name`, `artist`, `album`, `year`, `cover`, `detailsReady`, `videoId` … |
| `POST /api/song-details` | `{ url }` | `{ ready: false }` until the full details exist, then `{ ready: true, … }` |
| `POST /api/cover` | raw image body (`Content-Type: image/jpeg`, `image/png` or `image/webp`, up to 6 MB) | `{ coverId }` |
| `POST /api/download` | `{ url, quality: "128" or "320", delivery: "link", tags?, cover?, audio? }` | `{ downloadId }` |
| `GET /api/status/:id` | – | `{ progress, ready, name, size }` or `{ error: true, message }` |
| `POST /api/cancel` | `{ id }` | `{ ok: true }` |
| `GET /api/file/:id` | – | The MP3 (`Content-Disposition: attachment`, supports range requests) |

**Optional download fields**

```jsonc
{
  "tags":  { "title": "", "artist": "", "album": "", "year": "2009", "genre": "", "composer": "" },
  "cover": { "source": "auto | apple | youtube | custom", "coverId": "<from /api/cover>" },
  "audio": { "normalize": true, "trimStart": 12.5, "trimEnd": 190 }   // seconds
}
```

Older routes `GET /api/download-file?id=` and `GET /api/progress/:id` (server-sent events) are kept for backward compatibility.

---

## Deployment

### Backend on Render (Web Service)

- **Build command**

  ```bash
  npm install && npm install ffmpeg-static && python3 -m venv .venv && .venv/bin/pip install -U "yt-dlp[default]"
  ```

- **Start command:** `node server.js`
- **Environment:** `NODE_ENV=production`, `CORS_ORIGINS=https://your-frontend.example`
- After deploying, open `/health` and confirm the tools and the `youtube` check.

Free plans sleep when idle (the first request after a pause is slow) and have little CPU and memory. Keep `WORKERS=1` there.

### Frontend on Vercel / Netlify / Render Static Site

- **Build command:** `npm run build`, **publish directory:** `dist`
- **Environment:** `VITE_API_URL=https://your-backend.example`
- Add the frontend's address to the backend's `CORS_ORIGINS`.

---

## Troubleshooting

### "Sign in to confirm you're not a bot"

YouTube often blocks requests from data-center servers such as Render. It works on your own computer because home internet addresses are trusted. Try these in order:

1. **Add cookies.** Sign in to YouTube in a **private window**, export the `youtube.com` cookies in Netscape `cookies.txt` format, close the private window straight away, and give the file to the server in one of these ways:
   - a Render **Secret File** named `youtube-cookies.txt`, or
   - the environment variable `YT_COOKIES_B64`. On macOS: `base64 -i cookies.txt | tr -d '\n' | pbcopy`

   Cookies expire, so you may need to export fresh ones now and then. Using a separate Google account is wise.
2. **Check it worked.** Open `/health`. `tools.cookies` should show `loaded: true` and a `youtubeCookies` count above 0, and `youtube.status` should be `ok`.
3. **Test the exact video.** Open `/health?recheck=1&url=<video link>`, wait about 10 seconds, then reload `/health`.
4. **Find a working YouTube client.** Open `/health?sweep=1&url=<video link>`, wait 1–2 minutes, then read `youtubeSweep.recommended`. Either set `YT_EXTRA_ARGS="--extractor-args youtube:player_client=<client>"` or set `YT_AUTO_CLIENT=1`.
5. **Use a proxy** (`YT_PROXY`, usually a paid residential one), or **run the backend at home** behind a tunnel such as Cloudflare Tunnel.

### Other problems

| Symptom | Likely cause and fix |
|---|---|
| Browser shows a CORS error | The frontend's address is missing from `CORS_ORIGINS`. It must match exactly, with no path |
| `/health` shows a tool as `MISSING` | Install it, or set `FFMPEG_PATH` / `YT_DLP_PATH` |
| `mp3Encoder: false` | Your ffmpeg lacks `libmp3lame`. Use `ffmpeg-static` or another full build |
| Download does nothing in the Documents app or Safari | Use the **Save MP3** button on the "ready" card. Make sure the backend is the current version (it must have `/api/status` and `/api/file`) |
| Tags or cover look wrong in Apple Music | Apple Music caches tags by track. Remove the old track, then re-import the new file |
| Wrong artist or album | Use **Edit tags**. Apple Music matching only covers commercial releases, so remixes and fan uploads fall back to YouTube's data |
| `503 The converter is busy` | The job queue is full. Retry in a few seconds or raise `MAX_JOBS` if your CPU allows it |
| First request after a long pause is very slow | The host was asleep. A free uptime monitor pinging `/health` every few minutes keeps it awake |
| Conversion fails with a yt-dlp error | Update yt-dlp (`pip install -U "yt-dlp[default]"`), because YouTube changes often |

---

## Tags: how the artist and album are chosen

**Artist**, in priority order:
1. YouTube's official artist fields
2. The "Provided to YouTube by…" block in auto-generated descriptions
3. Credits in the description (`Singer: …`, `Music: …`)
4. An "Artist - Song" pattern in the title (label channels such as T-Series are treated as "Song - Movie")
5. The channel name

Multiple artists are written as `Artist One, Artist Two, Artist Three`. The release year is never taken from the upload date, because re-uploads would make old songs look new. It comes from a release date, a `℗ 2009` / `© 2009` line, or Apple Music.

When Apple Music has a confident match (artist name, track length or album name in the video title), its title, artists, album, year, genre, track number and cover replace the YouTube data. Whatever you type in **Edit tags** always wins.

---

## Notes and limits

- Converted files and uploaded covers are temporary and removed automatically after roughly 20–25 minutes.
- Cover uploads are limited to 20 per 10 minutes per visitor.
- State (progress, job info) lives in memory. If the server restarts during a conversion, that download is lost and must be started again.
- Loudness normalization is single-pass and uses extra CPU.
- Not affiliated with YouTube, Google or Apple.
