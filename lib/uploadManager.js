'use client';

// Module-level upload manager. Lives outside React, so uploads keep running
// while the user navigates between pages in the same tab. A full page
// reload/close still kills transfers — the beforeunload guard warns first.
//
// Offline edition: one streaming POST to the local server (no chunking, no
// presigning) — the server pipes the request body straight to disk.

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
  return [...tasks.values()].some(t => t.state === 'uploading');
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
  if (t.xhr) { try { t.xhr.abort(); } catch {} }
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

// Poll transcode status for tasks the server is still converting to HLS
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
        }
        if (data.tsCreated !== undefined) t.tsCreated = data.tsCreated;
      } catch {}
    }));
    notify();
  }, 3000);
}

export function startUpload(file, { displayName, thumbnailData, thumbnailFilename, thumbnailContentType, thumbnailUrl } = {}) {
  const task = {
    id: nextTaskId++,
    fileName: file.name,
    displayName: (displayName || '').trim() || file.name.replace(/\.[^/.]+$/, ''),
    size: file.size,
    state: 'uploading', // uploading | transcoding | complete | error | cancelled
    progress: 0,
    uploadedBytes: 0,
    speed: 0,
    eta: null,
    tsCreated: 0,
    error: '',
    uploadId: null,
    aborted: false,
    xhr: null,
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

  // 1. If a thumbnail image was chosen, park it on the server first
  let thumbnailUrl = thumbs.thumbnailUrl || '';
  if (thumbs.thumbnailData) {
    const res = await fetch('/api/upload/thumbnail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        data: thumbs.thumbnailData,
        filename: thumbs.thumbnailFilename,
        contentType: thumbs.thumbnailContentType,
      }),
    });
    if (res.ok) {
      thumbnailUrl = (await res.json()).url;
    }
  }

  // 2. Stream the video to the server in one request, with live progress
  const params = new URLSearchParams({
    filename: file.name,
    displayName: task.displayName,
    thumbnailUrl,
    isPrivate: 'false',
  });

  const result = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    task.xhr = xhr;
    xhr.open('POST', `/api/upload/local?${params}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    let lastUiUpdate = 0;
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const now = Date.now();
      if (now - lastUiUpdate < 200 && e.loaded < e.total) return;
      lastUiUpdate = now;
      task.uploadedBytes = e.loaded;
      task.progress = Math.round((e.loaded / e.total) * 100);
      const elapsed = (now - task.startedAt) / 1000;
      const bytesPerSec = elapsed > 0 ? e.loaded / elapsed : 0;
      task.speed = bytesPerSec;
      task.eta = bytesPerSec > 0 ? (e.total - e.loaded) / bytesPerSec : null;
      notify();
    };
    xhr.onload = () => {
      task.xhr = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error('Malformed server response')); }
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => { task.xhr = null; reject(new Error('Network error during upload')); };
    xhr.onabort = () => { task.xhr = null; reject(new Error('Upload cancelled')); };
    xhr.send(file);
  });

  if (task.aborted) return;

  task.uploadId = result.uploadId;
  if (result.status === 'transcoding') {
    task.state = 'transcoding';
    ensurePolling();
  } else {
    task.state = 'complete';
  }
  notify();
  updateLeaveGuard();
}
