'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, UploadCloud, Video, AlertCircle, CheckCircle, RefreshCw, Layers, Shield, Cpu, RefreshCw as SpinnerIcon, Image as ImageIcon, Link2, Loader2 } from 'lucide-react';
import { getSocket } from '../../lib/socket';
import { supabase } from '../../lib/supabase';

const MULTIPART_CHUNK_SIZE = 100 * 1024 * 1024; // 100MB parts
const UPLOAD_CONCURRENCY = 4; // parallel part uploads
const PART_MAX_RETRIES = 3;
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
  const [jobPercentComplete, setJobPercentComplete] = useState(0);

  // Thumbnail states
  const [thumbnailType, setThumbnailType] = useState('upload'); // upload | url
  const [thumbnailData, setThumbnailData] = useState(null);
  const [thumbnailFilename, setThumbnailFilename] = useState('');
  const [thumbnailContentType, setThumbnailContentType] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');

  const fileInputRef = useRef(null);
  const abortRef = useRef(false);
  const startTimeRef = useRef(0);
  const activeXhrsRef = useRef(new Set());

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

    function handleProgress({ uploadId: id, seconds, status, tsCreated, tsUploaded, tsTotal, jobPercentComplete }) {
      if (id === uploadId) {
        if (seconds !== undefined) setTranscodeTime(seconds);
        if (status) setUploadState(status);
        if (tsCreated !== undefined) setTsCreated(tsCreated);
        if (tsUploaded !== undefined) setTsUploaded(tsUploaded);
        if (tsTotal !== undefined) setTsTotal(tsTotal);
        if (jobPercentComplete !== undefined) setJobPercentComplete(jobPercentComplete);
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
            setErrorMsg(data.errorMessage || 'Processing failed. Please check server logs.');
          }
        }
        if (data.tsCreated !== undefined) setTsCreated(data.tsCreated);
        if (data.tsUploaded !== undefined) setTsUploaded(data.tsUploaded);
        if (data.tsTotal !== undefined) setTsTotal(data.tsTotal);
        if (data.jobPercentComplete !== undefined) setJobPercentComplete(data.jobPercentComplete);
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
    
    // 6 GB Limit check
    const maxBytes = 6 * 1024 * 1024 * 1024;
    if (f.size > maxBytes) {
      return 'File size exceeds the 6 GB upload limit.';
    }
    
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
    setJobPercentComplete(0);
    startTimeRef.current = Date.now();

    const totalChunks = Math.ceil(file.size / MULTIPART_CHUNK_SIZE);

    try {
      // Get current session token for authentication
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token || '';

      const extension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      const baseName = displayName.trim() || file.name.replace(/\.[^/.]+$/, "");
      const targetFilename = `${baseName}${extension}`;

      // 1. Initialize upload
      const initRes = await fetch('/api/upload/multipart/initiate', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          filename: targetFilename,
          fileSize: file.size,
          displayName: baseName,
        }),
      });
      const initData = await initRes.json();
      if (!initRes.ok) throw new Error(initData.error || 'Failed to init upload');
      const { uploadId, key } = initData;
      setUploadId(uploadId);

      // 2. Batch-sign presigned URLs for all parts in one round trip
      const signParts = async (partNumbers) => {
        const res = await fetch('/api/upload/multipart/sign-parts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ uploadId, key, partNumbers })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to sign upload parts');
        return data.urls;
      };

      const allPartNumbers = Array.from({ length: totalChunks }, (_, i) => i + 1);
      const partUrls = await signParts(allPartNumbers);

      // 3. Upload parts in parallel directly to S3
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
        setUploadedBytes(total);
        setProgress(Math.round((total / file.size) * 100));
        const elapsed = (now - startTimeRef.current) / 1000;
        const bytesPerSec = elapsed > 0 ? total / elapsed : 0;
        setSpeed(bytesPerSec);
        setEta(bytesPerSec > 0 ? (file.size - total) / bytesPerSec : null);
      };

      const putPart = (url, chunk, partNumber) => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        activeXhrsRef.current.add(xhr);
        xhr.open('PUT', url);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            partLoaded[partNumber] = e.loaded;
            updateProgress();
          }
        };
        xhr.onload = () => {
          activeXhrsRef.current.delete(xhr);
          if (xhr.status >= 200 && xhr.status < 300) {
            const eTag = xhr.getResponseHeader('ETag');
            if (!eTag) return reject(new Error(`S3 response missing ETag header for part ${partNumber}`));
            resolve(eTag.replace(/"/g, ''));
          } else {
            reject(new Error(`Failed to upload part ${partNumber} to S3 (${xhr.status})`));
          }
        };
        xhr.onerror = () => {
          activeXhrsRef.current.delete(xhr);
          reject(new Error(`Network error uploading part ${partNumber}`));
        };
        xhr.onabort = () => {
          activeXhrsRef.current.delete(xhr);
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
          if (attempt < PART_MAX_RETRIES && !abortRef.current) {
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
          if (abortRef.current) return;
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

      await Promise.all(
        Array.from({ length: Math.min(UPLOAD_CONCURRENCY, totalChunks) }, worker)
      );

      if (abortRef.current) {
        setUploadState('idle');
        return;
      }

      completedParts.sort((a, b) => a.PartNumber - b.PartNumber);

      // 4. Complete upload
      setUploadState('assembling');
      const payload = {
        uploadId,
        key,
        parts: completedParts,
        uploaderId: user?.id,
        displayName: displayName.trim() || file.name,
        isPrivate: false
      };

      if (thumbnailType === 'upload' && thumbnailData) {
        payload.thumbnailData = thumbnailData;
        payload.thumbnailFilename = thumbnailFilename;
        payload.thumbnailContentType = thumbnailContentType;
      } else if (thumbnailType === 'url' && thumbnailUrl) {
        payload.thumbnailUrl = thumbnailUrl;
      }

      const completeRes = await fetch('/api/upload/multipart/complete', {
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
    activeXhrsRef.current.forEach(xhr => { try { xhr.abort(); } catch {} });
    activeXhrsRef.current.clear();
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
    setJobPercentComplete(0);
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
      <div className="min-h-[85vh] w-full flex items-center justify-center bg-[#07070a]">
        <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-12 bg-[#07070a] min-h-[90vh] flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 pb-6 border-b border-zinc-900 select-none">
        <button 
          onClick={() => router.push('/')}
          className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-400 cursor-pointer self-start transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Lobby</span>
        </button>
        <div>
          <h1 className="text-3xl font-black text-white flex items-center gap-2.5 tracking-tight">
            <UploadCloud className="w-7 h-7 text-violet-400" />
            Upload Video
          </h1>
          <p className="text-sm text-zinc-400 mt-1.5">
            Deliver your clips directly to S3 and initiate serverless HLS transcoding
          </p>
        </div>
      </div>

      {/* Main Upload Box */}
      <div className="bg-zinc-900/35 border border-zinc-800/60 p-8 rounded-3xl backdrop-blur-md shadow-2xl">
        {/* Idle Selection Form */}
        {!isUploading && !isProcessing && !isComplete && (
          <div className="flex flex-col gap-6">
            {/* Drag Zone */}
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`w-full border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                dragOver 
                  ? 'border-violet-500 bg-violet-950/10' 
                  : file 
                    ? 'border-zinc-700 bg-zinc-950/20' 
                    : 'border-zinc-800 hover:border-zinc-700 bg-zinc-950/30'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelect(f);
                }}
              />

              {file ? (
                <div className="flex items-center gap-4 text-left w-full max-w-md bg-zinc-950 p-4 rounded-xl border border-zinc-800 relative group">
                  <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-violet-400 flex-shrink-0">
                    <Video className="w-6 h-6" />
                  </div>
                  <div className="min-w-0 flex-1 flex flex-col">
                    <span className="text-sm font-bold text-white truncate">{file.name}</span>
                    <span className="text-[10px] text-zinc-500 font-mono mt-0.5">
                      {formatBytes(file.size)} • {Math.ceil(file.size / MULTIPART_CHUNK_SIZE)} parts
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleReset();
                    }}
                    className="p-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white cursor-pointer transition-colors"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 select-none">
                  <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl text-zinc-400 mb-2">
                    <UploadCloud className="w-8 h-8" />
                  </div>
                  <span className="text-sm font-bold text-white">Drag and drop your file here</span>
                  <span className="text-xs text-zinc-500">or click to browse local files</span>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-600 mt-4">
                    MP4, WebM, MKV, MOV, AVI (Max 6 GB)
                  </span>
                </div>
              )}
            </div>

            {/* Custom Settings (only visible when file is loaded) */}
            {file && (
              <div className="flex flex-col gap-5 pt-4 border-t border-zinc-900/60">
                {/* Title */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-zinc-400">Video Title</label>
                  <input
                    type="text"
                    className="w-full px-4 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-200 focus:outline-none focus:border-violet-600 text-sm transition-all"
                    placeholder="Enter a custom title for this video"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={100}
                    required
                  />
                </div>

                {/* Thumbnail Picker */}
                <div className="flex flex-col gap-2.5">
                  <label className="text-xs font-semibold text-zinc-400">Video Thumbnail</label>
                  
                  {/* Selector Radio tab */}
                  <div className="flex gap-4 mb-2">
                    <label className="flex items-center gap-2 text-xs font-medium text-zinc-400 cursor-pointer select-none">
                      <input
                        type="radio"
                        name="thumbnailType"
                        value="upload"
                        checked={thumbnailType === 'upload'}
                        onChange={() => setThumbnailType('upload')}
                        className="w-[18px] h-[18px] text-violet-600 focus:ring-violet-600 cursor-pointer border-zinc-800 bg-zinc-950"
                      />
                      <span className="flex items-center gap-1"><UploadCloud className="w-3.5 h-3.5" /> Upload Image</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs font-medium text-zinc-400 cursor-pointer select-none">
                      <input
                        type="radio"
                        name="thumbnailType"
                        value="url"
                        checked={thumbnailType === 'url'}
                        onChange={() => setThumbnailType('url')}
                        className="w-[18px] h-[18px] text-violet-600 focus:ring-violet-600 cursor-pointer border-zinc-800 bg-zinc-950"
                      />
                      <span className="flex items-center gap-1"><Link2 className="w-3.5 h-3.5" /> Image URL</span>
                    </label>
                  </div>

                  {thumbnailType === 'upload' ? (
                    <div className="flex flex-col gap-3">
                      <input
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
                        className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs cursor-pointer focus:outline-none"
                      />
                      {thumbnailData && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold text-zinc-500 uppercase">Preview:</span>
                          <img
                            src={thumbnailData}
                            alt="Preview"
                            className="max-w-[200px] aspect-video object-cover rounded-xl border border-zinc-800 shadow"
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <input
                        type="text"
                        className="w-full px-4 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-200 focus:outline-none focus:border-violet-600 text-sm transition-all"
                        placeholder="https://example.com/thumbnail.jpg"
                        value={thumbnailUrl}
                        onChange={(e) => setThumbnailUrl(e.target.value)}
                      />
                      {thumbnailUrl && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold text-zinc-500 uppercase">Preview:</span>
                          <img
                            src={thumbnailUrl}
                            alt="Preview URL"
                            onError={(e) => { e.target.style.display = 'none'; }}
                            className="max-w-[200px] aspect-video object-cover rounded-xl border border-zinc-800 shadow"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="p-3 rounded-xl border bg-red-950/20 border-red-900/35 text-red-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                <span>{errorMsg}</span>
              </div>
            )}

            {file && (
              <button 
                onClick={startUpload}
                className="w-full py-3.5 rounded-xl bg-violet-600 hover:bg-violet-600 text-white font-semibold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-violet-900/20 active:scale-[0.98]"
              >
                <span>Start Uploading</span>
              </button>
            )}

            {/* Feature lists */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-6 border-t border-zinc-900/60">
              <div className="p-4 rounded-2xl bg-zinc-950/50 border border-zinc-900 flex items-start gap-3">
                <div className="p-2 bg-zinc-900 rounded-lg text-violet-400 flex-shrink-0 mt-0.5">
                  <Layers className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-white">Direct S3 Multi-part</span>
                  <span className="text-[10px] text-zinc-500 mt-1 leading-relaxed">
                    Uploads bypass intermediate servers, shipping 100MB chunks in parallel.
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-zinc-950/50 border border-zinc-900 flex items-start gap-3">
                <div className="p-2 bg-zinc-900 rounded-lg text-violet-400 flex-shrink-0 mt-0.5">
                  <Cpu className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-white">AWS MediaConvert</span>
                  <span className="text-[10px] text-zinc-500 mt-1 leading-relaxed">
                    Transcodes video serverlessly to handle HLS adaptive bitrates automatically.
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-zinc-950/50 border border-zinc-900 flex items-start gap-3">
                <div className="p-2 bg-zinc-900 rounded-lg text-violet-400 flex-shrink-0 mt-0.5">
                  <CheckCircle className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-white">HLS Segments</span>
                  <span className="text-[10px] text-zinc-500 mt-1 leading-relaxed">
                    Splits videos into 4-second playlist clips for robust synchronized watch party lobbies.
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Uploading progress states */}
        {isUploading && (
          <div className="flex flex-col gap-6 py-6 text-center sm:text-left select-none">
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="w-12 h-12 bg-violet-950/30 border border-violet-900/40 text-violet-400 rounded-2xl flex items-center justify-center flex-shrink-0">
                <UploadCloud className="w-6 h-6 animate-pulse" />
              </div>
              <div className="min-w-0 flex-1 flex flex-col">
                <span className="text-lg font-bold text-white leading-snug">Uploading Video Parts...</span>
                <span className="text-xs text-zinc-500 mt-0.5 truncate">{file?.name}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs font-semibold text-zinc-400 px-1">
                <span>Upload Progress</span>
                <span className="text-violet-400 font-mono">{progress}%</span>
              </div>
              <div className="w-full h-2.5 bg-zinc-950 rounded-full overflow-hidden border border-zinc-900">
                <motion.div
                  className="h-full bg-gradient-to-r from-violet-600 to-indigo-600 rounded-full"
                  style={{ width: `${progress}%` }}
                  transition={{ ease: 'easeOut', duration: 0.2 }}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 p-4 rounded-2xl bg-zinc-950 border border-zinc-900 text-center">
              <div className="flex flex-col">
                <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Transferred</span>
                <span className="text-sm font-bold text-zinc-200 mt-1 font-mono">{formatBytes(uploadedBytes)}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Speed</span>
                <span className="text-sm font-bold text-zinc-200 mt-1 font-mono">{formatBytes(speed)}/s</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">ETA</span>
                <span className="text-sm font-bold text-zinc-200 mt-1 font-mono">
                  {eta !== null ? formatDuration(eta) : 'estimating...'}
                </span>
              </div>
            </div>

            <button 
              onClick={handleCancel}
              className="w-full py-3 rounded-xl bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white font-semibold text-xs transition-colors cursor-pointer"
            >
              Cancel Upload
            </button>
          </div>
        )}

        {/* Processing states (assembling / transcoding) */}
        {isProcessing && (
          <div className="flex flex-col gap-6 py-6 select-none">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-zinc-950 border border-zinc-900 flex items-center justify-center flex-shrink-0">
                <SpinnerIcon className="w-5 h-5 text-violet-500 animate-spin" />
              </div>
              <div className="flex-1 flex flex-col min-w-0">
                <span className="text-base font-bold text-white">
                  {uploadState === 'assembling' && 'Assembling multipart chunks...'}
                  {uploadState === 'transcoding' && 'Converting to HLS streams...'}
                </span>
                <span className="text-xs text-zinc-500 mt-1 leading-snug">
                  {uploadState === 'assembling' && 'Instructing AWS S3 to stitch the chunks together.'}
                  {uploadState === 'transcoding' && 'AWS MediaConvert is generating adaptive bitrate playlist playlists.'}
                </span>
              </div>
            </div>

            {uploadState === 'transcoding' && (
              <div className="flex flex-col gap-3 p-5 rounded-2xl bg-zinc-950 border border-zinc-900 text-center">
                <div className="flex items-center justify-between text-xs font-semibold text-zinc-400">
                  <span>Transcode Completion</span>
                  <span className="text-emerald-400 font-mono">{jobPercentComplete}%</span>
                </div>
                <div className="w-full h-2 bg-zinc-900 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-300"
                    style={{ width: `${jobPercentComplete}%` }}
                  />
                </div>
              </div>
            )}

            <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-900 text-[11px] text-zinc-500 text-center leading-relaxed">
              This process runs serverlessly in the cloud. You can safely exit this screen — your video progress will continue in the background.
            </div>
          </div>
        )}

        {/* Completed state */}
        {isComplete && (
          <div className="flex flex-col items-center text-center gap-5 py-6">
            <div className="w-16 h-16 rounded-3xl bg-emerald-950/20 border border-emerald-900/35 text-emerald-400 flex items-center justify-center text-2xl shadow-xl shadow-emerald-950/10">
              ✓
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="text-xl font-black text-white tracking-tight">Upload Complete!</h2>
              <p className="text-xs text-zinc-500 max-w-[280px] leading-relaxed mx-auto">
                {(() => {
                  const extension = file?.name ? file.name.substring(file.name.lastIndexOf('.')).toLowerCase() : '.mp4';
                  const base = displayName.trim() || (file?.name ? file.name.replace(/\.[^/.]+$/, "") : 'Video');
                  return base.endsWith(extension) ? base : `${base}${extension}`;
                })()} is fully processed and ready for watch parties!
              </p>
            </div>

            <div className="flex gap-3 w-full max-w-sm mt-4">
              <button 
                onClick={() => router.push('/')}
                className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-600 active:scale-98 text-white font-semibold text-xs cursor-pointer shadow-lg shadow-violet-900/15 transition-all"
              >
                Go to Lobby
              </button>
              <button 
                onClick={handleReset}
                className="flex-1 py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white font-semibold text-xs cursor-pointer transition-colors active:scale-98"
              >
                Upload Another
              </button>
            </div>
          </div>
        )}

        {/* Error State */}
        {isError && (
          <div className="flex flex-col items-center text-center gap-5 py-6">
            <div className="w-16 h-16 rounded-3xl bg-red-950/20 border border-red-900/35 text-red-400 flex items-center justify-center text-2xl shadow-xl shadow-red-950/10">
              ✕
            </div>
            <div className="flex flex-col gap-1.5 px-4">
              <h2 className="text-xl font-black text-white tracking-tight">Upload Failed</h2>
              <p className="text-xs text-red-400 font-medium leading-relaxed max-w-[320px] mx-auto">{errorMsg}</p>
            </div>
            
            <button 
              onClick={handleReset}
              className="mt-4 px-6 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white font-semibold text-xs cursor-pointer transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
