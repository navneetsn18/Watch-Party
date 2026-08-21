'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, UploadCloud, Video, AlertCircle, CheckCircle, Layers, Cpu, RefreshCw as SpinnerIcon, Link2, Loader2, X, FolderSearch } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { startUpload, subscribeUploads, getUploadTasks, cancelUpload, dismissUpload } from '../../lib/uploadManager';

const MULTIPART_CHUNK_SIZE = 100 * 1024 * 1024; // display only — manager owns the real value
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

function transcodeEta(task) {
  if (!task.expectedSegments || !task.transcodeStartedAt || !task.tsCreated) return null;
  const elapsed = (Date.now() - task.transcodeStartedAt) / 1000;
  const rate = task.tsCreated / elapsed; // segments/sec
  if (rate <= 0) return null;
  return (task.expectedSegments - task.tsCreated) / rate;
}

const STATE_LABELS = {
  uploading: 'Copying to library',
  transcoding: 'Converting to HLS',
  complete: 'Ready to watch',
  error: 'Failed',
  cancelled: 'Cancelled',
};

export default function UploadPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState('');
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [displayName, setDisplayName] = useState('');

  // Thumbnail states
  const [thumbnailType, setThumbnailType] = useState('upload'); // upload | url
  const [thumbnailData, setThumbnailData] = useState(null);
  const [thumbnailFilename, setThumbnailFilename] = useState('');
  const [thumbnailContentType, setThumbnailContentType] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');

  // Optional subtitle file, attached right after the video finishes uploading
  const [subtitleFile, setSubtitleFile] = useState(null);

  const fileInputRef = useRef(null);

  // Upload tasks live in lib/uploadManager (module scope) so they survive
  // navigating away from this page; we just re-render on its updates.
  const [, setVersion] = useState(0);
  useEffect(() => subscribeUploads(() => setVersion(v => v + 1)), []);
  const uploadTasks = getUploadTasks();

  // Authenticate user on load
  useEffect(() => {
    async function checkAuth() {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        router.push('/auth');
        return;
      }
      setLoading(false);
    }
    checkAuth();
  }, [router]);

  function validateFile(f) {
    if (!f) return 'No file selected';
    if (!ALLOWED_EXTS.test(f.name)) return 'Invalid file type. Use: mp4, webm, ogg, mov, mkv, avi';
    const maxBytes = 100 * 1024 * 1024 * 1024;
    if (f.size > maxBytes) {
      return 'File size exceeds the 100 GB upload limit.';
    }
    return null;
  }

  async function handleScan() {
    setScanning(true);
    setScanResult('');
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const res = await fetch('/api/videos/scan', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scan failed');
      setScanResult(
        data.added.length === 0
          ? `Scanned ${data.scanned} file(s) — nothing new.`
          : `Found and registered ${data.added.length} new file(s): ${data.added.map(v => v.displayName).join(', ')}. Transcoding in the background.`
      );
    } catch (err) {
      setScanResult('Error: ' + err.message);
    } finally {
      setScanning(false);
    }
  }

  function handleFileSelect(f) {
    const err = validateFile(f);
    if (err) {
      setErrorMsg(err);
      return;
    }
    setErrorMsg('');
    setFile(f);
    setDisplayName(f.name.replace(/\.[^/.]+$/, ''));
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFileSelect(f);
  }

  function resetForm() {
    setFile(null);
    setDisplayName('');
    setErrorMsg('');
    setThumbnailType('upload');
    setThumbnailData(null);
    setThumbnailFilename('');
    setThumbnailContentType('');
    setThumbnailUrl('');
    setSubtitleFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleStart() {
    if (!file) return;
    startUpload(file, {
      displayName,
      thumbnailData: thumbnailType === 'upload' ? thumbnailData : null,
      thumbnailFilename,
      thumbnailContentType,
      thumbnailUrl: thumbnailType === 'url' ? thumbnailUrl : null,
      subtitleFile,
    });
    resetForm(); // form is free immediately — queue the next one or leave the page
  }

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
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-black text-white flex items-center gap-2.5 tracking-tight">
              <UploadCloud className="w-7 h-7 text-violet-400" />
              Upload Video
            </h1>
            <p className="text-sm text-zinc-400 mt-1.5">
              Uploads run in the background — queue several and keep browsing while they finish
            </p>
          </div>
          <button
            onClick={handleScan}
            disabled={scanning}
            title="Register any video files dropped directly into the videos/ folder (e.g. synced via Google Drive) without uploading them through the browser"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-zinc-300 hover:text-white cursor-pointer transition-colors disabled:cursor-wait flex-shrink-0"
          >
            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderSearch className="w-4 h-4" />}
            <span>{scanning ? 'Scanning...' : 'Scan videos folder'}</span>
          </button>
        </div>
        {scanResult && (
          <div className="p-3 rounded-xl border bg-violet-950/20 border-violet-900/35 text-violet-300 text-xs leading-relaxed">
            {scanResult}
          </div>
        )}
      </div>

      {/* Upload form */}
      <div className="bg-zinc-900/35 border border-zinc-800/60 p-8 rounded-3xl backdrop-blur-md shadow-2xl">
        <div className="flex flex-col gap-6">
          {/* Drag Zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
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
                    resetForm();
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
                  MP4, WebM, MKV, MOV, AVI (Max 100 GB)
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

              {/* Subtitle Picker (optional) */}
              <div className="flex flex-col gap-2.5">
                <label className="text-xs font-semibold text-zinc-400">Subtitles (optional)</label>
                {subtitleFile ? (
                  <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800">
                    <span className="text-xs text-zinc-300 truncate">{subtitleFile.name}</span>
                    <button
                      type="button"
                      onClick={() => setSubtitleFile(null)}
                      className="text-zinc-500 hover:text-white text-xs cursor-pointer flex-shrink-0 ml-2"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <input
                    type="file"
                    accept=".vtt,.srt"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setSubtitleFile(f);
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs cursor-pointer focus:outline-none"
                  />
                )}
                <span className="text-[10px] text-zinc-600">.vtt or .srt — attached once the upload finishes. Add more languages later from Profile → My Videos.</span>
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
              onClick={handleStart}
              className="w-full py-3.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-violet-900/20 active:scale-[0.98]"
            >
              <span>Start Uploading</span>
            </button>
          )}
        </div>
      </div>

      {/* Active & recent uploads */}
      {uploadTasks.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 px-1">
            Uploads ({uploadTasks.length})
          </h3>
          {uploadTasks.map(task => (
            <div key={task.id} className="bg-zinc-900/35 border border-zinc-800/60 rounded-2xl p-5 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 ${
                  task.state === 'complete'
                    ? 'bg-emerald-950/20 border-emerald-900/35 text-emerald-400'
                    : task.state === 'error' || task.state === 'cancelled'
                      ? 'bg-red-950/20 border-red-900/35 text-red-400'
                      : 'bg-violet-950/30 border-violet-900/40 text-violet-400'
                }`}>
                  {task.state === 'complete' ? <CheckCircle className="w-5 h-5" />
                    : task.state === 'error' || task.state === 'cancelled' ? <AlertCircle className="w-5 h-5" />
                    : task.state === 'uploading' ? <UploadCloud className="w-5 h-5 animate-pulse" />
                    : <SpinnerIcon className="w-4 h-4 animate-spin" />}
                </div>
                <div className="min-w-0 flex-1 flex flex-col">
                  <span className="text-sm font-bold text-white truncate">{task.displayName}</span>
                  <span className="text-[10px] text-zinc-500 font-mono mt-0.5">
                    {task.retrying ? `Retrying (attempt ${task.attempt})...` : (STATE_LABELS[task.state] || task.state)}
                    {task.state === 'uploading' && ` • ${formatBytes(task.uploadedBytes)} / ${formatBytes(task.size)} • ${formatBytes(task.speed)}/s • ETA ${task.eta !== null ? formatDuration(task.eta) : '—'}`}
                    {task.state === 'transcoding' && (
                      task.expectedSegments
                        ? ` • ${task.tsCreated || 0} / ${task.expectedSegments} segments (${Math.min(100, Math.round(((task.tsCreated || 0) / task.expectedSegments) * 100))}%) • ETA ${formatDuration(transcodeEta(task))}`
                        : ` • ${task.tsCreated || 0} segments created`
                    )}
                  </span>
                  {task.state === 'error' && task.error && (
                    <span className="text-[11px] text-red-400 mt-1 leading-snug">{task.error}</span>
                  )}
                </div>
                {task.state === 'uploading' ? (
                  <button
                    onClick={() => cancelUpload(task.id)}
                    className="px-3 py-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 text-[11px] font-semibold text-zinc-400 hover:text-white cursor-pointer transition-colors flex-shrink-0"
                  >
                    Cancel
                  </button>
                ) : ['complete', 'error', 'cancelled'].includes(task.state) && (
                  <button
                    onClick={() => dismissUpload(task.id)}
                    title="Dismiss"
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-900 cursor-pointer transition-colors flex-shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* progress bars */}
              {task.state === 'uploading' && (
                <div className="w-full h-2 bg-zinc-950 rounded-full overflow-hidden border border-zinc-900">
                  <div
                    className="h-full bg-gradient-to-r from-violet-600 to-indigo-600 rounded-full transition-[width] duration-200 ease-out"
                    style={{ width: `${task.progress}%` }}
                  />
                </div>
              )}
              {task.state === 'transcoding' && (
                <div className="w-full h-2 bg-zinc-950 rounded-full overflow-hidden border border-zinc-900">
                  {task.expectedSegments ? (
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-[width] duration-500 ease-out"
                      style={{ width: `${Math.min(100, Math.round(((task.tsCreated || 0) / task.expectedSegments) * 100))}%` }}
                    />
                  ) : (
                    <div className="h-full w-1/3 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full animate-pulse" />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Feature blurbs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-zinc-950/50 border border-zinc-900 flex items-start gap-3">
          <div className="p-2 bg-zinc-900 rounded-lg text-violet-400 flex-shrink-0 mt-0.5">
            <Layers className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-white">Local Library</span>
            <span className="text-[10px] text-zinc-500 mt-1 leading-relaxed">
              Videos stream straight to the videos/ folder on this machine. No cloud, no bills.
            </span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-zinc-950/50 border border-zinc-900 flex items-start gap-3">
          <div className="p-2 bg-zinc-900 rounded-lg text-violet-400 flex-shrink-0 mt-0.5">
            <Cpu className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-white">Local FFmpeg HLS</span>
            <span className="text-[10px] text-zinc-500 mt-1 leading-relaxed">
              Videos are chopped into 4-second .ts segments on this PC for smooth seeking. MKVs get browser-friendly audio.
            </span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-zinc-950/50 border border-zinc-900 flex items-start gap-3">
          <div className="p-2 bg-zinc-900 rounded-lg text-violet-400 flex-shrink-0 mt-0.5">
            <CheckCircle className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-white">Background Uploads</span>
            <span className="text-[10px] text-zinc-500 mt-1 leading-relaxed">
              Uploads keep running while you browse or watch — just don&apos;t close or reload the tab.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
