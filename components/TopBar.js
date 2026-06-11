'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';

export default function TopBar({
  roomId,
  userCount,
  isHost,
  guestControls,
  videoName,
  onToggleGuestControls,
  onShareClick,
  onCopyRoomId,
}) {
  const router = useRouter();
  const [user, setUser] = useState(null);

  useEffect(() => {
    async function fetchUser() {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    }
    fetchUser();
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/auth');
  }

  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="topbar-logo" onClick={() => router.push('/')} style={{ cursor: 'pointer' }}>
          🎬 Watch Party
        </div>
        <span
          className="room-code"
          onClick={onCopyRoomId}
          title="Click to copy room code"
        >
          Room: {roomId || '------'}
        </span>
        <button className="btn-icon" onClick={() => router.push('/')} title="Exit Room">
          🚪 Exit
        </button>
      </div>

      {/* Center — video name */}
      {videoName ? (
        <h2 className="topbar-video-name" title={videoName}>
          ▶ {videoName}
        </h2>
      ) : (
        <div />
      )}

      <div className="topbar-right">
        {/* Guest controls toggle — host only */}
        {isHost && (
          <div
            className="guest-controls-toggle"
            onClick={onToggleGuestControls}
            title={guestControls ? 'Guests CAN control playback' : 'Only host controls playback'}
          >
            <span>{guestControls ? '🎮' : '🔒'} Guest Controls</span>
            <div className={`toggle-switch ${guestControls ? 'active' : ''}`} />
          </div>
        )}

        <div className="badge">
          <span className="badge-dot" />
          <span>{userCount}</span> watching
        </div>

        <div className={`badge ${isHost ? 'badge-host' : 'badge-guest'}`}>
          {isHost ? '👑 Host' : '👁 Guest'}
        </div>

        <button className="btn-icon" onClick={onShareClick}>
          🔗 Share
        </button>

        {user && (
          <>
            <button className="btn-icon" onClick={() => router.push('/profile')} title="Go to Profile">
              👤 Profile
            </button>
            <button className="btn-icon" onClick={handleSignOut} title="Sign Out">
              🚪 Out
            </button>
          </>
        )}
      </div>
    </div>
  );
}

