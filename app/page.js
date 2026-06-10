'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { generateRoomId } from '../lib/utils';

function LobbyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const inviteRoom = searchParams.get('room');

  useEffect(() => {
    // Auto-focus the username input
    const input = document.getElementById('username-input');
    if (input) input.focus();
  }, []);

  function createRoom() {
    const name = username.trim() || 'Host';
    const id = generateRoomId();
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

  return (
    <div className="lobby-container">
      <div className="lobby-logo">
        <div className="logo-icon">🎬</div>
        <h1>Watch Party</h1>
        <p>Sync up and enjoy movies together in perfect harmony</p>
      </div>

      <div className="lobby-card">
        <div className="input-group">
          <label className="input-label">Your name</label>
          <input
            id="username-input"
            type="text"
            className="input-field"
            placeholder="e.g. Rahul"
            maxLength={20}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, inviteRoom ? joinFromInvite : createRoom)}
          />
        </div>

        {inviteRoom ? (
          /* Guest invite flow */
          <>
            <div className="invite-banner">
              You&apos;ve been invited to room <strong>{inviteRoom.toUpperCase()}</strong>
            </div>
            <button className="btn btn-primary" onClick={joinFromInvite}>
              Join room →
            </button>
          </>
        ) : (
          /* Host or manual join flow */
          <>
            <button className="btn btn-primary" onClick={createRoom}>
              ✨ Create a room
            </button>

            <div className="divider">or join existing</div>

            <div className="input-group">
              <label className="input-label">Room code</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. ABC123"
                maxLength={8}
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => handleKeyDown(e, joinRoom)}
                style={{ textTransform: 'uppercase' }}
              />
            </div>

            <button className="btn btn-secondary" onClick={joinRoom}>
              Join room →
            </button>
          </>
        )}
      </div>
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
