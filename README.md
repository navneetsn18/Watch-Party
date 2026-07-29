# 🎬 Watch Party — Offline Edition (v3)

Watch videos in perfect sync with people, argue about the movie in chat, and throw floating emojis at the screen. Now **100% local**: no AWS, no cloud bills, no passwords, no internet required*. Your PC is the server, a folder is the cloud, and a single SQLite file is the database.

<sub>*Internet only needed if you want to invite people outside your network via a tunnel. The app itself doesn't phone anywhere.</sub>

---

## 🚀 Features

* **Real-time synchronized playback** — play, pause, and seek broadcast to everyone in the room. Host sneezes on the spacebar, everybody pauses.
* **Name-only login** — type a name, you're in. Same name next time = same profile. There are no passwords because there is nothing to steal; the "database" is a file on your machine.
* **Host & guest controls** — first into the room wears the crown 👑. Host can lock controls; locked-out guests send polite play/pause/skip requests the host approves or rejects.
* **Who's watching** — the viewer-count badge in the room shows a hover list of everyone watching, with avatars, flags, and a crown on the host.
* **Local HLS transcoding** — uploads are chopped into 4-second `.ts` segments by ffmpeg *on your machine* for smooth seeking. MP4s get codec-copy (near-instant); MKV/AVI/everything-else re-encode to H.264/AAC, which also fixes the classic "MKV plays but has no audio" browser problem.
* **Background uploads** — start an upload, wander off to watch something else in the same tab, upload several files at once. Status list shows progress/speed/ETA per file.
* **Feed** — grid of uploads with thumbnails; one click starts a watch party. Mark a video Private to keep it off everyone else's feed.
* **Chat & reactions** — room chat plus emoji that float up the screen like balloons (they used to shoot; we fixed their attitude).
* **Watch YouTube together, with a queue** — anyone in the room can paste a YouTube link (or a playlist link — up to 15 videos, YouTube's public feed limit) into the Videos tab. If guest controls are on, it plays immediately (or joins the queue if something's already playing); if guest controls are off, guest additions sit as "pending" until the host approves or rejects them. When a video finishes, the next approved item in the queue starts automatically — no one has to babysit the player. Caveats: public/unlisted videos only (members-only and age-restricted videos block embedding — that's YouTube, not us), and ads may briefly desync viewers until the drift correction reels everyone back in. This is the one feature that needs internet, for reasons that should be obvious.

**Removed on purpose** (this is the couch edition): passwords, email, friend requests, user search, verified badges, and every AWS invoice.

---

## 🧠 Architecture

```
Browser ──(one streaming POST)──► ./videos/<name>.mp4
   │                                   │
   │                              ffmpeg (local)
   │                                   ▼
   │                          ./videos/hls/<name>/segment000.ts ...
   │
Playback: /api/video-url → HLS if transcoded, range-streaming if not
Data:     ./data/watchparty.db (SQLite — delete it to factory-reset)
Rooms:    Socket.io, in-memory (rooms die with the server, as rooms should)
```

Upload bytes stream straight to disk (constant memory — a 6GB file uses the same RAM as a 6MB one). Videos are registered the moment the copy finishes, so they're watchable raw immediately and silently upgrade to HLS when ffmpeg is done.

---

## 🛠️ Tech Stack

| Layer | Thing |
|---|---|
| Frontend | Next.js 15, React 19, Tailwind, framer-motion, lucide-react |
| Realtime | Socket.io |
| Backend | Node.js + Express, one `server.js` |
| Database | **SQLite** (better-sqlite3) — one file, zero setup |
| Storage | **A folder.** `./videos` |
| Transcoding | **Your ffmpeg** |
| Streaming | hls.js, 4-second segments |

---

## 💻 Setup (the whole thing)

### Prerequisites
* **Node.js v18+**
* **FFmpeg** — `brew install ffmpeg` (Mac) / `sudo apt install ffmpeg` (Linux) / `winget install ffmpeg` (Windows). Optional but strongly recommended: without it videos still play via range streaming, but no HLS segments and no MKV audio rescue.

### Run
```bash
npm install
npm run dev          # or: npm run build && npm start (faster pages)
```

Open [http://localhost:3000](http://localhost:3000). Type a name. That's the entire onboarding.

No `.env.local` needed. No AWS account. No cloud console tabs. The server prints where everything lives on boot:

```
🎬 Watch Party (offline edition) on http://localhost:3000
   Data: ./data/watchparty.db | Videos: ./videos | FFmpeg: yes
```

### Where your stuff lives
```
data/watchparty.db      users + video metadata (delete = fresh start)
videos/                 raw uploaded files
videos/hls/<name>/      transcoded segments (index.m3u8 + segment000.ts ...)
public/uploads/         avatars + thumbnails
```

Pro tip: you can also just **drop video files into `videos/` manually**... except they won't be in the database, so don't. Upload through the app; it handles naming, transcoding, and registration.

---

## 🌍 Movie Night With Remote Friends

The app binds to your machine, but a free Cloudflare quick tunnel makes it reachable anywhere for the evening:

```bash
# terminal 1
npm run build && npm start

# terminal 2
brew install cloudflared      # once
cloudflared tunnel --url http://localhost:3000
```

Share the printed `https://something.trycloudflare.com` URL. Friends stream *from your machine*, so your upload bandwidth is the ceiling — realistically 2-3 remote viewers on a home connection. Keep the Mac awake (`caffeinate -dims`). Ctrl-C the tunnel when the credits roll; the URL dies with it.

Same-network viewers (same WiFi) don't need a tunnel: give them `http://<your-local-ip>:3000`.

---

## 🔥 Troubleshooting

**"Video has no audio"**
It's a raw MKV/AVI with DTS or AC3 audio, and HLS hasn't finished (or ffmpeg is missing). Wait for the transcode — the HLS version converts audio to AAC. If ffmpeg isn't installed, install it and re-upload.

**"Transcoding takes forever"**
MP4 inputs are codec-copied — near-instant. Non-MP4 inputs re-encode, which takes real CPU time (roughly 0.5-2x the movie's duration depending on your machine). It runs in the background; the video is watchable raw meanwhile.

**"I want to start over"**
```bash
rm -rf data videos public/uploads
```
Everything gone. The app recreates the folders on next boot.

**"My upload vanished when I reloaded the tab"**
Uploads survive navigating *within* the app, not tab reloads. There's a warning dialog. The half-written file in `videos/` gets overwritten by name-collision handling on retry.

**"Someone hijacked my username"**
Yes — anyone who types your name *is* you. That's the deal with password-less login on a private server. If your friends are the type to impersonate you and delete your movies, you need better friends, not better auth.

---

## 🤝 House Rules for Contributors

1. Upload bytes are **piped**, never buffered. A 6GB file must cost megabytes of RAM, not gigabytes.
2. Don't mark user-initiated play/pause/seek as "programmatic" in VideoPlayer — those counters suppress echo from *remote* commands; suppressing local actions kills room sync. The comment in the code explains this. Believe the comment.
3. If you add a component, import it. `<UserMinus>` remembers what it did.
4. This branch (`full-local`) is the offline edition. The AWS/cloud version lives in the git history and on `main` — don't cross the streams.
