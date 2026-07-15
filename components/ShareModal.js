'use client';

import { useState } from 'react';
import { X, Copy, Check, Link2 } from 'lucide-react';

export default function ShareModal({ roomId, isOpen, onClose }) {
  const [copied, setCopied] = useState(false);

  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/?room=${roomId}`
    : '';

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => triggerCopyFeedback())
        .catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      triggerCopyFeedback();
    } catch (e) {
      /* ignore */
    }
    document.body.removeChild(ta);
  }

  function triggerCopyFeedback() {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 select-none animate-fade-in"
      onClick={handleOverlayClick}
    >
      <div className="relative w-full max-w-sm bg-zinc-900 border border-zinc-800 p-6 rounded-2xl shadow-2xl flex flex-col gap-5 text-center">
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute right-4 top-4 p-1 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
        >
          <X className="w-[18px] h-[18px]" />
        </button>

        <h3 className="text-base font-bold text-white flex items-center justify-center gap-1.5 mt-2">
          <Link2 className="w-4 h-4 text-violet-400" />
          <span>Invite someone</span>
        </h3>

        {/* Room Code Codebox */}
        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-900 flex flex-col gap-1 items-center">
          <span className="text-[10px] uppercase font-black tracking-wider text-zinc-500">Room Code</span>
          <span className="text-xl font-mono font-black text-violet-400 tracking-widest uppercase">{roomId || '------'}</span>
        </div>

        {/* Share Link Row */}
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={shareUrl}
            className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-900 focus:outline-none rounded-xl text-xs text-zinc-300 font-mono select-all truncate"
          />
          <button 
            onClick={() => copyText(shareUrl)}
            className="p-2.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-white cursor-pointer active:scale-95 transition-all"
            title="Copy Invite Link"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>

        <button 
          onClick={() => copyText(shareUrl)}
          className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-600 active:scale-97 text-white font-semibold text-xs transition-all shadow-lg shadow-violet-950/25 cursor-pointer"
        >
          Copy Invite URL
        </button>

        <span className="text-[10px] text-zinc-500 leading-relaxed max-w-[240px] mx-auto">
          Share the invite code or direct link with friends. They will join your session automatically.
        </span>
      </div>
    </div>
  );
}
