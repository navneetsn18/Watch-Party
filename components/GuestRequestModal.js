'use client';

import { useState, useEffect, useRef } from 'react';
import { Check, X, ShieldAlert } from 'lucide-react';

const ACTION_LABELS = {
  'play': '▶ Play',
  'pause': '⏸ Pause',
  'seek-forward': '⏩ Skip Forward',
  'seek-backward': '⏪ Skip Backward',
};

const AUTO_REJECT_MS = 10000;

export default function GuestRequestModal({ requests, onApprove, onReject }) {
  if (!requests || requests.length === 0) return null;

  return (
    <div className="fixed bottom-24 right-6 z-50 flex flex-col gap-2 w-72 pointer-events-auto">
      {requests.map((req) => (
        <RequestCard
          key={req.id}
          request={req}
          onApprove={() => onApprove(req)}
          onReject={() => onReject(req)}
        />
      ))}
    </div>
  );
}

function RequestCard({ request, onApprove, onReject }) {
  const [elapsed, setElapsed] = useState(0);
  const [exiting, setExiting] = useState(false);
  const intervalRef = useRef(null);
  const autoRejectRef = useRef(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setElapsed((prev) => prev + 100);
    }, 100);

    autoRejectRef.current = setTimeout(() => {
      handleReject();
    }, AUTO_REJECT_MS);

    return () => {
      clearInterval(intervalRef.current);
      clearTimeout(autoRejectRef.current);
    };
  }, []);

  function handleApprove() {
    clearTimeout(autoRejectRef.current);
    clearInterval(intervalRef.current);
    setExiting(true);
    setTimeout(() => onApprove(), 280);
  }

  function handleReject() {
    clearTimeout(autoRejectRef.current);
    clearInterval(intervalRef.current);
    setExiting(true);
    setTimeout(() => onReject(), 280);
  }

  const progress = Math.max(0, 100 - (elapsed / AUTO_REJECT_MS) * 100);
  const actionLabel = ACTION_LABELS[request.action] || request.action;

  return (
    <div className={`p-4 rounded-2xl bg-zinc-950/95 border border-zinc-800 shadow-2xl flex flex-col gap-3 transition-all duration-300 ${
      exiting ? 'opacity-0 translate-y-3 scale-95' : 'opacity-100 translate-y-0 scale-100 animate-slide-in'
    }`}>
      {/* Header */}
      <div className="flex gap-2.5 items-start">
        <ShieldAlert className="w-[18px] h-[18px] text-violet-400 flex-shrink-0 mt-0.5" />
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-bold text-white truncate">{request.username}</span>
          <span className="text-[10px] text-zinc-400 mt-0.5">
            wants to: <strong className="text-violet-300 font-bold uppercase tracking-wider">{actionLabel}</strong>
          </span>
        </div>
      </div>

      {/* Progress timer */}
      <div className="w-full h-1 bg-zinc-900 rounded-full overflow-hidden">
        <div 
          className="h-full bg-violet-600 transition-all duration-100 ease-linear"
          style={{ width: progress + '%' }}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 mt-1">
        <button
          onClick={handleApprove}
          className="flex-1 py-1.5 rounded-lg bg-emerald-650 hover:bg-emerald-600 text-white text-[11px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer active:scale-95 shadow-md shadow-emerald-950/20"
        >
          <Check className="w-3 h-3" />
          <span>Approve</span>
        </button>
        <button
          onClick={handleReject}
          className="flex-1 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-red-400 text-[11px] font-semibold transition-all flex items-center justify-center gap-1 cursor-pointer"
        >
          <X className="w-3 h-3" />
          <span>Reject</span>
        </button>
      </div>
    </div>
  );
}
