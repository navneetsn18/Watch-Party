'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSocket } from '../../lib/socket';

const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks
const ALLOWED_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-matroska', 'video/avi', 'video/x-msvideo'];
const ALLOWED_EXTS = /\.(mp4|webm|ogg|mov|mkv|avi)$/i;

function formatBytes(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + ' KB';
  return bytes + ' B';
}

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadState, setUploadState] = useState('idle'); // idle | uploading | assembling | transcoding | complete | error
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [eta, setEta] = useState(null);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [uploadId, setUploadId] = useState(null);
  const [transcodeTime, setTranscodeTime] = useState(0);

  const fileInputRef = useRef(null);
  const abortRef = useRef(false);
  const startTimeRef = useRef(0);

  // Listen for transcode progress via Socket.IO
  useEffect(() => {
    if (uploadState !== 'transcoding') return;

    const socket = getSocket();

    function handleProgress({ uploadId: id, seconds }) {
      if (id === uploadId) setTranscodeTime(seconds);
    }
    function handleComplete({ uploadId: id }) {
      if (id === uploadId) setUploadState('complete');
    }
    function handleError({ uploadId: id }) {
      if (id === uploadId) {
        setUploadState('error');
        setErrorMsg('HLS transcoding failed. Video is still available for range-based streaming.');
      }
    }

    socket.on('transcode-progress', handleProgress);
    socket.on('transcode-complete', handleComplete);
    socket.on('transcode-error', handleError);

    // Also poll status as a fallback
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/upload/status/${uploadId}`);
        const data = await res.json();
        if (data.status === 's3_uploading') {
          setUploadState('s3_uploading');
        } else if (data.status === 'complete') {
          setUploadState('complete');
        } else if (data.status === 'error') {
          setUploadState('error');
          setErrorMsg('Processing failed. Please check server logs.');
        }
      } catch {}
    }, 3000);

    return () => {
      socket.off('transcode-progress', handleProgress);
      socket.off('transcode-complete', handleComplete);
      socket.off('transcode-error', handleError);
      clearInterval(interval);
    };
  }, [uploadState, uploadId]);

  function validateFile(f) {
    if (!f) return 'No file selected';
    if (!ALLOWED_EXTS.test(f.name)) return 'Invalid file type. Use: mp4, webm, ogg, mov, mkv, avi';
    return null;
  }

  function handleFileSelect(f) {
    const err = validateFile(f);
    if (err) {
      setErrorMsg(err);
      return;
    }
    setErrorMsg('');
    setFile(f);
    setUploadState('idle');
    setProgress(0);
    setSpeed(0);
    setEta(null);
    setUploadedBytes(0);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFileSelect(f);
  }

  function handleDragOver(e) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setDragOver(false);
  }

  async function startUpload() {
    if (!file) return;
    abortRef.current = false;
    setErrorMsg('');
    setUploadState('uploading');
    setProgress(0);
    setSpeed(0);
    setUploadedBytes(0);
    startTimeRef.current = Date.now();

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    try {
      // 1. Initialize upload
      const initRes = await fetch('/api/upload/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          totalChunks,
          fileSize: file.size,
        }),
      });
      const initData = await initRes.json();
      if (!initRes.ok) throw new Error(initData.error || 'Failed to init upload');
      const uploadId = initData.uploadId;
      setUploadId(uploadId);

      // 2. Upload chunks sequentially
      for (let i = 0; i < totalChunks; i++) {
        if (abortRef.current) {
          setUploadState('idle');
          return;
        }

        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        const res = await fetch('/api/upload/chunk', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Upload-Id': uploadId,
            'X-Chunk-Index': String(i),
          },
          body: chunk,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Chunk ${i} failed`);
        }

        const sentBytes = end;
        setUploadedBytes(sentBytes);
        const pct = Math.round((sentBytes / file.size) * 100);
        setProgress(pct);

        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        const bytesPerSec = elapsed > 0 ? sentBytes / elapsed : 0;
        setSpeed(bytesPerSec);
        const remaining = file.size - sentBytes;
        setEta(bytesPerSec > 0 ? remaining / bytesPerSec : null);
      }

      // 3. Complete upload
      setUploadState('assembling');
      const completeRes = await fetch('/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId }),
      });
      const completeData = await completeRes.json();
      if (!completeRes.ok) throw new Error(completeData.error || 'Failed to complete upload');

      if (completeData.status === 'transcoding') {
        setUploadState('transcoding');
      } else if (completeData.status === 's3_uploading') {
        setUploadState('s3_uploading');
      } else {
        setUploadState('complete');
      }
    } catch (err) {
      if (!abortRef.current) {
        setErrorMsg(err.message);
        setUploadState('error');
      }
    }
  }

  function handleCancel() {
    abortRef.current = true;
    setUploadState('idle');
    setProgress(0);
  }

  function handleReset() {
    setFile(null);
    setUploadState('idle');
    setProgress(0);
    setSpeed(0);
    setEta(null);
    setUploadedBytes(0);
    setErrorMsg('');
    setUploadId(null);
    setTranscodeTime(0);
  }

  const isUploading = uploadState === 'uploading';
  const isProcessing = uploadState === 'assembling' || uploadState === 'transcoding' || uploadState === 's3_uploading';
  const isComplete = uploadState === 'complete';
  const isError = uploadState === 'error';

  return (
    <div className="upload-container">
      <div className="upload-header">
        <button className="upload-back-btn" onClick={() => router.push('/')}>
          ← Back to Lobby
        </button>
        <div className="upload-title">
          <div className="upload-icon">📤</div>
          <h1>Upload Video</h1>
          <p>Upload your video files for Netflix-style HLS streaming</p>
        </div>
      </div>

      <div className="upload-card">
        {/* Idle / File Selection */}
        {!isUploading && !isProcessing && !isComplete && (
          <>
            <div
              className={`upload-dropzone ${dragOver ? 'dragover' : ''} ${file ? 'has-file' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelect(f);
                }}
              />

              {file ? (
                <div className="upload-file-info">
                  <div className="upload-file-icon">🎬</div>
                  <div className="upload-file-details">
                    <div className="upload-file-name">{file.name}</div>
                    <div className="upload-file-meta">
                      {formatBytes(file.size)} • {Math.ceil(file.size / CHUNK_SIZE)} chunks × 2MB
                    </div>
                  </div>
                  <button
                    className="upload-file-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleReset();
                    }}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <>
                  <div className="dropzone-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M12 16V4m0 0l-4 4m4-4l4 4" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M20 16v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <div className="dropzone-text">
                    <strong>Drop a video here</strong> or click to browse
                  </div>
                  <div className="dropzone-hint">
                    MP4, WebM, MKV, MOV, OGG, AVI
                  </div>
                </>
              )}
            </div>

            {errorMsg && (
              <div className="upload-error">⚠️ {errorMsg}</div>
            )}

            {file && (
              <button className="btn btn-primary upload-start-btn" onClick={startUpload}>
                🚀 Start Upload
              </button>
            )}

            <div className="upload-features">
              <div className="upload-feature">
                <span className="upload-feature-icon">📦</span>
                <div>
                  <strong>Chunked Upload</strong>
                  <span>Files split into 2MB chunks for reliable transfer</span>
                </div>
              </div>
              <div className="upload-feature">
                <span className="upload-feature-icon">🎬</span>
                <div>
                  <strong>HLS Transcoding</strong>
                  <span>Auto-converted to Netflix-style streaming format</span>
                </div>
              </div>
              <div className="upload-feature">
                <span className="upload-feature-icon">⚡</span>
                <div>
                  <strong>Instant Playback</strong>
                  <span>4-second segments for lag-free, seekable streaming</span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Uploading */}
        {isUploading && (
          <div className="upload-progress-section">
            <div className="upload-progress-header">
              <div className="upload-progress-icon uploading">📤</div>
              <div>
                <div className="upload-progress-title">Uploading...</div>
                <div className="upload-progress-subtitle">{file?.name}</div>
              </div>
            </div>

            <div className="upload-progress-bar-wrap">
              <div className="upload-progress-bar">
                <div
                  className="upload-progress-fill"
                  style={{ width: progress + '%' }}
                />
              </div>
              <span className="upload-progress-pct">{progress}%</span>
            </div>

            <div className="upload-progress-stats">
              <span>{formatBytes(uploadedBytes)} / {formatBytes(file?.size || 0)}</span>
              <span>{formatBytes(speed)}/s</span>
              <span>ETA: {eta !== null ? formatDuration(eta) : '—'}</span>
            </div>

            <button className="btn btn-secondary upload-cancel-btn" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        )}

        {/* Processing (assembling / transcoding) */}
        {isProcessing && (
          <div className="upload-progress-section">
            <div className="upload-progress-header">
              <div className="upload-progress-icon processing">
                <div className="spinner" />
              </div>
              <div>
                <div className="upload-progress-title">
                  {uploadState === 'assembling' && 'Assembling file...'}
                  {uploadState === 's3_uploading' && 'Uploading to Amazon S3...'}
                  {uploadState === 'transcoding' && 'Converting to HLS...'}
                </div>
                <div className="upload-progress-subtitle">
                  {uploadState === 'assembling' && 'Combining chunks into final video file'}
                  {uploadState === 's3_uploading' && 'Transferring the assembled file to your S3 bucket'}
                  {uploadState === 'transcoding' && 'FFmpeg is splitting into 4-second segments for streaming'}
                </div>
              </div>
            </div>

            {uploadState === 'transcoding' && (
              <div className="upload-transcode-info">
                <div className="upload-transcode-pulse" />
                <span>Processed: {formatDuration(transcodeTime)}</span>
              </div>
            )}

            <div className="upload-processing-note">
              This may take a few minutes for large files. You can leave this page — processing continues in the background.
            </div>
          </div>
        )}

        {/* Complete */}
        {isComplete && (
          <div className="upload-complete-section">
            <div className="upload-complete-icon">✅</div>
            <div className="upload-complete-title">Upload Complete!</div>
            <div className="upload-complete-subtitle">
              {file?.name} is ready for Netflix-style streaming
            </div>

            <div className="upload-complete-actions">
              <button className="btn btn-primary" onClick={() => router.push('/')}>
                🎬 Go to Watch Party
              </button>
              <button className="btn btn-secondary" onClick={handleReset}>
                📤 Upload Another
              </button>
            </div>
          </div>
        )}

        {/* Error (when not in idle state) */}
        {isError && (
          <div className="upload-error-section">
            <div className="upload-error-icon">❌</div>
            <div className="upload-error-title">Upload Failed</div>
            <div className="upload-error-msg">{errorMsg}</div>
            <button className="btn btn-secondary" onClick={handleReset}>
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
