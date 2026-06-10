require('dotenv').config({ path: '.env.local' });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const next = require('next');
const path = require('path');
const fs = require('fs');

// ─── Config ──────────────────────────────────────────────────────────────────
const dev = process.env.NODE_ENV !== 'production';
const PORT = process.env.PORT || 3000;
const VIDEO_SOURCE = process.env.VIDEO_SOURCE || 'local';

// S3 support (optional)
let s3Client, GetObjectCommand, getSignedUrl, S3_BUCKET;
if (VIDEO_SOURCE === 's3') {
  const { S3Client, GetObjectCommand: GOC, ListObjectsV2Command } = require('@aws-sdk/client-s3');
  const { getSignedUrl: gsu } = require('@aws-sdk/s3-request-presigner');
  s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
  GetObjectCommand = GOC;
  getSignedUrl = gsu;
  S3_BUCKET = process.env.S3_BUCKET_NAME;
}

// ─── Next.js Setup ───────────────────────────────────────────────────────────
const nextApp = next({ dev });
const nextHandler = nextApp.getRequestHandler();

const app = express();
const server = http.createServer(app);

// ─── Socket.IO ───────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
});

// ─── Video APIs ──────────────────────────────────────────────────────────────

// List available videos
app.get('/api/videos', async (req, res) => {
  try {
    if (VIDEO_SOURCE === 's3') {
      const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
      const command = new ListObjectsV2Command({
        Bucket: S3_BUCKET,
      });
      const result = await s3Client.send(command);
      const videos = (result.Contents || [])
        .filter(obj => /\.(mp4|webm|ogg|mov|mkv|avi)$/i.test(obj.Key))
        .map(obj => ({
          key: obj.Key,
          name: obj.Key.replace(/^videos\//, ''),
          size: obj.Size,
          lastModified: obj.LastModified,
        }));
      return res.json(videos);
    }

    // Local: list files from ./videos/
    const videosDir = path.join(__dirname, 'videos');
    if (!fs.existsSync(videosDir)) {
      fs.mkdirSync(videosDir, { recursive: true });
      return res.json([]);
    }
    const files = fs.readdirSync(videosDir)
      .filter(f => /\.(mp4|webm|ogg|mov|mkv)$/i.test(f))
      .map(f => {
        const stat = fs.statSync(path.join(videosDir, f));
        return {
          key: f,
          name: f,
          size: stat.size,
          lastModified: stat.mtime,
        };
      });
    res.json(files);
  } catch (err) {
    console.error('[API] Error listing videos:', err);
    res.status(500).json({ error: 'Failed to list videos' });
  }
});

// Get a video URL (pre-signed for S3, direct path for local)
app.get('/api/video-url', async (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(400).json({ error: 'Missing key' });

  try {
    if (VIDEO_SOURCE === 's3') {
      const ext = path.extname(key).toLowerCase();
      const contentTypes = {
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.ogg': 'video/ogg',
        '.mov': 'video/quicktime',
        '.mkv': 'video/x-matroska',
        '.avi': 'video/x-msvideo',
      };
      const ResponseContentType = contentTypes[ext] || 'video/mp4';

      const command = new GetObjectCommand({ 
        Bucket: S3_BUCKET, 
        Key: key,
        ResponseContentType
      });
      const url = await getSignedUrl(s3Client, command, { expiresIn: 7200 });
      return res.json({ url, source: 's3' });
    }

    // Local: return the streaming endpoint
    res.json({ url: `/api/stream/${encodeURIComponent(key)}`, source: 'local' });
  } catch (err) {
    console.error('[API] Error getting video URL:', err);
    res.status(500).json({ error: 'Failed to get video URL' });
  }
});

// Stream local video with Range support (HTTP 206)
app.get('/api/stream/:filename', (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  const filePath = path.join(__dirname, 'videos', filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  // Content type mapping
  const ext = path.extname(filename).toLowerCase();
  const contentTypes = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogg': 'video/ogg',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
  };
  const contentType = contentTypes[ext] || 'video/mp4';

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const file = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    });
    file.pipe(res);
  } else {
    // No range: send entire file
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// ─── Watch Party Rooms ──────────────────────────────────────────────────────
// rooms = { roomId: { host, users: Map, state, guestControls } }
const rooms = {};

function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      host: null,
      users: new Map(),
      state: {
        videoKey: null,
        playing: false,
        currentTime: 0,
        lastUpdated: Date.now(),
      },
      guestControls: false,
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
      isHost: id === room.host,
    });
  }
  return list;
}

// ─── Socket.IO ──────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[WS] Connected: ${socket.id}`);
  let currentRoom = null;
  let currentUsername = null;

  // ── Join room ─────────────────────────────────────────────────────────────
  socket.on('join-room', ({ roomId, username }) => {
    // If re-joining same room (e.g. React StrictMode), clean up old join first
    if (currentRoom && currentRoom !== roomId) {
      socket.leave(currentRoom);
      const oldRoom = rooms[currentRoom];
      if (oldRoom) {
        oldRoom.users.delete(socket.id);
        if (oldRoom.users.size === 0) {
          delete rooms[currentRoom];
        }
      }
    }

    currentRoom = roomId;
    currentUsername = username || 'Viewer';
    socket.join(roomId);
    const room = getOrCreateRoom(roomId);
    room.users.set(socket.id, { username: currentUsername, joinedAt: Date.now() });

    if (!room.host || !room.users.has(room.host)) {
      room.host = socket.id;
      socket.emit('role', { role: 'host' });
      console.log(`[WS] ${currentUsername} is host of room ${roomId}`);
    } else if (room.host === socket.id) {
      // Reconnecting host
      socket.emit('role', { role: 'host' });
      console.log(`[WS] ${currentUsername} reconnected as host of room ${roomId}`);
    } else {
      socket.emit('role', { role: 'guest' });
      socket.emit('sync-state', room.state);
      socket.emit('guest-controls-changed', { enabled: room.guestControls });
      console.log(`[WS] ${currentUsername} joined room ${roomId}`);
    }

    const userList = getUserList(room);
    io.to(roomId).emit('user-list', userList);
    io.to(roomId).emit('user-count', room.users.size);
    socket.emit('join-success', { roomId, userCount: room.users.size });

    // Notify others
    socket.to(roomId).emit('chat-message', {
      sender: '🤖 System',
      message: `${currentUsername} joined the room`,
      isSystem: true,
    });
  });

  // ── Host selects video ────────────────────────────────────────────────────
  socket.on('select-video', ({ roomId, videoKey }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;
    room.state = { videoKey, playing: false, currentTime: 0, lastUpdated: Date.now() };
    io.to(roomId).emit('video-selected', { videoKey });
  });

  // ── Play ──────────────────────────────────────────────────────────────────
  socket.on('play', ({ roomId, currentTime }) => {
    const room = rooms[roomId];
    if (!room) return;
    // Check if sender has permission
    if (room.host !== socket.id && !room.guestControls) return;

    room.state.playing = true;
    room.state.currentTime = currentTime;
    room.state.lastUpdated = Date.now();
    socket.to(roomId).emit('play', { currentTime });
  });

  // ── Pause ─────────────────────────────────────────────────────────────────
  socket.on('pause', ({ roomId, currentTime }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.host !== socket.id && !room.guestControls) return;

    room.state.playing = false;
    room.state.currentTime = currentTime;
    room.state.lastUpdated = Date.now();
    socket.to(roomId).emit('pause', { currentTime });
  });

  // ── Seek ──────────────────────────────────────────────────────────────────
  socket.on('seek', ({ roomId, currentTime }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.host !== socket.id && !room.guestControls) return;

    room.state.currentTime = currentTime;
    room.state.lastUpdated = Date.now();
    socket.to(roomId).emit('seek', { currentTime });
  });

  // ── Toggle guest controls (host only) ─────────────────────────────────────
  socket.on('toggle-guest-controls', ({ roomId, enabled }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;

    room.guestControls = !!enabled;
    io.to(roomId).emit('guest-controls-changed', { enabled: room.guestControls });
    console.log(`[WS] Guest controls ${room.guestControls ? 'enabled' : 'disabled'} in room ${roomId}`);
  });

  // ── Request sync ──────────────────────────────────────────────────────────
  socket.on('request-sync', ({ roomId }) => {
    const room = rooms[roomId];
    if (room) socket.emit('sync-state', room.state);
  });

  // ── Chat message ──────────────────────────────────────────────────────────
  socket.on('chat-message', ({ roomId, sender, message }) => {
    socket.to(roomId).emit('chat-message', { sender, message });
  });

  // ── Reaction ──────────────────────────────────────────────────────────────
  socket.on('reaction', ({ roomId, emoji }) => {
    socket.to(roomId).emit('reaction', { emoji });
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room) return;

    room.users.delete(socket.id);

    // Notify others
    io.to(currentRoom).emit('chat-message', {
      sender: '🤖 System',
      message: `${currentUsername || 'Someone'} left the room`,
      isSystem: true,
    });

    if (room.host === socket.id) {
      // Pass host to next user
      const remaining = [...room.users.keys()];
      if (remaining.length > 0) {
        room.host = remaining[0];
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
        delete rooms[currentRoom];
        return;
      }
    }

    if (rooms[currentRoom]) {
      const userList = getUserList(room);
      io.to(currentRoom).emit('user-list', userList);
      io.to(currentRoom).emit('user-count', room.users.size);
    }

    console.log(`[WS] Disconnected: ${socket.id} (${currentUsername})`);
  });
});

// ─── Start ──────────────────────────────────────────────────────────────────
nextApp.prepare().then(() => {
  // Let Next.js handle all other routes
  app.all('*', (req, res) => nextHandler(req, res));

  server.listen(PORT, () => {
    console.log(`\n🎬 Watch Party running on http://localhost:${PORT}`);
    console.log(`   Video source: ${VIDEO_SOURCE}`);
    console.log(`   Environment: ${dev ? 'development' : 'production'}\n`);
  });
});
