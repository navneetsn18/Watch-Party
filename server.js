// Watch Party — fully offline edition.
// SQLite for data, local disk for videos, local ffmpeg for HLS. No cloud.
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const next = require('next');
const fs = require('fs');
const crypto = require('crypto');
const { execSync, spawn, spawnSync } = require('child_process');
const jwt = require('jsonwebtoken');

const store = require('./lib/db');

// Timestamped, tagged logging — plain console.log gave no visibility into
// what was actually happening on a running server (uploads, chat, room
// activity all invisible). Every log line gets a HH:MM:SS prefix + a tag
// so `grep '\[CHAT\]'` etc. works on the raw terminal output.
function ts() { return new Date().toTimeString().slice(0, 8); }
function log(tag, msg) { console.log(`[${ts()}] [${tag}] ${msg}`); }
function logErr(tag, msg) { console.error(`[${ts()}] [${tag}] ${msg}`); }

// JWT here is just a session cookie substitute for a trusted local network —
// there are no passwords to protect.
const JWT_SECRET = process.env.JWT_SECRET || 'watch-party-local-secret';
const PORT = process.env.PORT || 3000;
const dev = process.env.NODE_ENV !== 'production';

const VIDEOS_DIR = path.join(__dirname, 'videos');
const HLS_DIR = path.join(VIDEOS_DIR, 'hls');
const SUBS_DIR = path.join(VIDEOS_DIR, 'subs');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(HLS_DIR, { recursive: true });
fs.mkdirSync(SUBS_DIR, { recursive: true });
fs.mkdirSync(path.join(UPLOADS_DIR, 'avatars'), { recursive: true });
fs.mkdirSync(path.join(UPLOADS_DIR, 'thumbnails'), { recursive: true });

// Detect FFmpeg — needed for HLS transcoding. Without it videos still play
// via range streaming, just without segmented seeking.
let FFMPEG_PATH = null;
try {
  const findCmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
  FFMPEG_PATH = execSync(findCmd, { encoding: 'utf-8' }).split(/\r?\n/)[0].trim();
  log('BOOT', `FFmpeg found at: ${FFMPEG_PATH}`);
} catch {
  log('BOOT', 'FFmpeg not found. Videos will stream raw (no HLS).');
}

// Detect ffprobe — same install as ffmpeg gives it for free. Only used to
// read a video's duration up front so transcode logs can show an ETA.
let FFPROBE_PATH = null;
try {
  const findCmd = process.platform === 'win32' ? 'where ffprobe' : 'which ffprobe';
  FFPROBE_PATH = execSync(findCmd, { encoding: 'utf-8' }).split(/\r?\n/)[0].trim();
} catch {
  // fine without it — transcode logs just skip the ETA/segment-total math
}

const requireAuth = (req, res, nextFn) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized: Missing token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET); // { id, username }
    nextFn();
  } catch {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
};

function getFlagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return '';
  return String.fromCodePoint(...countryCode.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0)));
}

function clientUser(user) {
  return {
    id: user.id,
    username: user.username,
    country: user.country || '',
    avatarUrl: user.avatarUrl || '',
    avatar_url: user.avatarUrl || '',
    createdAt: user.createdAt,
  };
}

// ─── Next.js Setup ───────────────────────────────────────────────────────────
const nextApp = next({ dev });
const nextHandler = nextApp.getRequestHandler();

const app = express();
const server = http.createServer(app);
// Node 18+ defaults to a 5-minute requestTimeout, which kills the socket
// mid-transfer on any upload of a large file over a slow disk/connection —
// looks like a random "network error" to the client with no server-side log.
// Uploads here are single long-lived POSTs, so disable it.
server.requestTimeout = 0;
server.headersTimeout = 0;

// ─── Auth: name-only login ───────────────────────────────────────────────────
// No passwords. Enter a name; if it exists you're that person, otherwise the
// account is created. This app runs on a couch, not on the internet.
app.post('/api/auth/login', express.json(), (req, res) => {
  const cleanUsername = req.body.username?.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!cleanUsername) {
    return res.status(400).json({ error: 'Name is required' });
  }

  try {
    let user = store.getUserByUsername(cleanUsername);
    if (!user) {
      user = {
        id: crypto.randomUUID(),
        username: cleanUsername,
        avatarUrl: '',
        country: req.body.country || 'IN',
        createdAt: new Date().toISOString(),
      };
      store.createUser(user);
      log('AUTH', `New user: ${cleanUsername}`);
    } else {
      log('AUTH', `Login: ${cleanUsername}`);
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    return res.json({ token, user: clientUser(user) });
  } catch (err) {
    logErr('AUTH', `Login failed: ${err.message}`);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// ─── Profile ─────────────────────────────────────────────────────────────────
app.get('/api/profile', requireAuth, (req, res) => {
  const user = store.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json(clientUser(user));
});

app.put('/api/profile', express.json(), requireAuth, (req, res) => {
  const { username, avatar_url, country } = req.body;
  const cleanUsername = username?.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!cleanUsername) return res.status(400).json({ error: 'Username is required' });

  try {
    const existing = store.getUserByUsername(cleanUsername);
    if (existing && existing.id !== req.user.id) {
      return res.status(400).json({ error: 'Username is already taken' });
    }
    const current = store.getUserById(req.user.id);
    if (!current) return res.status(404).json({ error: 'User not found' });

    const updated = {
      id: current.id,
      username: cleanUsername,
      avatarUrl: avatar_url !== undefined ? avatar_url : current.avatarUrl,
      country: country !== undefined ? country : current.country,
    };
    store.updateUser(updated);
    log('PROFILE', `Updated: ${updated.username}`);
    return res.json(clientUser({ ...current, ...updated }));
  } catch (err) {
    logErr('PROFILE', `Update failed: ${err.message}`);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Avatar upload — base64 JSON in, file in public/uploads/avatars out.
// Next serves public/ statically, so the returned URL just works.
app.post('/api/profile/upload-avatar', express.json({ limit: '6mb' }), requireAuth, (req, res) => {
  const { data, filename } = req.body;
  if (!data || !filename) return res.status(400).json({ error: 'Missing data or filename' });
  try {
    const buffer = Buffer.from(data.replace(/^data:[^;]+;base64,/, ''), 'base64');
    const ext = path.extname(filename) || '.jpg';
    const uniqueFilename = `${req.user.id}-${Date.now()}${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, 'avatars', uniqueFilename), buffer);
    log('PROFILE', `Avatar uploaded: ${req.user.username} -> ${uniqueFilename}`);
    res.json({ url: `/uploads/avatars/${uniqueFilename}` });
  } catch (err) {
    logErr('PROFILE', `Avatar upload failed: ${err.message}`);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

// ─── Videos ──────────────────────────────────────────────────────────────────
app.get('/api/videos', requireAuth, (req, res) => {
  try {
    const videos = store.listVideos()
      .filter(v => !v.isPrivate || v.uploaderId === req.user.id)
      .map(v => {
        const uploader = store.getUserById(v.uploaderId);
        return {
          id: v.id,
          key: `videos/${v.filename}`,
          name: v.displayName || v.filename,
          size: 0,
          uploaderId: v.uploaderId,
          uploaderName: uploader?.username || v.uploaderName || 'Unknown',
          country: uploader?.country || '',
          avatarUrl: uploader?.avatarUrl || '',
          isPrivate: !!v.isPrivate,
          isVerified: false,
          thumbnailUrl: v.thumbnailUrl || '',
          createdAt: v.createdAt,
        };
      });
    res.json(videos);
  } catch (err) {
    logErr('API', `Error listing videos: ${err.message}`);
    res.status(500).json({ error: 'Failed to list videos' });
  }
});

// Resolve a playable URL for a video key: HLS if transcoded, range stream otherwise
app.get('/api/video-url', (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(400).json({ error: 'Missing key' });

  const baseFilename = key.replace(/^videos\//, '');
  const video = store.getVideo(baseFilename);
  if (!video) return res.status(404).json({ error: 'Video not found' });

  // Private videos: playable inside a room session (host shared it) or by uploader
  if (video.isPrivate) {
    const roomId = req.query.roomId;
    const inRoom = roomId && rooms[roomId]?.state?.videoKey === key;
    let isUploader = false;
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      try { isUploader = jwt.verify(token, JWT_SECRET).id === video.uploaderId; } catch {}
    }
    if (!inRoom && !isUploader) {
      return res.status(403).json({ error: 'Forbidden: No permission to stream this video.' });
    }
  }

  const subtitles = store.getSubtitlesForVideo(video.id).map(s => ({
    id: s.id,
    label: s.label,
    language: s.language,
    url: `/api/subs/${encodeURIComponent(s.filename)}`,
  }));

  const baseName = path.parse(baseFilename).name;
  const hlsManifest = path.join(HLS_DIR, baseName, 'index.m3u8');
  if (fs.existsSync(hlsManifest)) {
    return res.json({ url: `/api/hls/${encodeURIComponent(baseName)}/index.m3u8`, source: 'hls', subtitles });
  }
  res.json({ url: `/api/stream/${encodeURIComponent(baseFilename)}`, source: 'local', subtitles });
});

// Serve a subtitle file (WebVTT) by its stored filename
app.get('/api/subs/:filename', (req, res) => {
  const safeName = path.basename(req.params.filename);
  const filePath = path.join(SUBS_DIR, safeName);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  fs.createReadStream(filePath).pipe(res);
});

// Range streaming (HTTP 206) for raw files
app.get('/api/stream/:filename', (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  const filePath = path.join(VIDEOS_DIR, path.basename(filename));

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  const fileSize = fs.statSync(filePath).size;
  const ext = path.extname(filename).toLowerCase();
  const contentTypes = {
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg',
    '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  };
  const contentType = contentTypes[ext] || 'video/mp4';

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    let start = parseInt(parts[0], 10);
    let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (isNaN(start)) { start = fileSize - end; end = fileSize - 1; }
    if (isNaN(end)) end = fileSize - 1;
    if (start >= fileSize || end >= fileSize || start < 0 || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
      return res.end();
    }
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    });
    const file = fs.createReadStream(filePath, { start, end });
    file.on('error', () => { if (!res.headersSent) res.status(500).end(); res.end(); });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    });
    const file = fs.createReadStream(filePath);
    file.on('error', () => { if (!res.headersSent) res.status(500).end(); res.end(); });
    file.pipe(res);
  }
});

// HLS manifest + segment serving. The name charset must match the upload
// sanitizer exactly — it once stripped parentheses that uploads allow, which
// 404'd every "Movie (2024)" style title. Containment check handles traversal.
app.get('/api/hls/:videoname/:file', (req, res) => {
  const safeName = path.basename(req.params.videoname).replace(/[^a-zA-Z0-9_\-.() ]/g, '');
  const safeFile = path.basename(req.params.file).replace(/[^a-zA-Z0-9_\-.]/g, '');
  const filePath = path.join(HLS_DIR, safeName, safeFile);
  if (!filePath.startsWith(HLS_DIR + path.sep)) return res.status(400).json({ error: 'Bad path' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'HLS file not found' });

  const ext = path.extname(safeFile).toLowerCase();
  res.sendFile(filePath, {
    headers: { 'Cache-Control': ext === '.m3u8' ? 'no-cache' : 'public, max-age=31536000' },
  });
});

// ─── Upload (local, streaming to disk) ──────────────────────────────────────
const uploads = {}; // uploadId -> { filename, status, tsCreated, errorMessage }

// Sweep finished/stale sessions daily
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, u] of Object.entries(uploads)) {
    if ((u.createdAt || 0) < cutoff) delete uploads[id];
  }
}, 60 * 60 * 1000);

// Thumbnail upload (base64 JSON) — returns a static URL to attach to the video
app.post('/api/upload/thumbnail', express.json({ limit: '10mb' }), requireAuth, (req, res) => {
  const { data, filename, contentType } = req.body;
  if (!data || !filename) return res.status(400).json({ error: 'Missing data or filename' });
  try {
    const buffer = Buffer.from(data.replace(/^data:[^;]+;base64,/, ''), 'base64');
    const ext = path.extname(filename) || '.jpg';
    const uniqueName = `${req.user.id}-${Date.now()}${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, 'thumbnails', uniqueName), buffer);
    res.json({ url: `/uploads/thumbnails/${uniqueName}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save thumbnail' });
  }
});

// The video upload itself: raw bytes streamed straight to disk — constant
// memory regardless of file size. Metadata rides in query params.
app.post('/api/upload/local', requireAuth, (req, res) => {
  const rawName = (req.query.filename || '').toString();
  if (!/\.(mp4|webm|ogg|mov|mkv|avi)$/i.test(rawName)) {
    return res.status(400).json({ error: 'Invalid file type. Supported: mp4, webm, ogg, mov, mkv, avi' });
  }

  const ext = path.extname(rawName).toLowerCase();
  const rawDisplayName = (req.query.displayName || path.parse(rawName).name).toString();
  const baseNameInput = rawDisplayName.replace(/[^a-zA-Z0-9_\-.() ]/g, '_');

  // Collision check against DB, disk, and in-flight uploads
  const inFlight = new Set(Object.values(uploads).filter(u => u.status !== 'error').map(u => u.filename));
  let finalFilename = `${baseNameInput}${ext}`;
  let counter = 1;
  while (store.getVideo(finalFilename) || fs.existsSync(path.join(VIDEOS_DIR, finalFilename)) || inFlight.has(finalFilename)) {
    finalFilename = `${baseNameInput}-${counter}${ext}`;
    counter++;
  }

  const uploadId = crypto.randomUUID();
  uploads[uploadId] = { filename: finalFilename, status: 'uploading', tsCreated: 0, createdAt: Date.now() };

  const totalBytes = parseInt(req.headers['content-length'] || '0', 10);
  log('UPLOAD', `Start: ${finalFilename} by ${req.user.username} (${totalBytes > 0 ? (totalBytes / 1e6).toFixed(1) + 'MB' : 'unknown size'})`);

  const finalPath = path.join(VIDEOS_DIR, finalFilename);
  const writeStream = fs.createWriteStream(finalPath);
  req.pipe(writeStream);

  // Log progress every 10% (or every 30s for unknown-length requests) —
  // this was invisible before, so a stuck/slow upload gave zero signal.
  let receivedBytes = 0;
  let lastLoggedPct = -1;
  let lastLoggedAt = Date.now();
  req.on('data', (chunk) => {
    receivedBytes += chunk.length;
    const now = Date.now();
    if (totalBytes > 0) {
      const pct = Math.floor((receivedBytes / totalBytes) * 100);
      if (pct >= lastLoggedPct + 10) {
        lastLoggedPct = pct;
        log('UPLOAD', `${finalFilename} — ${pct}% (${(receivedBytes / 1e6).toFixed(1)}MB / ${(totalBytes / 1e6).toFixed(1)}MB)`);
      }
    } else if (now - lastLoggedAt > 30000) {
      lastLoggedAt = now;
      log('UPLOAD', `${finalFilename} — ${(receivedBytes / 1e6).toFixed(1)}MB received so far`);
    }
  });

  req.on('aborted', () => {
    log('UPLOAD', `Aborted: ${finalFilename} at ${(receivedBytes / 1e6).toFixed(1)}MB`);
    writeStream.destroy();
    fs.unlink(finalPath, () => {});
    uploads[uploadId].status = 'error';
    uploads[uploadId].errorMessage = 'Upload aborted';
  });

  // An unhandled 'error' on a piped stream crashes the process (Node throws
  // if no listener is attached) — a dropped connection mid-upload must not
  // take the whole server down with it.
  req.on('error', (err) => {
    logErr('UPLOAD', `Request stream error on ${finalFilename}: ${err.message}`);
    writeStream.destroy();
    fs.unlink(finalPath, () => {});
    if (uploads[uploadId]) {
      uploads[uploadId].status = 'error';
      uploads[uploadId].errorMessage = err.message;
    }
  });

  writeStream.on('error', (err) => {
    logErr('UPLOAD', `Write error on ${finalFilename}: ${err.message}`);
    uploads[uploadId].status = 'error';
    uploads[uploadId].errorMessage = err.message;
    res.status(500).json({ error: 'Failed to write file' });
  });

  writeStream.on('finish', () => {
    if (uploads[uploadId].status === 'error') return;
    log('UPLOAD', `Saved: ${finalFilename} (${(fs.statSync(finalPath).size / 1e6).toFixed(1)}MB)`);

    // Register immediately — video is playable raw right away
    const displayNameFinal = rawDisplayName.toLowerCase().endsWith(ext) ? rawDisplayName : `${rawDisplayName}${ext}`;
    const videoId = crypto.randomUUID();
    store.insertVideo({
      filename: finalFilename,
      id: videoId,
      displayName: displayNameFinal,
      uploaderId: req.user.id,
      uploaderName: req.user.username,
      isPrivate: req.query.isPrivate === 'true' ? 1 : 0,
      thumbnailUrl: (req.query.thumbnailUrl || '').toString(),
      createdAt: new Date().toISOString(),
    });
    log('UPLOAD', `Registered: ${displayNameFinal} (id ${videoId}, owner ${req.user.username})`);

    if (FFMPEG_PATH) {
      uploads[uploadId].status = 'transcoding';
      transcodeToHls(uploadId, finalPath, finalFilename);
      res.json({ status: 'transcoding', uploadId, filename: finalFilename, id: videoId });
    } else {
      uploads[uploadId].status = 'complete';
      io.emit('transcode-complete', { uploadId, filename: finalFilename });
      res.json({ status: 'complete', uploadId, filename: finalFilename, id: videoId });
    }
  });
});

// Local HLS transcoding. MP4 inputs get codec-copy (near-instant); everything
// else re-encodes to H.264/AAC — which also fixes browser-hostile audio like
// the DTS tracks common in MKVs.
function formatHMS(totalSeconds) {
  const sec = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Video duration via ffprobe, used only to estimate the segment count and
// ETA in transcode logs — playback doesn't depend on this being accurate.
function probeDurationSeconds(filePath) {
  if (!FFPROBE_PATH) return null;
  try {
    const result = spawnSync(FFPROBE_PATH, [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath,
    ], { encoding: 'utf-8' });
    const secs = parseFloat((result.stdout || '').trim());
    return Number.isFinite(secs) && secs > 0 ? secs : null;
  } catch {
    return null;
  }
}

// MP4 stores H.264 as length-prefixed NAL units (AVCC); MPEG-TS (what HLS
// segments are) needs Annex-B start codes. ffmpeg doesn't always insert the
// conversion automatically on a plain `-codec copy` mux, and the segments it
// produces without it intermittently fail hls.js's SourceBuffer.appendBuffer
// (surfaces client-side as a fatal "bufferAppendError" that kills playback
// with no server-side signal at all). Only safe for actual H.264 content —
// applying it to anything else makes ffmpeg fail outright, so probe first.
function probeVideoCodec(filePath) {
  if (!FFPROBE_PATH) return null;
  try {
    const result = spawnSync(FFPROBE_PATH, [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', filePath,
    ], { encoding: 'utf-8' });
    return (result.stdout || '').trim() || null;
  } catch {
    return null;
  }
}

function transcodeToHls(uploadId, inputPath, filename) {
  const baseName = path.parse(filename).name;
  const hlsDir = path.join(HLS_DIR, baseName);
  fs.mkdirSync(hlsDir, { recursive: true });
  const hlsOutput = path.join(hlsDir, 'index.m3u8');
  const ext = path.extname(filename).toLowerCase();
  const SEGMENT_SECONDS = 4;

  const commonArgs = [
    '-start_number', '0',
    '-hls_time', String(SEGMENT_SECONDS),
    '-hls_list_size', '0',
    '-hls_segment_filename', path.join(hlsDir, 'segment%03d.ts'),
    '-f', 'hls',
    hlsOutput,
  ];
  // Codec-copy only for MP4s that are actually H.264 — anything else
  // (HEVC/AV1/VP9-in-MP4, or unknown when ffprobe is unavailable) gets the
  // safe re-encode path instead of a copy mux that's likely to misbehave.
  const videoCodec = ext === '.mp4' ? probeVideoCodec(inputPath) : null;
  const canCodecCopy = ext === '.mp4' && videoCodec === 'h264';
  const ffmpegArgs = canCodecCopy
    ? ['-i', inputPath, '-codec', 'copy', '-bsf:v', 'h264_mp4toannexb', ...commonArgs]
    : ['-i', inputPath, '-c:v', 'libx264', '-c:a', 'aac', '-preset', 'veryfast', '-crf', '22', ...commonArgs];

  const durationSeconds = probeDurationSeconds(inputPath);
  const expectedSegments = durationSeconds ? Math.ceil(durationSeconds / SEGMENT_SECONDS) : null;

  log('HLS', `Transcoding start: ${filename} (${canCodecCopy ? 'codec-copy' : 'h264/aac re-encode'}${videoCodec ? `, source codec ${videoCodec}` : ''})`
    + (durationSeconds ? ` — duration ${formatHMS(durationSeconds)}, ~${expectedSegments} segments expected` : ''));

  const startedAt = Date.now();
  const ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs);
  let stderrTail = '';
  let lastLoggedCount = -1;
  const logStep = expectedSegments ? Math.max(1, Math.round(expectedSegments / 10)) : 25;

  const progressInterval = setInterval(() => {
    try {
      const tsCreated = fs.readdirSync(hlsDir).filter(f => f.endsWith('.ts')).length;
      uploads[uploadId].tsCreated = tsCreated;
      io.emit('transcode-progress', { uploadId, filename, status: 'transcoding', tsCreated });
      if (tsCreated > 0 && tsCreated !== lastLoggedCount && tsCreated % logStep === 0) {
        lastLoggedCount = tsCreated;
        const elapsedSec = (Date.now() - startedAt) / 1000;
        if (expectedSegments) {
          const pct = Math.min(100, Math.round((tsCreated / expectedSegments) * 100));
          const rate = tsCreated / elapsedSec; // segments/sec
          const etaSec = rate > 0 ? (expectedSegments - tsCreated) / rate : null;
          log('HLS', `${filename} — ${tsCreated}/${expectedSegments} segments (${pct}%)`
            + (etaSec !== null ? ` — ETA ${formatHMS(etaSec)}` : ''));
        } else {
          log('HLS', `${filename} — ${tsCreated} segments (${tsCreated * SEGMENT_SECONDS}s) — elapsed ${formatHMS(elapsedSec)}`);
        }
      }
    } catch {}
  }, 1000);

  ffmpeg.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-800); });

  ffmpeg.on('error', (err) => {
    clearInterval(progressInterval);
    logErr('HLS', `FFmpeg spawn error on ${filename}: ${err.message}`);
    uploads[uploadId].status = 'error';
    uploads[uploadId].errorMessage = err.message;
    io.emit('transcode-error', { uploadId, filename });
  });

  ffmpeg.on('close', (code) => {
    clearInterval(progressInterval);
    const totalElapsed = formatHMS((Date.now() - startedAt) / 1000);
    if (code === 0) {
      uploads[uploadId].status = 'complete';
      // Fast transcodes (small file, codec-copy) can finish before the first
      // 1s progress tick ever runs — re-count from disk instead of trusting
      // the possibly-still-zero cached value.
      let finalCount = uploads[uploadId].tsCreated || 0;
      try { finalCount = fs.readdirSync(hlsDir).filter(f => f.endsWith('.ts')).length; } catch {}
      log('HLS', `Complete: ${filename} — ${finalCount} segments in ${totalElapsed}`);
      io.emit('transcode-complete', { uploadId, filename });
    } else {
      uploads[uploadId].status = 'error';
      uploads[uploadId].errorMessage = `FFmpeg exited with code ${code}`;
      logErr('HLS', `Failed (code ${code}) after ${totalElapsed}: ${filename}\n${stderrTail}`);
      io.emit('transcode-error', { uploadId, filename });
      // Video stays raw-playable; just remove the partial HLS dir
      try { fs.rmSync(hlsDir, { recursive: true, force: true }); } catch {}
    }
  });
}

// Upload/transcode status (polled by the upload manager)
app.get('/api/upload/status/:uploadId', (req, res) => {
  const upload = uploads[req.params.uploadId];
  if (!upload) return res.status(404).json({ error: 'Not found' });
  res.json({
    status: upload.status,
    filename: upload.filename,
    errorMessage: upload.errorMessage || '',
    tsCreated: upload.tsCreated || 0,
  });
});

// Regenerate a video's HLS files from the raw file already on disk — for
// videos whose HLS was built by an older, buggier version of
// transcodeToHls (e.g. the bufferAppendError codec-copy bug). Doesn't
// touch the raw file, so no re-upload needed for a fix like that one.
app.post('/api/videos/:videoId/retranscode', requireAuth, (req, res) => {
  if (!FFMPEG_PATH) return res.status(400).json({ error: 'FFmpeg is not installed on this server' });

  const video = store.getVideoById(req.params.videoId);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  if (video.uploaderId !== req.user.id) return res.status(403).json({ error: 'Forbidden: You do not own this video' });

  const finalPath = path.join(VIDEOS_DIR, video.filename);
  if (!fs.existsSync(finalPath)) return res.status(404).json({ error: 'Raw video file is missing on disk' });

  const hlsDir = path.join(HLS_DIR, path.parse(video.filename).name);
  try { fs.rmSync(hlsDir, { recursive: true, force: true }); } catch {}

  const uploadId = crypto.randomUUID();
  uploads[uploadId] = { filename: video.filename, status: 'transcoding', tsCreated: 0, createdAt: Date.now() };
  log('HLS', `Re-transcode requested: ${video.filename} by ${req.user.username}`);
  transcodeToHls(uploadId, finalPath, video.filename);
  res.json({ status: 'transcoding', uploadId });
});

// Delete a video (owner only): file, HLS dir, thumbnail, DB row
app.delete('/api/videos/:filename', requireAuth, (req, res) => {
  const safeName = path.basename(decodeURIComponent(req.params.filename));
  try {
    const video = store.getVideo(safeName);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    if (video.uploaderId !== req.user.id) return res.status(403).json({ error: 'Forbidden: You do not own this video' });

    const filePath = path.join(VIDEOS_DIR, safeName);
    const hlsDir = path.join(HLS_DIR, path.parse(safeName).name);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    if (fs.existsSync(hlsDir)) fs.rmSync(hlsDir, { recursive: true, force: true });

    if (video.thumbnailUrl?.startsWith('/uploads/thumbnails/')) {
      const thumbPath = path.join(UPLOADS_DIR, 'thumbnails', path.basename(video.thumbnailUrl));
      try { if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath); } catch {}
    }

    for (const sub of store.getSubtitlesForVideo(video.id)) {
      const subPath = path.join(SUBS_DIR, sub.filename);
      if (fs.existsSync(subPath)) fs.unlinkSync(subPath);
      store.deleteSubtitle(sub.id);
    }
    store.deleteVideo(safeName);
    log('VIDEO', `Deleted: ${safeName} by ${req.user.username}`);
    res.json({ deleted: true });
  } catch (err) {
    logErr('VIDEO', `Delete failed for ${safeName}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Toggle video privacy (owner only)
app.put('/api/videos/:videoId/privacy', express.json(), requireAuth, (req, res) => {
  try {
    const video = store.getVideoById(req.params.videoId);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    if (video.uploaderId !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });
    store.setVideoPrivacy(req.params.videoId, !!req.body.isPrivate);
    log('VIDEO', `${video.filename} set ${req.body.isPrivate ? 'private' : 'public'} by ${req.user.username}`);
    res.json({ success: true, isPrivate: !!req.body.isPrivate });
  } catch (err) {
    logErr('VIDEO', `Privacy toggle failed: ${err.message}`);
    res.status(500).json({ error: 'Failed to update video privacy' });
  }
});

// List subtitles for a video
app.get('/api/videos/:videoId/subtitles', (req, res) => {
  const video = store.getVideoById(req.params.videoId);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  const subs = store.getSubtitlesForVideo(video.id).map(s => ({
    id: s.id, label: s.label, language: s.language, url: `/api/subs/${encodeURIComponent(s.filename)}`,
  }));
  res.json(subs);
});

// Add a subtitle track (owner only). Body: { label, language, filename, content }
// content is the raw .vtt or .srt text — SRT gets converted to WebVTT on save.
app.post('/api/videos/:videoId/subtitles', express.json({ limit: '10mb' }), requireAuth, (req, res) => {
  try {
    const video = store.getVideoById(req.params.videoId);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    if (video.uploaderId !== req.user.id) return res.status(403).json({ error: 'Forbidden: You do not own this video' });

    const { label, language, filename, content } = req.body;
    if (!content || typeof content !== 'string') return res.status(400).json({ error: 'Missing subtitle content' });

    let vtt = content.trim();
    const isSrt = /\.srt$/i.test(filename || '') || !vtt.startsWith('WEBVTT');
    if (isSrt) {
      vtt = 'WEBVTT\n\n' + vtt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    }

    const id = crypto.randomUUID();
    const storedFilename = `${id}.vtt`;
    fs.writeFileSync(path.join(SUBS_DIR, storedFilename), vtt, 'utf-8');

    const sub = {
      id,
      videoId: video.id,
      language: (language || 'en').slice(0, 10),
      label: (label || filename || 'Subtitle').slice(0, 100),
      filename: storedFilename,
      createdAt: new Date().toISOString(),
    };
    store.insertSubtitle(sub);
    log('SUBTITLE', `Added "${sub.label}" (${sub.language}) to ${video.filename} by ${req.user.username}`);
    res.json({ id: sub.id, label: sub.label, language: sub.language, url: `/api/subs/${storedFilename}` });
  } catch (err) {
    logErr('SUBTITLE', `Add failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Delete a subtitle track (owner only)
app.delete('/api/videos/:videoId/subtitles/:subId', requireAuth, (req, res) => {
  try {
    const video = store.getVideoById(req.params.videoId);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    if (video.uploaderId !== req.user.id) return res.status(403).json({ error: 'Forbidden: You do not own this video' });

    const sub = store.getSubtitleById(req.params.subId);
    if (!sub || sub.videoId !== video.id) return res.status(404).json({ error: 'Subtitle not found' });

    const subPath = path.join(SUBS_DIR, sub.filename);
    if (fs.existsSync(subPath)) fs.unlinkSync(subPath);
    store.deleteSubtitle(sub.id);
    log('SUBTITLE', `Removed "${sub.label}" from ${video.filename}`);
    res.json({ deleted: true });
  } catch (err) {
    logErr('SUBTITLE', `Delete failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── Watch Party Rooms ──────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e6,
});

const rooms = {};

app.get('/api/check-room/:code', (req, res) => {
  const code = req.params.code?.trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Missing code' });
  if (!/^[A-Z0-9]{3,12}$/.test(code)) {
    return res.json({ available: false, reason: 'Invalid format. Use 3-12 alphanumeric characters.' });
  }
  const room = rooms[code];
  res.json({ available: !(room && room.users.size > 0), code });
});

function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      host: null,
      users: new Map(),
      state: { videoKey: null, playing: false, currentTime: 0, lastUpdated: Date.now(), hostBuffering: false, ended: false },
      guestControls: true,
      queue: [],
    };
  }
  return rooms[roomId];
}

function getUserList(room) {
  const list = [];
  for (const [id, info] of room.users) {
    list.push({
      id,
      username: info.username,
      userId: info.userId,
      avatarUrl: info.avatarUrl,
      country: info.country,
      isHost: id === room.host,
      isVerified: false,
    });
  }
  return list;
}

// ─── YouTube Queue Helpers ───────────────────────────────────────────────────
function parseYouTubeVideoId(input) {
  const s = (input || '').trim();
  const m = s.match(/(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  return null;
}

function parseYouTubePlaylistId(input) {
  const m = (input || '').match(/[?&]list=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

function decodeXmlEntities(str) {
  return (str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// oEmbed is the official, key-free way to resolve a single video's title and
// thumbnail; it also 404s for private/nonexistent videos, giving free validation.
async function fetchOEmbedMeta(videoId) {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Video not found, private, or unavailable');
  const data = await res.json();
  return { title: data.title || 'YouTube video', thumbnail: data.thumbnail_url || '' };
}

// Playlist expansion uses YouTube's public syndication feed — no API key
// required, but it only exposes the 15 most recently added items per playlist.
async function fetchPlaylistVideos(playlistId) {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`);
  if (!res.ok) throw new Error('Playlist not found or is private');
  const xml = await res.text();
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => m[1]);
  return entries
    .map(e => {
      const videoId = e.match(/<yt:videoId>(.*?)<\/yt:videoId>/)?.[1];
      const title = e.match(/<title>([\s\S]*?)<\/title>/)?.[1];
      const thumbnail = e.match(/<media:thumbnail url="([^"]+)"/)?.[1];
      return videoId ? { videoId, title: decodeXmlEntities(title || 'YouTube video'), thumbnail: thumbnail || '' } : null;
    })
    .filter(Boolean);
}

// A room is idle (safe to auto-advance into) either because nothing has ever
// played, or because the last video finished and the queue was empty at that
// moment — the `ended` flag distinguishes that from an intentional mid-video
// pause, which also sets playing:false but must NOT be auto-advanced away from.
function isRoomIdle(room) {
  return !room.state.videoKey || room.state.ended;
}

function playQueueItem(room, roomId, item) {
  room.state = {
    videoKey: `youtube:${item.videoId}`,
    playing: true,
    currentTime: 0,
    lastUpdated: Date.now(),
    hostBuffering: false,
    ended: false,
  };
  io.to(roomId).emit('video-selected', { videoKey: room.state.videoKey, autoplay: true });
  io.to(roomId).emit('queue-updated', room.queue);
}

// Pull the oldest approved item off the queue and make it the room's active
// video with autoplay. Used when a video ends, the host skips, or a fresh
// approval/add unblocks a room that had nothing playing.
function advanceQueue(room, roomId) {
  const idx = room.queue.findIndex(q => q.status === 'approved');
  if (idx === -1) return false;
  const [next] = room.queue.splice(idx, 1);
  playQueueItem(room, roomId, next);
  return true;
}

io.on('connection', (socket) => {
  log('WS', `Connected: ${socket.id}`);
  let currentRoom = null;
  let currentUsername = null;

  socket.on('join-room', ({ roomId, username, userId, avatarUrl, country }) => {
    if (currentRoom && currentRoom !== roomId) {
      socket.leave(currentRoom);
      const oldRoom = rooms[currentRoom];
      if (oldRoom) {
        oldRoom.users.delete(socket.id);
        if (oldRoom.users.size === 0) delete rooms[currentRoom];
      }
    }

    currentRoom = roomId;
    const userFlag = country ? ` ${getFlagEmoji(country)}` : '';
    const formattedUsername = username ? (userFlag && username.includes(userFlag.trim()) ? username : `${username}${userFlag}`) : 'Viewer';
    currentUsername = formattedUsername;
    socket.join(roomId);
    const room = getOrCreateRoom(roomId);

    room.users.set(socket.id, {
      username: currentUsername,
      userId,
      avatarUrl,
      country,
      joinedAt: Date.now(),
    });

    if (!room.host || !room.users.has(room.host)) {
      room.host = socket.id;
      room.state.hostBuffering = false;
      socket.emit('role', { role: 'host' });
      log('ROOM', `${currentUsername} is host of room ${roomId}`);
    } else if (room.host === socket.id) {
      room.state.hostBuffering = false;
      socket.emit('role', { role: 'host' });
    } else {
      socket.emit('role', { role: 'guest' });
      socket.emit('sync-state', room.state);
      socket.emit('guest-controls-changed', { enabled: room.guestControls });
      log('ROOM', `${currentUsername} joined room ${roomId} (${room.users.size} now watching)`);
    }

    const userList = getUserList(room);
    io.to(roomId).emit('user-list', userList);
    io.to(roomId).emit('user-count', room.users.size);
    socket.emit('join-success', { roomId, userCount: room.users.size });
    socket.emit('queue-updated', room.queue);

    socket.to(roomId).emit('chat-message', {
      sender: '🤖 System',
      message: `${currentUsername} joined the room`,
      isSystem: true,
    });
  });

  socket.on('select-video', ({ roomId, videoKey }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;
    room.state = { videoKey, playing: false, currentTime: 0, lastUpdated: Date.now(), hostBuffering: false, ended: false };
    io.to(roomId).emit('video-selected', { videoKey });
    log('ROOM', `${currentUsername} selected "${videoKey}" in room ${roomId}`);
  });

  // ── YouTube queue ─────────────────────────────────────────────────────────
  // Anyone can add; whether it lands approved or pending depends on
  // room.guestControls — the same switch that already gates guest playback
  // control, reused here so there's one "trust the guests" toggle, not two.
  socket.on('queue-add', async ({ roomId, url }) => {
    const room = rooms[roomId];
    if (!room) return;
    const userInfo = room.users.get(socket.id);
    const addedByName = userInfo?.username || 'Guest';
    const addedByUserId = userInfo?.userId || null;
    const isHostUser = room.host === socket.id;
    const autoApprove = isHostUser || room.guestControls;

    const playlistId = parseYouTubePlaylistId(url);
    try {
      let items;
      if (playlistId) {
        const vids = await fetchPlaylistVideos(playlistId);
        if (vids.length === 0) throw new Error('Playlist is empty, private, or has no recent videos');
        items = vids;
      } else {
        const videoId = parseYouTubeVideoId(url);
        if (!videoId) {
          socket.emit('queue-error', { message: 'Could not find a YouTube video in that link' });
          return;
        }
        const meta = await fetchOEmbedMeta(videoId);
        items = [{ videoId, ...meta }];
      }

      const now = Date.now();
      const entries = items.map((it, i) => ({
        id: crypto.randomUUID(),
        videoId: it.videoId,
        title: it.title,
        thumbnail: it.thumbnail,
        addedByName,
        addedByUserId,
        addedBySocketId: socket.id,
        status: autoApprove ? 'approved' : 'pending',
        addedAt: now + i, // preserves playlist order within the queue array
      }));
      room.queue.push(...entries);
      io.to(roomId).emit('queue-updated', room.queue);
      log('QUEUE', `${addedByName} added ${entries.length} item(s) to room ${roomId} (${autoApprove ? 'approved' : 'pending'})`);

      if (playlistId) {
        socket.emit('queue-info', {
          message: `Added ${entries.length} video${entries.length !== 1 ? 's' : ''} from the playlist`
            + (entries.length >= 15 ? " (YouTube's public feed shows up to 15 recent videos)" : '')
            + (!autoApprove ? ' — waiting for host approval' : '')
        });
      } else if (!autoApprove) {
        socket.emit('queue-info', { message: 'Added to queue — waiting for host approval' });
      }

      if (isRoomIdle(room)) advanceQueue(room, roomId);
    } catch (err) {
      logErr('QUEUE', `Add failed in room ${roomId}: ${err.message}`);
      socket.emit('queue-error', { message: err.message || 'Failed to add video' });
    }
  });

  socket.on('queue-approve', ({ roomId, itemId }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;
    const item = room.queue.find(q => q.id === itemId);
    if (!item) return;
    item.status = 'approved';
    io.to(roomId).emit('queue-updated', room.queue);
    log('QUEUE', `${currentUsername} approved "${item.title}" in room ${roomId}`);
    if (isRoomIdle(room)) advanceQueue(room, roomId);
  });

  // Host clicks a specific approved queue item to play it right now,
  // out of FIFO order. Pending items aren't eligible — approve first,
  // keeping the approval gate meaningful rather than a rubber stamp.
  socket.on('queue-play-now', ({ roomId, itemId }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;
    const idx = room.queue.findIndex(q => q.id === itemId && q.status === 'approved');
    if (idx === -1) return;
    const [item] = room.queue.splice(idx, 1);
    log('QUEUE', `${currentUsername} played "${item.title}" now in room ${roomId}`);
    playQueueItem(room, roomId, item);
  });

  socket.on('queue-reject', ({ roomId, itemId }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;
    room.queue = room.queue.filter(q => q.id !== itemId);
    io.to(roomId).emit('queue-updated', room.queue);
    log('QUEUE', `${currentUsername} rejected an item in room ${roomId}`);
  });

  socket.on('queue-remove', ({ roomId, itemId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const item = room.queue.find(q => q.id === itemId);
    if (!item) return;
    const userInfo = room.users.get(socket.id);
    const isOwner = item.addedBySocketId === socket.id
      || (item.addedByUserId && userInfo?.userId && item.addedByUserId === userInfo.userId);
    if (room.host !== socket.id && !isOwner) return;
    room.queue = room.queue.filter(q => q.id !== itemId);
    io.to(roomId).emit('queue-updated', room.queue);
    log('QUEUE', `${currentUsername} removed "${item.title}" from room ${roomId}`);
  });

  socket.on('queue-skip', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;
    log('QUEUE', `${currentUsername} skipped current video in room ${roomId}`);
    if (!advanceQueue(room, roomId)) {
      socket.emit('queue-info', { message: 'Queue is empty' });
    }
  });

  // Host's player reports natural end-of-video — advance to the next
  // approved item, or just mark playback stopped if the queue is empty.
  socket.on('video-ended', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;
    log('QUEUE', `Video ended in room ${roomId}`);
    if (!advanceQueue(room, roomId)) {
      room.state.playing = false;
      room.state.ended = true;
      room.state.lastUpdated = Date.now();
    }
  });

  socket.on('play', ({ roomId, currentTime }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.host !== socket.id && !room.guestControls) return;
    room.state.playing = true;
    room.state.currentTime = currentTime;
    room.state.lastUpdated = Date.now();
    socket.to(roomId).emit('play', { currentTime });
    log('PLAYBACK', `${currentUsername} pressed play in room ${roomId} @ ${currentTime.toFixed(1)}s`);
  });

  socket.on('pause', ({ roomId, currentTime }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.host !== socket.id && !room.guestControls) return;
    room.state.playing = false;
    room.state.currentTime = currentTime;
    room.state.lastUpdated = Date.now();
    socket.to(roomId).emit('pause', { currentTime });
    log('PLAYBACK', `${currentUsername} pressed pause in room ${roomId} @ ${currentTime.toFixed(1)}s`);
  });

  socket.on('seek', ({ roomId, currentTime, playing }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.host !== socket.id && !room.guestControls) return;
    room.state.currentTime = currentTime;
    room.state.playing = typeof playing === 'boolean' ? playing : room.state.playing;
    room.state.lastUpdated = Date.now();
    socket.to(roomId).emit('seek', { currentTime, playing });
    log('PLAYBACK', `${currentUsername} seeked to ${currentTime.toFixed(1)}s in room ${roomId}`);
  });

  socket.on('toggle-guest-controls', ({ roomId, enabled }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;
    room.guestControls = !!enabled;
    io.to(roomId).emit('guest-controls-changed', { enabled: room.guestControls });
    log('ROOM', `${currentUsername} turned guest controls ${enabled ? 'ON' : 'OFF'} in room ${roomId}`);
  });

  socket.on('host-buffering', ({ roomId, isBuffering }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;
    room.state.hostBuffering = !!isBuffering;
    socket.to(roomId).emit('host-buffering', { isBuffering });
  });

  socket.on('host-time-update', ({ roomId, currentTime, playing, timestamp }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;
    room.state.currentTime = currentTime;
    room.state.playing = !!playing;
    room.state.lastUpdated = timestamp || Date.now();
    socket.to(roomId).emit('host-time-update', { currentTime, playing, timestamp });
  });

  socket.on('request-sync', ({ roomId }) => {
    const room = rooms[roomId];
    if (room) socket.emit('sync-state', room.state);
  });

  socket.on('guest-request', ({ roomId, action }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.host === socket.id) return;
    if (room.guestControls) return;

    const userInfo = room.users.get(socket.id);
    io.to(room.host).emit('guest-request-received', {
      id: `${socket.id}-${Date.now()}`,
      guestId: socket.id,
      username: userInfo?.username || 'Guest',
      action,
    });
    log('GUEST', `${userInfo?.username || 'Guest'} requested "${action}" in room ${roomId}`);
  });

  socket.on('host-approve-request', ({ roomId, requestId, action, guestId }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;

    const video = room.state;
    switch (action) {
      case 'play':
        room.state.playing = true;
        room.state.lastUpdated = Date.now();
        io.to(roomId).emit('play', { currentTime: video.currentTime });
        break;
      case 'pause':
        room.state.playing = false;
        room.state.lastUpdated = Date.now();
        io.to(roomId).emit('pause', { currentTime: video.currentTime });
        break;
      case 'seek-forward':
        room.state.currentTime = (video.currentTime || 0) + 10;
        room.state.lastUpdated = Date.now();
        io.to(roomId).emit('seek', { currentTime: room.state.currentTime, playing: room.state.playing });
        break;
      case 'seek-backward':
        room.state.currentTime = Math.max((video.currentTime || 0) - 10, 0);
        room.state.lastUpdated = Date.now();
        io.to(roomId).emit('seek', { currentTime: room.state.currentTime, playing: room.state.playing });
        break;
    }
    io.to(guestId).emit('request-approved', { requestId, action });
    log('GUEST', `${currentUsername} approved "${action}" in room ${roomId}`);
  });

  socket.on('host-reject-request', ({ roomId, requestId, guestId }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;
    io.to(guestId).emit('request-rejected', { requestId });
    log('GUEST', `${currentUsername} rejected a request in room ${roomId}`);
  });

  socket.on('chat-message', ({ roomId, sender, message }) => {
    socket.to(roomId).emit('chat-message', { sender, message });
    log('CHAT', `[${roomId}] ${sender}: ${message}`);
  });

  socket.on('reaction', ({ roomId, emoji }) => {
    socket.to(roomId).emit('reaction', { emoji });
    log('REACTION', `[${roomId}] ${currentUsername} sent ${emoji}`);
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room) return;

    room.users.delete(socket.id);

    io.to(currentRoom).emit('chat-message', {
      sender: '🤖 System',
      message: `${currentUsername || 'Someone'} left the room`,
      isSystem: true,
    });

    if (room.host === socket.id) {
      const remaining = [...room.users.keys()];
      if (remaining.length > 0) {
        room.host = remaining[0];
        room.state.hostBuffering = false;
        const newHostInfo = room.users.get(remaining[0]);
        io.to(remaining[0]).emit('role', { role: 'host' });
        io.to(currentRoom).emit('host-changed', {
          newHost: remaining[0],
          newHostName: newHostInfo?.username || 'Unknown',
        });
        io.to(currentRoom).emit('chat-message', {
          sender: '🤖 System',
          message: `${newHostInfo?.username || 'Someone'} is now the host`,
          isSystem: true,
        });
      } else {
        log('ROOM', `Room ${currentRoom} closed (empty)`);
        delete rooms[currentRoom];
        return;
      }
    }

    if (rooms[currentRoom]) {
      io.to(currentRoom).emit('user-list', getUserList(room));
      io.to(currentRoom).emit('user-count', room.users.size);
    }

    log('ROOM', `${currentUsername || 'Someone'} left room ${currentRoom} (${socket.id})`);
  });
});

// ─── Start ──────────────────────────────────────────────────────────────────
nextApp.prepare().then(() => {
  app.all('*', (req, res) => nextHandler(req, res));

  server.listen(PORT, () => {
    console.log(`\n🎬 Watch Party (offline edition) on http://localhost:${PORT}`);
    console.log(`   Data: ./data/watchparty.db | Videos: ./videos | FFmpeg: ${FFMPEG_PATH ? 'yes' : 'no'}\n`);
  });
});
