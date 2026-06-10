'use client';

import { useState, useRef, useEffect } from 'react';

export default function ShareModal({ roomId, isOpen, onClose }) {
  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/?room=${roomId}`
    : '';

  function copyText(text, successMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
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
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  if (!isOpen) return null;

  return (
    <div className="modal-overlay open" onClick={handleOverlayClick}>
      <div className="modal-card">
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2>🔗 Invite someone</h2>

        <div className="share-code-box">
          <div className="share-code-label">Room Code</div>
          <div className="share-code-value">{roomId || '------'}</div>
        </div>

        <div className="share-link-row">
          <input
            className="share-link-input"
            readOnly
            value={shareUrl}
          />
          <button className="btn-icon" onClick={() => copyText(shareUrl)}>
            📋 Copy
          </button>
        </div>

        <button className="btn btn-primary" onClick={() => copyText(shareUrl)}>
          Copy invite link
        </button>

        <div className="share-hint">
          Share the code or link — they&apos;ll join your room instantly.
        </div>
      </div>
    </div>
  );
}
