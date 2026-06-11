'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { generateRoomId } from '../lib/utils';
import { supabase } from '../lib/supabase';

function LobbyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [customCodeStatus, setCustomCodeStatus] = useState(null); // null | 'checking' | 'available' | 'taken' | 'invalid'
  const inviteRoom = searchParams.get('room');
  const checkTimerRef = useRef(null);

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Check auth
  useEffect(() => {
    async function checkAuth() {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        router.push('/auth');
        return;
      }
      setUser(currentUser);
      setUsername(currentUser.username || 'user');
      setLoading(false);
    }
    checkAuth();
  }, [router]);

  useEffect(() => {
    if (!loading) {
      const input = document.getElementById('custom-code-input');
      if (input) input.focus();
    }
  }, [loading]);

  // Check custom code availability with debounce
  useEffect(() => {
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);

    const code = customCode.trim().toUpperCase();
    if (!code) {
      setCustomCodeStatus(null);
      return;
    }

    if (code.length < 3) {
      setCustomCodeStatus('invalid');
      return;
    }

    if (!/^[A-Z0-9]+$/.test(code)) {
      setCustomCodeStatus('invalid');
      return;
    }

    setCustomCodeStatus('checking');
    checkTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/check-room/${encodeURIComponent(code)}`);
        const data = await res.json();
        if (data.available) {
          setCustomCodeStatus('available');
        } else {
          setCustomCodeStatus('taken');
        }
      } catch (err) {
        setCustomCodeStatus(null);
      }
    }, 400);

    return () => clearTimeout(checkTimerRef.current);
  }, [customCode]);

  function createRoom() {
    const name = username.trim() || 'Host';
    const code = customCode.trim().toUpperCase();
    // Use custom code if provided and available, otherwise generate
    let id;
    if (code && code.length >= 3 && /^[A-Z0-9]+$/.test(code) && customCodeStatus === 'available') {
      id = code;
    } else if (code && customCodeStatus !== 'available') {
      // If custom code entered but not available, don't proceed
      return;
    } else {
      id = generateRoomId();
    }
    router.push(`/room/${id}?username=${encodeURIComponent(name)}`);
  }

  function joinRoom() {
    const name = username.trim() || 'Guest';
    const code = roomCode.trim().toUpperCase();
    if (!code) return;
    router.push(`/room/${code}?username=${encodeURIComponent(name)}`);
  }

  function joinFromInvite() {
    const name = username.trim() || 'Guest';
    if (!inviteRoom) return;
    router.push(`/room/${inviteRoom.toUpperCase()}?username=${encodeURIComponent(name)}`);
  }

  function handleKeyDown(e, action) {
    if (e.key === 'Enter') {
      e.preventDefault();
      action();
    }
  }

  if (loading) {
    return (
      <div className="lobby-container">
        <div className="lobby-logo">
          <div className="logo-icon">🎬</div>
          <h1>Watch Party</h1>
          <p>Securing session...</p>
          <div className="spinner" style={{ margin: '20px auto' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="lobby-container">
      <div className="lobby-logo">
        <div className="logo-icon">🎬</div>
        <h1>Watch Party</h1>
        <p>Sync up and enjoy movies together in perfect harmony</p>
      </div>

      <div className="lobby-card">
        {inviteRoom ? (
          /* Guest invite flow */
          <div className="lobby-section">
            <div className="invite-banner">
              You&apos;ve been invited to room <strong>{inviteRoom.toUpperCase()}</strong>
            </div>
            <button className="btn btn-primary" onClick={joinFromInvite} style={{ marginTop: '12px', width: '100%' }}>
              Join room →
            </button>
          </div>
        ) : (
          /* Host or manual join flow */
          <>
            {/* Create Room Section */}
            <div className="lobby-section">
              <h3 className="lobby-section-title">Create Watch Party</h3>
              <div className="input-group custom-code-group">
                <label className="input-label">Custom room code (optional)</label>
                <input
                  id="custom-code-input"
                  type="text"
                  className="input-field"
                  placeholder="e.g. MOVIE-NIGHT"
                  maxLength={12}
                  value={customCode}
                  onChange={(e) => setCustomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                  onKeyDown={(e) => handleKeyDown(e, createRoom)}
                  style={{ textTransform: 'uppercase', letterSpacing: '1px' }}
                />
                {customCodeStatus && (
                  <div className={`code-availability ${customCodeStatus}`}>
                    <span className="code-availability-dot" />
                    {customCodeStatus === 'checking' && 'Checking availability…'}
                    {customCodeStatus === 'available' && 'Code is available!'}
                    {customCodeStatus === 'taken' && 'Code is already in use'}
                    {customCodeStatus === 'invalid' && 'Min 3 alphanumeric characters'}
                  </div>
                )}
              </div>

              <button
                className="btn btn-primary"
                onClick={createRoom}
                disabled={customCode.trim() && customCodeStatus !== 'available'}
                style={{
                  marginTop: '10px',
                  width: '100%',
                  opacity: (customCode.trim() && customCodeStatus !== 'available') ? 0.5 : 1,
                  pointerEvents: (customCode.trim() && customCodeStatus !== 'available') ? 'none' : 'auto',
                }}
              >
                ✨ Create a room
              </button>
            </div>

            <div className="divider">or</div>

            {/* Join Room Section */}
            <div className="lobby-section">
              <h3 className="lobby-section-title">Join Existing Party</h3>
              <div className="input-group">
                <label className="input-label">Room code</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. ABC123"
                  maxLength={12}
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => handleKeyDown(e, joinRoom)}
                  style={{ textTransform: 'uppercase' }}
                />
              </div>

              <button className="btn btn-secondary" onClick={joinRoom} style={{ marginTop: '10px', width: '100%' }}>
                Join room →
              </button>
            </div>
          </>
        )}
      </div>

      <button className="btn btn-upload-lobby" onClick={() => router.push('/upload')}>
        📤 Upload a Video
      </button>
    </div>
  );
}

export default function LobbyPage() {
  return (
    <Suspense fallback={<div className="lobby-container"><div className="lobby-logo"><div className="logo-icon">🎬</div><h1>Watch Party</h1><p>Loading…</p></div></div>}>
      <LobbyContent />
    </Suspense>
  );
}
