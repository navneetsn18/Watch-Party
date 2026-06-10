'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

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
    <div className="guest-request-stack">
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
    <div className={`guest-request-card ${exiting ? 'exiting' : ''}`}>
      <div className="guest-request-header">
        <span className="request-user">{request.username}</span>
        <span>wants to</span>
        <span className="request-action">{actionLabel}</span>
      </div>
      <div className="guest-request-timer">
        <div
          className="guest-request-timer-fill"
          style={{ width: progress + '%' }}
        />
      </div>
      <div className="guest-request-actions">
        <button
          className="guest-request-btn approve"
          onClick={handleApprove}
        >
          ✓ Approve
        </button>
        <button
          className="guest-request-btn reject"
          onClick={handleReject}
        >
          ✗ Reject
        </button>
      </div>
    </div>
  );
}
