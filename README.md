# 🎬 Watch Party (v2.0.0)

A Netflix-style synchronized watch party web application built with **Next.js**, **Express**, **Socket.io**, and **AWS S3** integration. Users can join sync-locked rooms to chat, react, and watch videos together with real-time play, pause, and seek synchronization.

---

## 🚀 Key Features

* **Real-time Synchronized Playback**: Play, pause, and seek actions are instantly synchronized across all users in a room using Socket.io.
* **Host & Guest Controls**: The first user to join a room becomes the host. The host can toggle guest controls to allow or restrict guests from controlling video playback.
* **AWS S3 & Local Video Storage**: Easily switch between streaming videos from an AWS S3 bucket or a local `./videos` folder.
* **YouTube-Style Feed Grid**: A beautiful, responsive card layout grid displaying custom thumbnails, uploader avatars, creator names, country flags, and verified badges.
* **Decoupled S3 Asset Storage**: Automatically uploads and serves static assets (user profile avatars and custom video thumbnails) to S3 when configured, even if videos are stored/streamed locally.
* **Twitter-Style Verified Badges**: Uses a sleek inline Twitter-style blue tick SVG badge for verified creators in NavBar tooltips, search results, profile cards, explore feed, and room selectors.
* **Correct Chat Username Order**: Messages inside the room chat render usernames and badges dynamically in the correct order: `[Username] [Flag] [Verified SVG Badge]`.
* **Multi-Format Streaming Support**: Presigned URLs automatically override headers for formats like Matroska (`.mkv`), `.mp4`, `.webm`, `.mov`, and `.avi` to maximize browser compatibility.
* **Real-time Chat & Reactions**: Text chat with system notifications (e.g., joins/leaves) and emoji reactions.
* **Responsive Mobile Design**: Tailored CSS structure ensuring full access to video, chat, and room controls on mobile and tablet screens.

---

## 🛠️ Tech Stack

* **Frontend**: Next.js 15 (React 19), TailwindCSS (if configured) or Custom Responsive CSS
* **Backend**: Node.js, Express, Socket.io
* **Storage/Hosting**: AWS S3 (Video assets), AWS EC2 (Application server)
* **Process Manager**: PM2

---

## 📁 Project Structure

```text
├── app/                  # Next.js App Router (pages and layouts)
├── components/           # Reusable React components (Player, Chat, etc.)
├── videos/               # Local video directory (fallback / local dev)
├── server.js             # Express entrypoint & Socket.io handler
├── test-s3.js            # AWS S3 connectivity test script
├── package.json          # Node dependencies and scripts
└── .env.local            # Environment variables configuration
```

---

## 💻 Local Setup & Development

### 1. Prerequisites
* **Node.js (v18+)**
* **FFmpeg**: Required to convert uploaded videos into Netflix-style HLS (HTTP Live Streaming) format for lag-free synchronized playback.

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Create a `.env.local` file in the root directory:
```env
PORT=3000
VIDEO_SOURCE=local  # Or 's3' (Video streaming storage source)
AWS_REGION=ap-south-1
S3_BUCKET_NAME=watchpartyapp-online-1234
AWS_ACCESS_KEY_ID=your_access_key       # Required for local development S3 access
AWS_SECRET_ACCESS_KEY=your_secret_key   # Required for local development S3 access

```

### 4. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ☁️ Complete AWS Setup & Deployment Guide

This guide walks you through deploying the application on **AWS EC2** using **PM2** for process management and **AWS S3** for secure, scalable video streaming.

### Part 1: Configure AWS S3

Create an S3 bucket (e.g., `watchpartyapp-online-1234`). The application automatically organizes files in the bucket using the following folder structure:
- `videos/` - Holds raw video files (e.g., `videos/my-video.mp4`)
- `videos/hls/` - Holds HLS segment directories (e.g., `videos/hls/my-video/`)
- `avatars/` - Holds uploaded custom user profile avatars (e.g., `avatars/user-123.jpg`)
- `thumbnails/` - Holds uploaded custom video thumbnails (e.g., `thumbnails/user-123.jpg`)

*(Note: Custom user avatars and video thumbnails are automatically stored/served from these S3 folders if `S3_BUCKET_NAME` is configured, regardless of whether `VIDEO_SOURCE` is set to `local` or `s3` for video streaming).*

#### 2. Set Up CORS Policy
To allow your web application to request video streams from S3, you must configure CORS on the bucket:
1. Go to your S3 bucket in the **AWS Console**.
2. Select the **Permissions** tab.
3. Scroll down to **Cross-origin resource sharing (CORS)** and paste this configuration:
```json
[
    {
        "AllowedHeaders": [
            "*"
        ],
        "AllowedMethods": [
            "GET",
            "HEAD"
        ],
        "AllowedOrigins": [
            "*"
        ],
        "ExposeHeaders": [
            "Content-Range",
            "Accept-Ranges",
            "Content-Length",
            "Content-Type"
        ],
        "MaxAgeSeconds": 3000
    }
]
```
*(Note: You can replace `*` in `AllowedOrigins` with your domain or EC2 Public IP once it's finalized to increase security).*

---

### Part 2: Configure EC2 Instance IAM Role (Recommended)

To securely query S3 without storing sensitive credential files on the EC2 server, assign an IAM Role:
1. Open the **IAM Console** and create a role for **EC2**.
2. Attach a custom policy granting access to your bucket. Because the application handles user avatar uploads, custom video thumbnail uploads, and video/thumbnail deletions in addition to video streaming, the server requires read, write, and delete permissions:
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:ListBucket",
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject"
            ],
            "Resource": [
                "arn:aws:s3:::watchpartyapp-online-1234",
                "arn:aws:s3:::watchpartyapp-online-1234/*"
            ]
        }
    ]
}
```
3. Open the **EC2 Console**, select your EC2 instance.
4. Click **Actions** > **Security** > **Modify IAM Role**.
5. Select the newly created role and save.

*If you prefer not to use IAM Roles, you must add `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (with the same permissions listed above) to `.env.local` on the EC2 server.*

---

### Part 3: Deploy to EC2 Instance

#### 1. Connect and Install Environment
Connect to your EC2 instance via SSH and install Node.js and PM2:
```bash
# Install NVM & Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20

# Install PM2 globally
npm install -g pm2
```

#### 2. Deploy Project Code
Clone your repository or copy your code files onto the instance. Run installation inside the directory:
```bash
npm install
```

#### 3. Build & Configure App
Create the production environment file `.env.local` on the server:
```env
PORT=3000
VIDEO_SOURCE=s3
AWS_REGION=ap-south-1
S3_BUCKET_NAME=watchpartyapp-online-1234
```
Build the Next.js bundle:
```bash
npm run build
```

#### 4. Run with PM2
Start the app using PM2 under the production script:
```bash
pm2 start server.js --name "watch-party" --env NODE_ENV=production
```

To configure PM2 to automatically launch the application when the server reboots:
```bash
pm2 startup
```
*Run the command outputted by the terminal (usually starts with `sudo env PATH...`).*

Once completed, save the current PM2 state:
```bash
pm2 save
```

---

## 🎥 HLS Transcoding & FFmpeg Setup

The application automatically converts uploaded videos into Netflix-style HLS (HTTP Live Streaming) format (4-second segments) to ensure lag-free streaming, especially on mobile browsers.

For HLS transcoding to function, **FFmpeg must be installed on your server/EC2 instance**. If FFmpeg is not detected, HLS transcoding is disabled and the server falls back to raw video streaming.

### 1. Installing FFmpeg on EC2 (Step-by-Step Compilation Guide)

Follow this guide to compile and install FFmpeg from source on your EC2 instance:

#### Step 1: Install required dependencies
```bash
sudo yum install -y yasm nasm \
autoconf automake bzip2 bzip2-devel cmake freetype-devel \
gcc gcc-c++ git libtool make pkgconfig zlib-devel
```

#### Step 2: Create a directory for FFmpeg source files
```bash
mkdir ~/ffmpeg_sources
cd ~/ffmpeg_sources
```

#### Step 3: Download and extract FFmpeg source
```bash
curl -O -L https://ffmpeg.org/releases/ffmpeg-snapshot.tar.bz2
tar xjvf ffmpeg-snapshot.tar.bz2
cd ffmpeg
```

#### Step 4: Configure FFmpeg build
```bash
./configure \
--prefix="/opt/ffmpeg" \
--bindir="/opt/ffmpeg/bin" \
--extra-cflags="-I/opt/ffmpeg/include -fstack-protector-strong -fpie -pie -Wl,-z,relro,-z,now -D_FORTIFY_SOURCE=2" \
--extra-ldflags="-L/opt/ffmpeg/lib" \
--extra-libs=-lpthread \
--extra-libs=-lm \
--enable-libfreetype \
--disable-static \
--enable-shared \
--enable-rpath
```

#### Step 5: Compile and install FFmpeg
```bash
make -j$(nproc)
sudo make install
sudo ldconfig
```

#### Step 6: Update system-wide PATH variables
To make FFmpeg executable globally and accessible by PM2 or other system runners, add this configuration system-wide:
```bash
sudo mkdir -p /etc/systemd/system.conf.d
sudo sh -c 'cat > /etc/systemd/system.conf.d/ffmpeg.conf << EOL
[Manager]
DefaultEnvironment=PATH=/opt/ffmpeg/bin:$PATH
DefaultEnvironment=LD_LIBRARY_PATH=/opt/ffmpeg/lib:$LD_LIBRARY_PATH
EOL'
```

#### Step 7: Apply the configurations
Reload systemd configuration and reboot the system:
```bash
sudo systemctl daemon-reexec
sudo reboot
```

### 2. Verifying FFmpeg Setup
You can run the built-in diagnostic test script on the local machine or your EC2 instance:
```bash
node scratch/test-ffmpeg.js
```

### 3. 📦 Local Storage Cleanup (S3 Mode)
When running in S3 mode (`VIDEO_SOURCE=s3`):
* Chunks are uploaded to the local `videos/tmp/<uploadId>` directory.
* Once the final chunk is received, the server assembles them into `videos/<filename>`.
* The server then runs FFmpeg to segment the assembled video, generating HLS files inside `videos/hls/<basename>`.
* The raw video and HLS chunks are uploaded to your S3 bucket.
* **Auto-Cleanup**: After a successful or failed S3 upload, the local raw video and HLS segment directory are deleted from the EC2 instance to preserve disk space. This is why the local `videos/` folder remains empty.

---

## 🔍 Debugging S3 Issues Locally

If you are experiencing S3 connection errors, you can run the built-in diagnostic script locally (if you have the AWS CLI configured on your Mac) or on the server:
```bash
node test-s3.js
```
This script will test if your environment can connect, list objects inside the bucket, filter videos, and generate a secure presigned URL.
