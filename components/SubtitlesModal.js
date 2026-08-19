'use client';

import { useState, useEffect } from 'react';
import { X, Captions, Trash2, UploadCloud, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function SubtitlesModal({ video, onClose }) {
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [language, setLanguage] = useState('en');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!video) return;
    fetch(`/api/videos/${video.id}/subtitles`)
      .then(res => res.json())
      .then(data => setSubs(Array.isArray(data) ? data : []))
      .catch(() => setSubs([]))
      .finally(() => setLoading(false));
  }, [video]);

  if (!video) return null;

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  async function handleFilePick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.(vtt|srt)$/i.test(file.name)) {
      setError('Use a .vtt or .srt file');
      return;
    }
    setError('');
    setUploading(true);
    try {
      const content = await file.text();
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const res = await fetch(`/api/videos/${video.id}/subtitles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          label: label.trim() || file.name.replace(/\.[^/.]+$/, ''),
          language: language.trim() || 'en',
          filename: file.name,
          content,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setSubs(prev => [...prev, data]);
      setLabel('');
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(subId) {
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const res = await fetch(`/api/videos/${video.id}/subtitles/${subId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to delete');
      setSubs(prev => prev.filter(s => s.id !== subId));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 select-none animate-fade-in"
      onClick={handleOverlayClick}
    >
      <div className="relative w-full max-w-sm bg-zinc-900 border border-zinc-800 p-6 rounded-2xl shadow-2xl flex flex-col gap-5">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-1 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
        >
          <X className="w-[18px] h-[18px]" />
        </button>

        <h3 className="text-base font-bold text-white flex items-center gap-1.5 mt-2">
          <Captions className="w-4 h-4 text-violet-400" />
          <span className="truncate">Subtitles — {video.display_name}</span>
        </h3>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {subs.length === 0 ? (
              <div className="text-center py-4 text-zinc-500 text-xs bg-zinc-950/40 border border-zinc-900 rounded-xl">
                No subtitles yet.
              </div>
            ) : (
              subs.map(s => (
                <div key={s.id} className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-zinc-900">
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-semibold text-zinc-200 truncate">{s.label}</span>
                    <span className="text-[10px] text-zinc-500 font-mono uppercase">{s.language}</span>
                  </div>
                  <button
                    onClick={() => handleDelete(s.id)}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-950/20 cursor-pointer transition-colors flex-shrink-0"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 pt-3 border-t border-zinc-800">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Label (e.g. English)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="flex-1 px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs focus:outline-none focus:border-violet-600"
            />
            <input
              type="text"
              placeholder="en"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              maxLength={10}
              className="w-16 px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs focus:outline-none focus:border-violet-600"
            />
          </div>

          {error && <span className="text-[11px] text-red-400">{error}</span>}

          <label className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-violet-900/20">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            <span>{uploading ? 'Uploading...' : 'Add .vtt / .srt file'}</span>
            <input type="file" accept=".vtt,.srt" onChange={handleFilePick} className="hidden" disabled={uploading} />
          </label>
        </div>
      </div>
    </div>
  );
}
