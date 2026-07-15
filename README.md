# 🎬 Watch Party (v2.0.0)

Watch videos with your friends in perfect sync, argue about what to watch in the chat, and throw flying emojis at the screen — all without anyone shouting "wait pause PAUSE" into a group call.

Built with **Next.js 15**, **Express**, **Socket.io**, **DynamoDB**, **S3**, and **AWS MediaConvert**. Runs happily on a free-tier EC2 instance, because we learned the hard way what happens when it doesn't (see [War Stories](#-war-stories-aka-troubleshooting)).

---

## 🚀 Features

* **Real-time synchronized playback** — play, pause, and seek are broadcast to everyone in the room. If the host sneezes on the spacebar, everybody pauses.
* **Host & guest controls** — first person in the room is the host 👑. Host can lock playback controls; locked-out guests can *politely request* a play/pause/skip, which the host approves or rejects like a tiny bouncer.
* **Background uploads** 🆕 — start an upload, then wander off to watch something else *in the same tab*. Upload several files at once. A status list on the upload page shows progress, speed, ETA, and transcode percent for each. (Reloading the tab kills uploads — browsers are like that. You'll get a warning first.)
* **Direct-to-S3 multipart uploads** — your video travels browser → S3 in 100MB parts, 4 in parallel. The server never touches a single video byte. It just signs URLs and feels important.
* **Serverless HLS transcoding** — AWS MediaConvert chops videos into 4-second segments for smooth streaming. Your EC2 does none of this work. It has one vCPU and a dream, and we protect both.
* **Auth & profiles** — email/password (bcrypt), JWT sessions, custom avatars, country flags 🇮🇳, private accounts, and Twitter-style verified badges for the chosen ones.
* **Friends system** — send/accept/decline requests. Private users' videos are visible to friends only.
* **Feed** — YouTube-style grid of public uploads with thumbnails. One click starts a watch party.
* **Chat & reactions** — room chat with join/leave notifications, plus emoji that fly across the video like confetti with commitment issues.
* **Fullscreen niceties** — auto-hiding controls, chat notifications overlaid in fullscreen, fake-fullscreen fallback for stubborn browsers.

---

## 🧠 Architecture (or: Why the Server Is So Relaxed)

The golden rule of this codebase: **video bytes never pass through the EC2 instance.** Every time we broke this rule, the server died. We stopped breaking it.

```
UPLOAD                                          PLAYBACK
──────                                          ────────
Browser ──(100MB parts, ×4 parallel)──► S3     Browser ──► GET /api/video-url
   │                                               │
   └─► server: sign URLs, complete,                ├─ HLS exists?  .m3u8 manifest proxied (tiny),
       write DynamoDB record                       │   .ts segments 302-redirect to presigned S3
   │                                               │   (bytes: S3 ──► browser, server watches)
MediaConvert ──► HLS segments ──► S3               └─ No HLS yet?  presigned raw URL
   (server polls job status, logs errors)             (video is watchable immediately;
                                                        upgrades to HLS when the job finishes)
```

The video's DynamoDB record is written the moment S3 assembly completes — so a freshly uploaded video is instantly watchable as a raw file, and silently upgrades itself to HLS when MediaConvert finishes. If MediaConvert fails (looking at you, MKV with DTS audio), the video just stays raw. No drama.

---

## 🛠️ Tech Stack

| Layer | Thing | Why |
|---|---|---|
| Frontend | Next.js 15, React 19, Tailwind CSS, framer-motion, lucide-react | It's 2026 |
| Realtime | Socket.io | Rooms, sync, chat, flying emoji transport |
| Backend | Node.js + Express (custom server) | One process, one `server.js`, zero microservices |
| Database | DynamoDB | Users, friendships, video metadata |
| Storage | S3 | Videos, HLS segments, avatars, thumbnails |
| Transcoding | AWS MediaConvert | So the EC2 doesn't have to (it can't) |
| Streaming | hls.js | 4-second segments, buffers ~90s ahead |
| Process manager | PM2 | Turns crashes into restarts |

---

## 📁 Project Structure

```text
├── app/                    # Next.js App Router pages
│   ├── auth/               # Login / register
│   ├── feed/               # Public video grid
│   ├── search/             # Find friends
│   ├── profile/            # Profile, friends, my videos
│   ├── upload/             # Upload form + background task list
│   └── room/[roomId]/      # The main event
├── components/             # VideoPlayer, ChatPanel, NavBar, etc.
├── lib/
│   ├── uploadManager.js    # Module-level upload brain — survives page navigation
│   ├── socket.js           # Shared Socket.io client
│   └── supabase.js         # Mock Supabase client wrapping our own JWT auth (long story)
├── server.js               # Express + Socket.io + all API routes (~1.9k lines of honest work)
└── .env.local              # Secrets go here, not in git, we beg you
```

---

## 💻 Local Development

### 1. Prerequisites
* **Node.js v18+**
* An AWS account (DynamoDB is required even locally — auth lives there)
* FFmpeg is **not** required anymore. We fired it. MediaConvert took its job.

### 2. Install & configure

```bash
npm install
```

Create `.env.local`:

```env
PORT=3000
JWT_SECRET=pick-something-long-and-random-not-this
VIDEO_SOURCE=s3                          # 'local' works for ./videos folder testing
AWS_REGION=ap-south-1
S3_BUCKET_NAME=your-bucket-name
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_MEDIACONVERT_ROLE_ARN=arn:aws:iam::123456789:role/MediaConvertRole
```

⚠️ **Set `JWT_SECRET`.** There is a fallback default in the code and it is exactly as secure as leaving your house key under a mat labeled "KEY UNDER HERE".

### 3. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), register an account, upload something short, feel powerful.

---

## ☁️ AWS Setup

### 1. DynamoDB Tables (create these three)

| Table | Partition key | Sort key | GSI |
|---|---|---|---|
| `watch_party_users` | `email` (S) | — | `username-index` on `username` |
| `watch_party_friendships` | `senderId` (S) | `receiverId` (S) | `receiverId-index` on `receiverId` |
| `watch_party_videos` | `filename` (S) | — | — |

On-demand capacity mode. This app's traffic will not trouble DynamoDB. DynamoDB will not notice this app exists.

### 2. S3 Bucket

The app organizes the bucket like a responsible adult:

```
videos/               raw uploads
videos/hls/<name>/    MediaConvert output (manifests + segments)
avatars/              profile pictures
thumbnails/           video thumbnails
```

#### CORS — get this right or nothing works

The browser talks to S3 directly for **both** uploads (PUT, and it must read the `ETag` header back) **and** HLS playback (GET, via redirects). Bucket → Permissions → CORS:

```json
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "PUT", "HEAD"],
        "AllowedOrigins": ["*"],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3600
    }
]
```

*(Tighten `AllowedOrigins` to your domain in production. Presigned URLs already gate access, but belts and suspenders.)*

#### Lifecycle rule — the invisible money leak

Cancelled uploads leave invisible, **billed** multipart fragments in S3 forever. Add a lifecycle rule: Bucket → Management → Create rule → check **"Delete expired object delete markers or incomplete multipart uploads"** → abort incomplete multipart uploads after **1 day**. Takes 30 seconds, saves real money.

### 3. MediaConvert IAM Role

MediaConvert needs a role it can assume to read/write your bucket:

1. IAM → Roles → Create role → trusted entity: **MediaConvert**.
2. Attach a policy with `s3:GetObject` and `s3:PutObject` on `arn:aws:s3:::your-bucket/*`.
3. Put the role ARN in `AWS_MEDIACONVERT_ROLE_ARN`.

No role ARN = no transcoding = videos stay raw. The app survives this gracefully, but Safari users watching raw MKVs will not.

### 4. EC2 IAM Role (recommended)

Give the instance a role with `s3:ListBucket`, `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on your bucket, plus `mediaconvert:*Job*` and `mediaconvert:DescribeEndpoints`, plus DynamoDB read/write on the three tables. Or use access keys in `.env.local` like a rebel.

---

## 🚀 Deploy to EC2

Free tier (t2/t3.micro, 1GB RAM) works. This app was *forged* on free tier.

```bash
# Node + PM2
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
npm install -g pm2

# 1GB of RAM will not survive `next build` without swap. Give it swap.
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# App
git clone <your-repo> && cd Watch-Party
npm install
# create .env.local (see above, VIDEO_SOURCE=s3)
npm run build
pm2 start npm --name watch-party -- start
pm2 startup   # run the command it prints
pm2 save
```

### The Sacred Deploy Ritual 🕯️

Every deploy, in this order, no skipping:

```bash
git pull && npm install && npm run build && pm2 restart all
```

Then **hard-refresh the browser** (Ctrl+Shift+R). Roughly half of all "it's still broken" reports in this project's history were a stale build or a cached bundle. The other half were real bugs, but *you* don't know which half you're in until you refresh.

---

## 🔥 War Stories (aka Troubleshooting)

Lessons paid for in downtime, presented free of charge:

**"The server crashes when I upload a big file"**
It shouldn't anymore — uploads go straight to S3. If it does, you're running an ancient build where 6GB files were assembled in RAM. 1GB of RAM cannot hold 6GB of video; this is not a bug, this is arithmetic. Do the Sacred Deploy Ritual.

**"CPU hits 100% when someone plays a video"**
Old builds proxied every HLS segment through the server while hls.js prefetched two minutes of video. One viewer = one very busy potato. Current code 302-redirects segments to S3. Verify: play a video, DevTools → Network — `.ts` requests should be 302s followed by `amazonaws.com` fetches. If segments return 200 from your server: stale build. Ritual.

**"Video doesn't start at all"**
1. Check the bucket CORS has `GET` (see above). Without it, hls.js fails every segment and used to retry *forever* (also fixed — it gives up after 5 attempts now, like a healthy adult).
2. Check `VIDEO_SOURCE=s3` in `.env.local` on the server.
3. DevTools console — if you see red CORS errors on `.ts` files, it's the bucket. It's always the bucket.

**"I uploaded an MKV and there's no HLS folder"**
MediaConvert accepts MKV *containers* but often rejects what's inside — DTS or Vorbis audio are common assassins. The job fails, the video stays raw, Chrome might play it, Safari absolutely will not. Check `pm2 logs` for `[MEDIACONVERT] Job ... FAILED` with the actual error. Best fix — re-encode before uploading:
```bash
ffmpeg -i movie.mkv -c:v copy -c:a aac -movflags +faststart movie.mp4
```
(Video track copied, no quality loss, ~as fast as a file copy. Do this on your own machine — the EC2 has suffered enough.)

**"No space left on device"**
Old builds hoarded video chunks on disk. Current code writes almost nothing locally, but if you're excavating an old instance:
```bash
df -h /
rm -rf videos/tmp/ videos/hls/
npm cache clean --force
pm2 flush
sudo journalctl --vacuum-size=50M
```

**"My upload vanished when I refreshed the page"**
Yes. Uploads survive *navigating within the app*, not reloading the tab — the browser destroys the JS context and the upload with it. There's a warning dialog before you do it. The half-uploaded S3 parts get cleaned up by the lifecycle rule (you did add the lifecycle rule, right?).

---

## 🤝 Contributing

PRs welcome. House rules, learned the hard way:

1. Video bytes never touch the server. **Never.**
2. Don't mark user-initiated play/pause/seek as "programmatic" in VideoPlayer — those suppression counters exist to prevent echo from *remote* commands, and suppressing local actions silently kills room sync. There's a comment in the code that says this. Believe the comment.
3. If you add a component, import it. `<UserMinus>` remembers.
