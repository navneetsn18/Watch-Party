const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const next = require('next');
const fs = require('fs');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');

// ─── Config ──────────────────────────────────────────────────────────────────
const dev = process.env.NODE_ENV !== 'production';
const PORT = process.env.PORT || 3000;
const VIDEO_SOURCE = (process.env.VIDEO_SOURCE || 'local').trim();

// Detect FFmpeg
let FFMPEG_PATH = null;
try {
  FFMPEG_PATH = execSync('which ffmpeg', { encoding: 'utf-8' }).trim();
  console.log(`[DEBUG] FFmpeg found at: ${FFMPEG_PATH}`);
} catch {
  console.log('[DEBUG] FFmpeg not found. HLS transcoding will be disabled.');
}

console.log('[DEBUG] --- Server Starting ---');
console.log(`[DEBUG] VIDEO_SOURCE resolved to: "${VIDEO_SOURCE}"`);  

// S3 support (optional)
let s3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, getSignedUrl, S3_BUCKET;
if (VIDEO_SOURCE === 's3') {
  const { S3Client, GetObjectCommand: GOC, ListObjectsV2Command, PutObjectCommand: POC, DeleteObjectCommand: DOC, HeadObjectCommand: HOC } = require('@aws-sdk/client-s3');
  const { getSignedUrl: gsu } = require('@aws-sdk/s3-request-presigner');
  s3Client = new S3Client({ region: (process.env.AWS_REGION || 'us-east-1').trim() });
  GetObjectCommand = GOC;
  PutObjectCommand = POC;
  DeleteObjectCommand = DOC;
  HeadObjectCommand = HOC;
  getSignedUrl = gsu;
  S3_BUCKET = process.env.S3_BUCKET_NAME?.trim();
  console.log(`[DEBUG] Initializing S3 Client | Region: "${process.env.AWS_REGION?.trim()}" | Bucket: "${S3_BUCKET}"`);
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
      console.log(`[DEBUG] Fetching videos from S3 bucket: "${S3_BUCKET}"...`);
      const result = await s3Client.send(command);
      console.log(`[DEBUG] S3 returned ${result.Contents?.length || 0} total objects.`);
      
      const videos = (result.Contents || [])
        .filter(obj => /\.(mp4|webm|ogg|mov|mkv|avi)$/i.test(obj.Key))
        .map(obj => ({
          key: obj.Key,
          name: obj.Key.replace(/^videos\//, ''),
          size: obj.Size,
          lastModified: obj.LastModified,
        }));
        
      console.log(`[DEBUG] Filtered down to ${videos.length} valid video files:`, videos.map(v => v.name));
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
    console.error('\n[API] === FATAL ERROR LISTING VIDEOS ===');
    console.error('[API] Error Name:', err.name);
    console.error('[API] Error Message:', err.message);
    console.error('[API] Full Stack Trace:\n', err);
    console.error('========================================\n');
    res.status(500).json({ error: 'Failed to list videos', details: err.message });
  }
});

// Get a video URL (pre-signed for S3, direct path for local, HLS if available)
app.get('/api/video-url', async (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(400).json({ error: 'Missing key' });

  try {
    if (VIDEO_SOURCE === 's3') {
      const baseName = path.parse(key).name;
      const hlsManifestKey = `videos/hls/${baseName}/index.m3u8`;

      // Check if HLS version exists in S3
      let hasHLS = false;
      try {
        await s3Client.send(new HeadObjectCommand({
          Bucket: S3_BUCKET,
          Key: hlsManifestKey
        }));
        hasHLS = true;
      } catch (err) {
        if (err.name !== 'NotFound') {
          console.error(`[S3 HEAD] Error checking HLS manifest ${hlsManifestKey}:`, err);
        }
        // HLS manifest doesn't exist or other error, fallback to raw
      }

      if (hasHLS) {
        return res.json({ url: `/api/hls-s3/${encodeURIComponent(baseName)}/index.m3u8`, source: 'hls' });
      }

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

    // Local: check if HLS version exists
    const baseName = path.parse(key).name;
    const hlsDir = path.join(__dirname, 'videos', 'hls', baseName);
    const hlsManifest = path.join(hlsDir, 'index.m3u8');
    if (fs.existsSync(hlsManifest)) {
      return res.json({ url: `/api/hls/${encodeURIComponent(baseName)}/index.m3u8`, source: 'hls' });
    }

    // Fallback: range streaming
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
    let start = parseInt(parts[0], 10);
    let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    // Handle suffix range requests (e.g. bytes=-500)
    if (isNaN(start)) {
      start = fileSize - end;
      end = fileSize - 1;
    }

    // Handle invalid/out-of-bounds ranges
    if (isNaN(end)) {
      end = fileSize - 1;
    }

    if (start >= fileSize || end >= fileSize || start < 0 || end < 0 || start > end) {
      res.writeHead(416, {
        'Content-Range': `bytes */${fileSize}`,
        'Content-Type': contentType,
      });
      return res.end();
    }

    const chunkSize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });

    file.on('error', (err) => {
      console.error(`[STREAM ERROR] Failed to stream file: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    });

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
    const file = fs.createReadStream(filePath);
    file.on('error', (err) => {
      console.error(`[STREAM ERROR] Failed to stream whole file: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    });
    file.pipe(res);
  }
});

// ─── HLS Segment Serving ────────────────────────────────────────────────────
app.get('/api/hls/:videoname/:file', (req, res) => {
  const { videoname, file } = req.params;
  const safeName = decodeURIComponent(videoname).replace(/[^a-zA-Z0-9_\-. ]/g, '');
  const safeFile = decodeURIComponent(file).replace(/[^a-zA-Z0-9_\-.]/g, '');
  const filePath = path.join(__dirname, 'videos', 'hls', safeName, safeFile);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'HLS file not found' });
  }

  const ext = path.extname(safeFile).toLowerCase();
  const mimeTypes = {
    '.m3u8': 'application/vnd.apple.mpegurl',
    '.ts': 'video/mp2t',
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': ext === '.m3u8' ? 'no-cache' : 'public, max-age=31536000',
    'Access-Control-Allow-Origin': '*',
  });
  fs.createReadStream(filePath).pipe(res);
});

// ─── HLS Segment Serving from S3 (Proxy) ────────────────────────────────────
app.get('/api/hls-s3/:videoname/:file', async (req, res) => {
  const { videoname, file } = req.params;
  const safeName = decodeURIComponent(videoname).replace(/[^a-zA-Z0-9_\-. ]/g, '');
  const safeFile = decodeURIComponent(file).replace(/[^a-zA-Z0-9_\-.]/g, '');
  const s3Key = `videos/hls/${safeName}/${safeFile}`;

  try {
    const ext = path.extname(safeFile).toLowerCase();
    const mimeTypes = {
      '.m3u8': 'application/vnd.apple.mpegurl',
      '.ts': 'video/mp2t',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
    });

    const s3Response = await s3Client.send(command);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': s3Response.ContentLength,
      'Cache-Control': ext === '.m3u8' ? 'no-cache' : 'public, max-age=31536000',
      'Access-Control-Allow-Origin': '*',
    });

    if (s3Response.Body && typeof s3Response.Body.pipe === 'function') {
      s3Response.Body.pipe(res);
    } else if (s3Response.Body) {
      const buffer = await s3Response.Body.transformToByteArray();
      res.end(Buffer.from(buffer));
    } else {
      res.status(404).send('HLS segment not found');
    }
  } catch (err) {
    console.error(`[HLS-S3 PROXY ERROR] Failed to fetch ${s3Key}:`, err.message);
    res.status(404).send('HLS segment not found');
  }
});

// Helper to upload a flat folder of files to S3
async function uploadDirectoryToS3(localDirPath, s3DirKey) {
  if (!fs.existsSync(localDirPath)) return;
  const files = fs.readdirSync(localDirPath);
  for (const file of files) {
    const localFilePath = path.join(localDirPath, file);
    const stat = fs.statSync(localFilePath);
    if (stat.isFile()) {
      const fileStream = fs.createReadStream(localFilePath);
      const ext = path.extname(file).toLowerCase();
      const mimeTypes = {
        '.m3u8': 'application/vnd.apple.mpegurl',
        '.ts': 'video/mp2t',
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      const uploadCommand = new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: `${s3DirKey}/${file}`,
        Body: fileStream,
        ContentType: contentType,
        ContentLength: stat.size,
      });
      await s3Client.send(uploadCommand);
    }
  }
}

// ─── Chunked Upload System ──────────────────────────────────────────────────
const uploads = {}; // { uploadId: { filename, totalChunks, receivedChunks, tmpDir, status } }

// Initialize an upload session
app.post('/api/upload/init', express.json(), (req, res) => {
  const { filename, totalChunks, fileSize } = req.body;
  if (!filename || !totalChunks) {
    return res.status(400).json({ error: 'Missing filename or totalChunks' });
  }

  // Validate file extension
  if (!/\.(mp4|webm|ogg|mov|mkv|avi)$/i.test(filename)) {
    return res.status(400).json({ error: 'Invalid file type. Supported: mp4, webm, ogg, mov, mkv, avi' });
  }

  const uploadId = crypto.randomUUID();
  const tmpDir = path.join(__dirname, 'videos', 'tmp', uploadId);
  fs.mkdirSync(tmpDir, { recursive: true });

  uploads[uploadId] = {
    filename: filename.replace(/[^a-zA-Z0-9_\-.() ]/g, '_'),
    totalChunks: parseInt(totalChunks, 10),
    fileSize: parseInt(fileSize, 10) || 0,
    receivedChunks: new Set(),
    tmpDir,
    status: 'uploading',
    createdAt: Date.now(),
  };

  console.log(`[UPLOAD] Initialized: ${uploadId} | File: ${filename} | Chunks: ${totalChunks}`);
  res.json({ uploadId, status: 'ready' });
});

// Receive a chunk
app.post('/api/upload/chunk', (req, res) => {
  const uploadId = req.headers['x-upload-id'];
  const chunkIndex = parseInt(req.headers['x-chunk-index'], 10);

  if (!uploadId || isNaN(chunkIndex)) {
    return res.status(400).json({ error: 'Missing upload ID or chunk index' });
  }

  const upload = uploads[uploadId];
  if (!upload) {
    return res.status(404).json({ error: 'Upload session not found' });
  }

  const chunkPath = path.join(upload.tmpDir, `chunk_${String(chunkIndex).padStart(6, '0')}`);
  const writeStream = fs.createWriteStream(chunkPath);

  req.pipe(writeStream);

  writeStream.on('finish', () => {
    upload.receivedChunks.add(chunkIndex);
    const progress = Math.round((upload.receivedChunks.size / upload.totalChunks) * 100);
    console.log(`[UPLOAD] ${uploadId} | Chunk ${chunkIndex + 1}/${upload.totalChunks} (${progress}%)`);
    res.json({ received: chunkIndex, progress });
  });

  writeStream.on('error', (err) => {
    console.error(`[UPLOAD] Write error: ${err.message}`);
    res.status(500).json({ error: 'Failed to write chunk' });
  });
});

// Complete upload — assemble chunks and start HLS transcoding
app.post('/api/upload/complete', express.json(), async (req, res) => {
  const { uploadId } = req.body;
  if (!uploadId) return res.status(400).json({ error: 'Missing uploadId' });

  const upload = uploads[uploadId];
  if (!upload) return res.status(404).json({ error: 'Upload not found' });

  // Check all chunks received
  if (upload.receivedChunks.size < upload.totalChunks) {
    return res.status(400).json({
      error: `Missing chunks: received ${upload.receivedChunks.size}/${upload.totalChunks}`,
    });
  }

  upload.status = 'assembling';
  console.log(`[UPLOAD] Assembling ${upload.totalChunks} chunks for: ${upload.filename}`);

  try {
    // Assemble chunks
    const videosDir = path.join(__dirname, 'videos');
    if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });

    const finalPath = path.join(videosDir, upload.filename);
    const writeStream = fs.createWriteStream(finalPath);

    for (let i = 0; i < upload.totalChunks; i++) {
      const chunkPath = path.join(upload.tmpDir, `chunk_${String(i).padStart(6, '0')}`);
      const chunkData = fs.readFileSync(chunkPath);
      writeStream.write(chunkData);
    }

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      writeStream.end();
    });

    // Clean up tmp chunks
    fs.rmSync(upload.tmpDir, { recursive: true, force: true });
    console.log(`[UPLOAD] Assembled successfully: ${upload.filename}`);

    const baseName = path.parse(upload.filename).name;
    const hlsDir = path.join(videosDir, 'hls', baseName);

    // Shared S3 uploader helper
    const uploadToS3AndCleanup = async (hlsDirToUpload = null) => {
      try {
        console.log(`[UPLOAD] Uploading raw video to S3: ${upload.filename}`);
        const fileStream = fs.createReadStream(finalPath);
        const ext = path.extname(upload.filename).toLowerCase();
        const contentTypes = {
          '.mp4': 'video/mp4',
          '.webm': 'video/webm',
          '.ogg': 'video/ogg',
          '.mov': 'video/quicktime',
          '.mkv': 'video/x-matroska',
          '.avi': 'video/x-msvideo',
        };
        const contentType = contentTypes[ext] || 'video/mp4';

        const uploadCommand = new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: `videos/${upload.filename}`,
          Body: fileStream,
          ContentType: contentType,
          ContentLength: fs.statSync(finalPath).size,
        });
        await s3Client.send(uploadCommand);

        if (hlsDirToUpload && fs.existsSync(hlsDirToUpload)) {
          console.log(`[UPLOAD] Uploading HLS chunks to S3 for baseName: ${baseName}`);
          await uploadDirectoryToS3(hlsDirToUpload, `videos/hls/${baseName}`);
        }

        upload.status = 'complete';
        console.log(`[UPLOAD] S3 Upload complete (including HLS chunks if transcoded): ${upload.filename}`);
        io.emit('transcode-complete', { uploadId, filename: upload.filename });
      } catch (err) {
        upload.status = 'error';
        console.error(`[UPLOAD] S3 Upload failed:`, err);
        io.emit('transcode-error', { uploadId, filename: upload.filename });
      } finally {
        try {
          if (fs.existsSync(finalPath)) {
            fs.unlinkSync(finalPath);
            console.log(`[UPLOAD] Cleaned up local raw file: ${finalPath}`);
          }
        } catch (cleanupErr) {
          console.error(`[UPLOAD] Failed to clean up local raw file: ${cleanupErr.message}`);
        }
        try {
          if (hlsDirToUpload && fs.existsSync(hlsDirToUpload)) {
            fs.rmSync(hlsDirToUpload, { recursive: true, force: true });
            console.log(`[UPLOAD] Cleaned up local HLS dir: ${hlsDirToUpload}`);
          }
        } catch (cleanupErr) {
          console.error(`[UPLOAD] Failed to clean up local HLS dir: ${cleanupErr.message}`);
        }
      }
    };

    if (VIDEO_SOURCE === 's3') {
      if (FFMPEG_PATH) {
        upload.status = 'transcoding';
        fs.mkdirSync(hlsDir, { recursive: true });

        const hlsOutput = path.join(hlsDir, 'index.m3u8');
        const ext = path.extname(upload.filename).toLowerCase();

        // Use codec copy for MP4 (fast), re-encode for others
        const ffmpegArgs = ext === '.mp4'
          ? [
              '-i', finalPath,
              '-codec', 'copy',
              '-start_number', '0',
              '-hls_time', '4',
              '-hls_list_size', '0',
              '-hls_segment_filename', path.join(hlsDir, 'segment%03d.ts'),
              '-f', 'hls',
              hlsOutput,
            ]
          : [
              '-i', finalPath,
              '-c:v', 'libx264',
              '-c:a', 'aac',
              '-preset', 'fast',
              '-crf', '23',
              '-start_number', '0',
              '-hls_time', '4',
              '-hls_list_size', '0',
              '-hls_segment_filename', path.join(hlsDir, 'segment%03d.ts'),
              '-f', 'hls',
              hlsOutput,
            ];

        console.log(`[HLS] Starting transcoding for S3 upload: ${upload.filename}`);

        const ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs);
        let ffmpegStderr = '';

        ffmpeg.on('error', (err) => {
          console.error(`[HLS] FFmpeg spawn error for S3 upload:`, err);
          upload.status = 'error';
          io.emit('transcode-error', { uploadId, filename: upload.filename });
          try { if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath); } catch {}
          try { if (fs.existsSync(hlsDir)) fs.rmSync(hlsDir, { recursive: true, force: true }); } catch {}
        });

        ffmpeg.stderr.on('data', (data) => {
          ffmpegStderr += data.toString();
          const timeMatch = data.toString().match(/time=(\d{2}):(\d{2}):(\d{2})/);
          if (timeMatch) {
            const secs = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]);
            io.emit('transcode-progress', { uploadId, filename: upload.filename, seconds: secs });
          }
        });

        ffmpeg.on('close', (code) => {
          if (code === 0) {
            console.log(`[HLS] Local transcoding complete, starting S3 upload: ${upload.filename}`);
            upload.status = 's3_uploading';
            uploadToS3AndCleanup(hlsDir);
          } else {
            upload.status = 'error';
            console.error(`[HLS] Transcoding failed (code ${code}): ${upload.filename}`);
            console.error(`[HLS] FFmpeg stderr: ${ffmpegStderr.slice(-500)}`);
            io.emit('transcode-error', { uploadId, filename: upload.filename });
            // Clean up raw and transcode attempts
            try { if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath); } catch {}
            try { if (fs.existsSync(hlsDir)) fs.rmSync(hlsDir, { recursive: true, force: true }); } catch {}
          }
        });

        res.json({ status: 'transcoding', uploadId, filename: upload.filename });
      } else {
        upload.status = 's3_uploading';
        uploadToS3AndCleanup(null);
        res.json({ status: 's3_uploading', uploadId, filename: upload.filename });
      }
    } else if (FFMPEG_PATH) {
      upload.status = 'transcoding';
      fs.mkdirSync(hlsDir, { recursive: true });

      const hlsOutput = path.join(hlsDir, 'index.m3u8');
      const ext = path.extname(upload.filename).toLowerCase();

      // Use codec copy for MP4 (fast), re-encode for others
      const ffmpegArgs = ext === '.mp4'
        ? [
            '-i', finalPath,
            '-codec', 'copy',
            '-start_number', '0',
            '-hls_time', '4',
            '-hls_list_size', '0',
            '-hls_segment_filename', path.join(hlsDir, 'segment%03d.ts'),
            '-f', 'hls',
            hlsOutput,
          ]
        : [
            '-i', finalPath,
            '-c:v', 'libx264',
            '-c:a', 'aac',
            '-preset', 'fast',
            '-crf', '23',
            '-start_number', '0',
            '-hls_time', '4',
            '-hls_list_size', '0',
            '-hls_segment_filename', path.join(hlsDir, 'segment%03d.ts'),
            '-f', 'hls',
            hlsOutput,
          ];

      console.log(`[HLS] Starting local transcoding: ${upload.filename}`);

      const ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs);
      let ffmpegStderr = '';

      ffmpeg.on('error', (err) => {
        console.error(`[HLS] FFmpeg spawn error for local transcoding:`, err);
        upload.status = 'error';
        io.emit('transcode-error', { uploadId, filename: upload.filename });
      });

      ffmpeg.stderr.on('data', (data) => {
        ffmpegStderr += data.toString();
        const timeMatch = data.toString().match(/time=(\d{2}):(\d{2}):(\d{2})/);
        if (timeMatch) {
          const secs = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]);
          io.emit('transcode-progress', { uploadId, filename: upload.filename, seconds: secs });
        }
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          upload.status = 'complete';
          console.log(`[HLS] Transcoding complete: ${upload.filename}`);
          io.emit('transcode-complete', { uploadId, filename: upload.filename });
        } else {
          upload.status = 'error';
          console.error(`[HLS] Transcoding failed (code ${code}): ${upload.filename}`);
          console.error(`[HLS] FFmpeg stderr: ${ffmpegStderr.slice(-500)}`);
          io.emit('transcode-error', { uploadId, filename: upload.filename });
        }
      });

      res.json({ status: 'transcoding', uploadId, filename: upload.filename });
    } else {
      upload.status = 'complete';
      res.json({ status: 'complete', uploadId, filename: upload.filename });
    }
  } catch (err) {
    upload.status = 'error';
    console.error(`[UPLOAD] Assembly error: ${err.message}`);
    res.status(500).json({ error: 'Failed to assemble upload', details: err.message });
  }
});

// Check upload/transcode status
app.get('/api/upload/status/:uploadId', (req, res) => {
  const upload = uploads[req.params.uploadId];
  if (!upload) return res.status(404).json({ error: 'Not found' });
  res.json({ status: upload.status, filename: upload.filename });
});

// Delete a video
app.delete('/api/videos/:filename', async (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  const safeName = filename.replace(/[^a-zA-Z0-9_\-.() ]/g, '');

  try {
    if (VIDEO_SOURCE === 's3') {
      const command = new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: `videos/${safeName}`,
      });
      await s3Client.send(command);
      return res.json({ deleted: true });
    }

    const filePath = path.join(__dirname, 'videos', safeName);
    const baseName = path.parse(safeName).name;
    const hlsDir = path.join(__dirname, 'videos', 'hls', baseName);

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    if (fs.existsSync(hlsDir)) fs.rmSync(hlsDir, { recursive: true, force: true });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Watch Party Rooms ──────────────────────────────────────────────────────
// rooms = { roomId: { host, users: Map, state, guestControls } }
const rooms = {};

// ── Check room availability (for custom room codes) ─────────────────────────
app.get('/api/check-room/:code', (req, res) => {
  const code = req.params.code?.trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Missing code' });
  if (!/^[A-Z0-9]{3,12}$/.test(code)) {
    return res.json({ available: false, reason: 'Invalid format. Use 3-12 alphanumeric characters.' });
  }
  const room = rooms[code];
  const inUse = room && room.users.size > 0;
  res.json({ available: !inUse, code });
});

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
        hostBuffering: false,
      },
      guestControls: true,
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
      room.state.hostBuffering = false;
      socket.emit('role', { role: 'host' });
      console.log(`[WS] ${currentUsername} is host of room ${roomId}`);
    } else if (room.host === socket.id) {
      // Reconnecting host
      room.state.hostBuffering = false;
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
    room.state = { videoKey, playing: false, currentTime: 0, lastUpdated: Date.now(), hostBuffering: false };
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
  socket.on('seek', ({ roomId, currentTime, playing }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.host !== socket.id && !room.guestControls) return;

    room.state.currentTime = currentTime;
    room.state.playing = typeof playing === 'boolean' ? playing : room.state.playing;
    room.state.lastUpdated = Date.now();
    socket.to(roomId).emit('seek', { currentTime, playing });
  });

  // ── Toggle guest controls (host only) ─────────────────────────────────────
  socket.on('toggle-guest-controls', ({ roomId, enabled }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;

    room.guestControls = !!enabled;
    io.to(roomId).emit('guest-controls-changed', { enabled: room.guestControls });
    console.log(`[WS] Guest controls ${room.guestControls ? 'enabled' : 'disabled'} in room ${roomId}`);
  });

  // ── Host buffering ────────────────────────────────────────────────────────
  socket.on('host-buffering', ({ roomId, isBuffering }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;
    room.state.hostBuffering = !!isBuffering;
    socket.to(roomId).emit('host-buffering', { isBuffering });
  });

  // ── Host time update (periodic synchronization) ──────────────────────────
  socket.on('host-time-update', ({ roomId, currentTime, playing, timestamp }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;
    room.state.currentTime = currentTime;
    room.state.playing = !!playing;
    room.state.lastUpdated = timestamp || Date.now();
    socket.to(roomId).emit('host-time-update', { currentTime, playing, timestamp });
  });

  // ── Request sync ──────────────────────────────────────────────────────────
  socket.on('request-sync', ({ roomId }) => {
    const room = rooms[roomId];
    if (room) socket.emit('sync-state', room.state);
  });

  // ── Guest request (when guest controls are off) ───────────────────────────
  socket.on('guest-request', ({ roomId, action }) => {
    const room = rooms[roomId];
    if (!room) return;
    // Only guests can make requests, and only when guest controls are off
    if (room.host === socket.id) return;
    if (room.guestControls) return;

    const userInfo = room.users.get(socket.id);
    const username = userInfo?.username || 'Guest';
    const requestId = `${socket.id}-${Date.now()}`;

    // Forward request to host
    io.to(room.host).emit('guest-request-received', {
      id: requestId,
      guestId: socket.id,
      username,
      action,
    });

    console.log(`[WS] Guest ${username} requested: ${action} in room ${roomId}`);
  });

  socket.on('host-approve-request', ({ roomId, requestId, action, guestId }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;

    const video = room.state;
    // Execute the action
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
        room.state.currentTime = Math.min((video.currentTime || 0) + 10, 999999);
        room.state.lastUpdated = Date.now();
        io.to(roomId).emit('seek', { currentTime: room.state.currentTime, playing: room.state.playing });
        break;
      case 'seek-backward':
        room.state.currentTime = Math.max((video.currentTime || 0) - 10, 0);
        room.state.lastUpdated = Date.now();
        io.to(roomId).emit('seek', { currentTime: room.state.currentTime, playing: room.state.playing });
        break;
    }

    // Notify the guest
    io.to(guestId).emit('request-approved', { requestId, action });
    console.log(`[WS] Host approved ${action} request from ${guestId} in room ${roomId}`);
  });

  socket.on('host-reject-request', ({ roomId, requestId, guestId }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) return;
    io.to(guestId).emit('request-rejected', { requestId });
    console.log(`[WS] Host rejected request ${requestId} from ${guestId} in room ${roomId}`);
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
