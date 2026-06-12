'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSocket } from '../../lib/socket';
import { supabase } from '../../lib/supabase';

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
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
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
  const [displayName, setDisplayName] = useState('');
  const [tsCreated, setTsCreated] = useState(0);
  const [tsUploaded, setTsUploaded] = useState(0);
  const [tsTotal, setTsTotal] = useState(0);

  // Thumbnail states
  const [thumbnailType, setThumbnailType] = useState('upload'); // upload | url
  const [thumbnailData, setThumbnailData] = useState(null);
  const [thumbnailFilename, setThumbnailFilename] = useState('');
  const [thumbnailContentType, setThumbnailContentType] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');

  const fileInputRef = useRef(null);
  const abortRef = useRef(false);
  const startTimeRef = useRef(0);

  // Authenticate user on load
  useEffect(() => {
    async function checkAuth() {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        router.push('/auth');
        return;
      }
      setUser(currentUser);
      setLoading(false);
    }
    checkAuth();
  }, [router]);

  // Listen for transcode progress via Socket.IO
  useEffect(() => {
    const processingStates = ['assembling', 'transcoding', 's3_uploading'];
    if (!processingStates.includes(uploadState)) return;

    const socket = getSocket();

    function handleProgress({ uploadId: id, seconds, status, tsCreated, tsUploaded, tsTotal }) {
      if (id === uploadId) {
        if (seconds !== undefined) setTranscodeTime(seconds);
        if (status) setUploadState(status);
        if (tsCreated !== undefined) setTsCreated(tsCreated);
        if (tsUploaded !== undefined) setTsUploaded(tsUploaded);
        if (tsTotal !== undefined) setTsTotal(tsTotal);
      }
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
        if (data.status) {
          setUploadState(data.status);
          if (data.status === 'error') {
            setErrorMsg('Processing failed. Please check server logs.');
          }
        }
        if (data.tsCreated !== undefined) setTsCreated(data.tsCreated);
        if (data.tsUploaded !== undefined) setTsUploaded(data.tsUploaded);
        if (data.tsTotal !== undefined) setTsTotal(data.tsTotal);
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
    setDisplayName(f.name.replace(/\.[^/.]+$/, ""));
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
    setTsCreated(0);
    setTsUploaded(0);
    setTsTotal(0);
    startTimeRef.current = Date.now();

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    try {
      // Get current session token for authentication
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token || '';

      const extension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      const baseName = displayName.trim() || file.name.replace(/\.[^/.]+$/, "");
      const targetFilename = `${baseName}${extension}`;

      // 1. Initialize upload
      const initRes = await fetch('/api/upload/init', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          filename: targetFilename,
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
            'Authorization': `Bearer ${token}`
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
      const payload = {
        uploadId,
        uploaderId: user?.id,
        displayName: displayName.trim() || file.name,
        isPrivate: false // Starts public, user can toggle to private later in settings
      };

      if (thumbnailType === 'upload' && thumbnailData) {
        payload.thumbnailData = thumbnailData;
        payload.thumbnailFilename = thumbnailFilename;
        payload.thumbnailContentType = thumbnailContentType;
      } else if (thumbnailType === 'url' && thumbnailUrl) {
        payload.thumbnailUrl = thumbnailUrl;
      }

      const completeRes = await fetch('/api/upload/complete', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload),
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
    setDisplayName('');
    setUploadState('idle');
    setProgress(0);
    setSpeed(0);
    setEta(null);
    setUploadedBytes(0);
    setErrorMsg('');
    setUploadId(null);
    setTranscodeTime(0);
    setTsCreated(0);
    setTsUploaded(0);
    setTsTotal(0);
    setThumbnailType('upload');
    setThumbnailData(null);
    setThumbnailFilename('');
    setThumbnailContentType('');
    setThumbnailUrl('');
  }

  const isUploading = uploadState === 'uploading';
  const isProcessing = uploadState === 'assembling' || uploadState === 'transcoding' || uploadState === 's3_uploading';
  const isComplete = uploadState === 'complete';
  const isError = uploadState === 'error';
  if (loading) {
    return (
      <div className="upload-container">
        <div className="upload-header" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px' }}>
          <div className="upload-title" style={{ textAlign: 'center' }}>
            <div className="upload-icon">📤</div>
            <h1>Upload Video</h1>
            <p>Verifying permissions...</p>
            <div className="spinner" style={{ margin: '20px auto' }} />
          </div>
        </div>
      </div>
    );
  }

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

            {file && (
              <>
                <div className="input-group" style={{ marginTop: '20px', marginBottom: '10px' }}>
                  <label className="input-label">Video Title</label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Enter a custom title for this video"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={100}
                    required
                  />
                </div>

                <div className="input-group" style={{ marginTop: '15px', marginBottom: '15px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label className="input-label" style={{ fontWeight: 'bold', fontSize: '14px' }}>Video Thumbnail</label>
                  <div style={{ display: 'flex', gap: '15px', marginBottom: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px' }}>
                      <input
                        type="radio"
                        name="thumbnailType"
                        value="upload"
                        checked={thumbnailType === 'upload'}
                        onChange={() => setThumbnailType('upload')}
                      />
                      Upload Image
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px' }}>
                      <input
                        type="radio"
                        name="thumbnailType"
                        value="url"
                        checked={thumbnailType === 'url'}
                        onChange={() => setThumbnailType('url')}
                      />
                      Image URL
                    </label>
                  </div>

                  {thumbnailType === 'upload' ? (
                    <div key="thumbnail-upload-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <input
                        key="thumbnail-file-input"
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const imgFile = e.target.files?.[0];
                          if (imgFile) {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              setThumbnailData(reader.result);
                              setThumbnailFilename(imgFile.name);
                              setThumbnailContentType(imgFile.type);
                            };
                            reader.readAsDataURL(imgFile);
                          }
                        }}
                        style={{
                          fontSize: '13px',
                          padding: '6px',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '4px',
                          color: '#fff',
                          cursor: 'pointer'
                        }}
                      />
                      {thumbnailData && (
                        <div style={{ marginTop: '5px' }}>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Preview:</span>
                          <img
                            src={thumbnailData}
                            alt="Thumbnail Preview"
                            style={{ maxWidth: '160px', height: '90px', objectFit: 'cover', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)' }}
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div key="thumbnail-url-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <input
                        key="thumbnail-url-input"
                        type="text"
                        className="input-field"
                        placeholder="https://example.com/thumbnail.jpg"
                        value={thumbnailUrl}
                        onChange={(e) => setThumbnailUrl(e.target.value)}
                      />
                      {thumbnailUrl && (
                        <div style={{ marginTop: '5px' }}>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Preview:</span>
                          <img
                            src={thumbnailUrl}
                            alt="Thumbnail URL Preview"
                            onError={(e) => { e.target.style.display = 'none'; }}
                            style={{ maxWidth: '160px', height: '90px', objectFit: 'cover', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)' }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

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
              <div className="upload-transcode-info" style={{ marginTop: '15px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div className="upload-transcode-pulse" />
                  <span>HLS Segments Created: <strong>{tsCreated}</strong> segments</span>
                </div>
                {transcodeTime > 0 && (
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Processed: {formatDuration(transcodeTime)}</span>
                )}
              </div>
            )}

            {uploadState === 's3_uploading' && (
              <div className="upload-transcode-info" style={{ marginTop: '15px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div className="upload-transcode-pulse" />
                  <span>Uploading to S3: <strong>{tsUploaded}</strong> of <strong>{tsTotal}</strong> segments uploaded</span>
                </div>
                {tsTotal > 0 && (
                  <div className="upload-progress-bar-wrap" style={{ width: '100%', maxWidth: '300px', marginTop: '5px' }}>
                    <div className="upload-progress-bar" style={{ height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div
                        className="upload-progress-fill"
                        style={{ width: `${Math.round((tsUploaded / tsTotal) * 100)}%`, height: '100%', background: 'linear-gradient(90deg, #3b82f6, #60a5fa)', transition: 'width 0.3s ease' }}
                      />
                    </div>
                    <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {Math.round((tsUploaded / tsTotal) * 100)}% Complete
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="upload-processing-note" style={{ marginTop: '15px' }}>
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
              {(() => {
                const extension = file?.name ? file.name.substring(file.name.lastIndexOf('.')).toLowerCase() : '.mp4';
                const base = displayName.trim() || (file?.name ? file.name.replace(/\.[^/.]+$/, "") : 'Video');
                return base.endsWith(extension) ? base : `${base}${extension}`;
              })()} is ready for Netflix-style streaming
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
