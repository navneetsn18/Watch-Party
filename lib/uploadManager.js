'use client';

// Module-level upload manager. Lives outside React, so uploads keep running
// while the user navigates between pages in the same tab (SPA navigation
// doesn't reload the JS context). A full page reload/close still kills
// transfers — the beforeunload guard warns about that while any are active.

const MULTIPART_CHUNK_SIZE = 100 * 1024 * 1024; // 100MB parts
const UPLOAD_CONCURRENCY = 4; // parallel part uploads per file
const PART_MAX_RETRIES = 3;

const tasks = new Map(); // taskId -> task
const listeners = new Set();
let nextTaskId = 1;
let pollTimer = null;

function notify() {
  listeners.forEach(cb => cb());
}

export function subscribeUploads(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getUploadTasks() {
  return [...tasks.values()].reverse(); // newest first
}

export function hasActiveUploads() {
  return [...tasks.values()].some(t => t.state === 'uploading' || t.state === 'assembling');
}

export function dismissUpload(taskId) {
  const t = tasks.get(taskId);
  if (t && ['complete', 'error', 'cancelled'].includes(t.state)) {
    tasks.delete(taskId);
    notify();
  }
}

export function cancelUpload(taskId) {
  const t = tasks.get(taskId);
  if (!t || t.state !== 'uploading') return;
  t.aborted = true;
  t.xhrs.forEach(x => { try { x.abort(); } catch {} });
  t.xhrs.clear();
  t.state = 'cancelled';
  notify();
  updateLeaveGuard();
}

function getToken() {
  try { return localStorage.getItem('watch_party_token') || ''; } catch { return ''; }
}

function beforeUnload(e) {
  e.preventDefault();
  e.returnValue = '';
}

function updateLeaveGuard() {
  if (typeof window === 'undefined') return;
  if (hasActiveUploads()) window.addEventListener('beforeunload', beforeUnload);
  else window.removeEventListener('beforeunload', beforeUnload);
}

// Poll transcode status for tasks in the 'transcoding' state. Polling (not
// sockets) on purpose: the room page disconnects the shared socket on exit,
// which would silently kill socket-based listeners here.
function ensurePolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    const transcoding = [...tasks.values()].filter(t => t.state === 'transcoding' && t.uploadId);
    if (transcoding.length === 0) {
      clearInterval(pollTimer);
      pollTimer = null;
      return;
    }
    await Promise.all(transcoding.map(async (t) => {
      try {
        const res = await fetch(`/api/upload/status/${t.uploadId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === 'complete') {
          t.state = 'complete';
        } else if (data.status === 'error') {
          t.state = 'error';
          t.error = data.errorMessage || 'Transcoding failed. The video is still watchable as the raw file.';
        } else if (data.jobPercentComplete !== undefined) {
          t.jobPercentComplete = data.jobPercentComplete;
        }
      } catch {}
    }));
    notify();
  }, 5000);
}

export function startUpload(file, { displayName, thumbnailData, thumbnailFilename, thumbnailContentType, thumbnailUrl } = {}) {
  const task = {
    id: nextTaskId++,
    fileName: file.name,
    displayName: (displayName || '').trim() || file.name.replace(/\.[^/.]+$/, ''),
    size: file.size,
    state: 'uploading', // uploading | assembling | transcoding | complete | error | cancelled
    progress: 0,
    uploadedBytes: 0,
    speed: 0,
    eta: null,
    jobPercentComplete: 0,
    error: '',
    uploadId: null,
    aborted: false,
    xhrs: new Set(),
    startedAt: Date.now(),
  };
  tasks.set(task.id, task);
  notify();
  updateLeaveGuard();

  runPipeline(task, file, { thumbnailData, thumbnailFilename, thumbnailContentType, thumbnailUrl })
    .catch((err) => {
      if (!task.aborted) {
        task.state = 'error';
        task.error = err.message;
        notify();
      }
      updateLeaveGuard();
    });

  return task.id;
}

async function runPipeline(task, file, thumbs) {
  const token = getToken();
  const totalChunks = Math.ceil(file.size / MULTIPART_CHUNK_SIZE);

  const extension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  const targetFilename = `${task.displayName}${extension}`;

  // 1. Initiate multipart session
  const initRes = await fetch('/api/upload/multipart/initiate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ filename: targetFilename, fileSize: file.size, displayName: task.displayName }),
  });
  const initData = await initRes.json();
  if (!initRes.ok) throw new Error(initData.error || 'Failed to init upload');
  const { uploadId, key } = initData;
  task.uploadId = uploadId;

  // 2. Batch-sign all part URLs in one round trip
  const signParts = async (partNumbers) => {
    const res = await fetch('/api/upload/multipart/sign-parts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ uploadId, key, partNumbers }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to sign upload parts');
    return data.urls;
  };

  const allPartNumbers = Array.from({ length: totalChunks }, (_, i) => i + 1);
  const partUrls = await signParts(allPartNumbers);

  // 3. Upload parts in parallel directly to S3 with per-part retry
  const completedParts = [];
  const partLoaded = {};
  let completedBytes = 0;
  let nextIndex = 0;
  let lastUiUpdate = 0;

  const updateProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastUiUpdate < 200) return;
    lastUiUpdate = now;
    const inFlight = Object.values(partLoaded).reduce((a, b) => a + b, 0);
    const total = Math.min(completedBytes + inFlight, file.size);
    task.uploadedBytes = total;
    task.progress = Math.round((total / file.size) * 100);
    const elapsed = (now - task.startedAt) / 1000;
    const bytesPerSec = elapsed > 0 ? total / elapsed : 0;
    task.speed = bytesPerSec;
    task.eta = bytesPerSec > 0 ? (file.size - total) / bytesPerSec : null;
    notify();
  };

  const putPart = (url, chunk, partNumber) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    task.xhrs.add(xhr);
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        partLoaded[partNumber] = e.loaded;
        updateProgress();
      }
    };
    xhr.onload = () => {
      task.xhrs.delete(xhr);
      if (xhr.status >= 200 && xhr.status < 300) {
        const eTag = xhr.getResponseHeader('ETag');
        if (!eTag) return reject(new Error(`S3 response missing ETag header for part ${partNumber}`));
        resolve(eTag.replace(/"/g, ''));
      } else {
        reject(new Error(`Failed to upload part ${partNumber} to S3 (${xhr.status})`));
      }
    };
    xhr.onerror = () => {
      task.xhrs.delete(xhr);
      reject(new Error(`Network error uploading part ${partNumber}`));
    };
    xhr.onabort = () => {
      task.xhrs.delete(xhr);
      reject(new Error('Upload cancelled'));
    };
    xhr.send(chunk);
  });

  const uploadPart = async (partNumber, attempt = 0) => {
    const start = (partNumber - 1) * MULTIPART_CHUNK_SIZE;
    const end = Math.min(start + MULTIPART_CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    try {
      const eTag = await putPart(partUrls[partNumber], chunk, partNumber);
      return { PartNumber: partNumber, ETag: eTag, size: end - start };
    } catch (err) {
      if (attempt < PART_MAX_RETRIES && !task.aborted) {
        partLoaded[partNumber] = 0;
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        try {
          const fresh = await signParts([partNumber]);
          partUrls[partNumber] = fresh[partNumber];
        } catch {}
        return uploadPart(partNumber, attempt + 1);
      }
      throw err;
    }
  };

  const worker = async () => {
    while (true) {
      if (task.aborted) return;
      const i = nextIndex++;
      if (i >= totalChunks) return;
      const partNumber = i + 1;
      const part = await uploadPart(partNumber);
      completedParts.push({ PartNumber: part.PartNumber, ETag: part.ETag });
      delete partLoaded[partNumber];
      completedBytes += part.size;
      updateProgress(true);
    }
  };

  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, totalChunks) }, worker));

  if (task.aborted) return;

  completedParts.sort((a, b) => a.PartNumber - b.PartNumber);

  // 4. Complete upload on the server
  task.state = 'assembling';
  notify();

  const payload = {
    uploadId,
    key,
    parts: completedParts,
    displayName: task.displayName,
    isPrivate: false,
  };
  if (thumbs.thumbnailData) {
    payload.thumbnailData = thumbs.thumbnailData;
    payload.thumbnailFilename = thumbs.thumbnailFilename;
    payload.thumbnailContentType = thumbs.thumbnailContentType;
  } else if (thumbs.thumbnailUrl) {
    payload.thumbnailUrl = thumbs.thumbnailUrl;
  }

  const completeRes = await fetch('/api/upload/multipart/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const completeData = await completeRes.json();
  if (!completeRes.ok) throw new Error(completeData.error || 'Failed to complete upload');

  if (completeData.status === 'transcoding') {
    task.state = 'transcoding';
    ensurePolling();
  } else {
    task.state = 'complete';
  }
  notify();
  updateLeaveGuard();
}
