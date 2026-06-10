# 🎬 Watch Party (v2.0.0)

A Netflix-style synchronized watch party web application built with **Next.js**, **Express**, **Socket.io**, and **AWS S3** integration. Users can join sync-locked rooms to chat, react, and watch videos together with real-time play, pause, and seek synchronization.

---

## 🚀 Key Features

* **Real-time Synchronized Playback**: Play, pause, and seek actions are instantly synchronized across all users in a room using Socket.io.
* **Host & Guest Controls**: The first user to join a room becomes the host. The host can toggle guest controls to allow or restrict guests from controlling video playback.
* **AWS S3 & Local Video Storage**: Easily switch between streaming videos from an AWS S3 bucket or a local `./videos` folder.
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
Ensure you have **Node.js (v18+)** installed.

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Create a `.env.local` file in the root directory:
```env
PORT=3000
VIDEO_SOURCE=local  # Or 's3'
AWS_REGION=ap-south-1
S3_BUCKET_NAME=your-s3-bucket-name
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

#### 1. Upload Videos
Create an S3 bucket (e.g., `watchpartyapp-online-1234`) and upload your video files inside a folder named `videos/` (e.g., `videos/my-video.mkv`).

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
2. Attach the **`AmazonS3ReadOnlyAccess`** policy (or a custom policy granting `s3:ListBucket` and `s3:GetObject` on your bucket).
3. Open the **EC2 Console**, select your EC2 instance.
4. Click **Actions** > **Security** > **Modify IAM Role**.
5. Select the newly created role and save.

*If you prefer not to use IAM Roles, you must add `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` to `.env.local` on the EC2 server.*

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

## 🔍 Debugging S3 Issues Locally

If you are experiencing S3 connection errors, you can run the built-in diagnostic script locally (if you have the AWS CLI configured on your Mac) or on the server:
```bash
node test-s3.js
```
This script will test if your environment can connect, list objects inside the bucket, filter videos, and generate a secure presigned URL.
