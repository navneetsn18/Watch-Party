'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Tv, Sparkles, LogIn, CheckCircle2, XCircle, AlertCircle, Loader2 } from 'lucide-react';
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
    let id;
    if (code && code.length >= 3 && /^[A-Z0-9]+$/.test(code) && customCodeStatus === 'available') {
      id = code;
    } else if (code && customCodeStatus !== 'available') {
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
      <div className="min-height-[90vh] w-full flex items-center justify-center bg-[#07070a] px-4 relative overflow-hidden">
        {/* Glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full bg-violet-600/10 blur-3xl" />
        
        <div className="text-center relative z-10 flex flex-col items-center">
          <div className="w-16 h-16 rounded-3xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-6 shadow-xl shadow-zinc-950/40">
            <Tv className="w-8 h-8 text-violet-400 animate-pulse" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white mb-2">Watch Party</h1>
          <p className="text-zinc-400 text-sm mb-4">Securing your session...</p>
          <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[85vh] w-full flex flex-col items-center justify-center bg-[#07070a] px-4 py-12 relative overflow-hidden">
      {/* Background Ambience */}
      <div className="absolute top-1/3 left-1/4 w-[400px] h-[400px] rounded-full bg-violet-900/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/3 right-1/4 w-[400px] h-[400px] rounded-full bg-indigo-900/10 blur-[120px] pointer-events-none" />

      {/* Main Brand Intro */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center mb-10 relative z-10 max-w-md"
      >
        <div className="inline-flex p-3 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 mb-4 shadow-xl shadow-zinc-950/50">
          <Tv className="w-7 h-7 text-violet-400" />
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight text-white mb-3">
          Watch Party
        </h1>
        <p className="text-sm text-zinc-400 leading-relaxed px-4">
          Synchronize video playback and chat in real-time. Invite your friends, share the link, and enjoy movie night together.
        </p>
      </motion.div>

      {/* Lobby Form Card */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, delay: 0.15 }}
        className="relative z-10 w-full max-w-md bg-zinc-900/50 border border-zinc-800/60 backdrop-blur-xl p-8 rounded-3xl shadow-2xl shadow-black/80 flex flex-col gap-6"
      >
        {inviteRoom ? (
          /* Guest Invite Flow */
          <div className="flex flex-col gap-4">
            <div className="p-4 rounded-xl bg-violet-950/20 border border-violet-900/40 text-sm text-center text-zinc-200">
              You&apos;ve been invited to join room <strong className="text-violet-300 font-mono tracking-wider">{inviteRoom.toUpperCase()}</strong>
            </div>
            
            <button 
              onClick={joinFromInvite}
              className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 active:scale-[0.98] text-white font-semibold text-sm transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-violet-900/20"
            >
              <span>Join Room</span>
              <LogIn className="w-4 h-4" />
            </button>
          </div>
        ) : (
          /* Custom Create / Join Flow */
          <>
            {/* Create Watch Party Section */}
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-400" />
                <span>Create Watch Party</span>
              </h2>
              
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-zinc-400">Custom Room Code (Optional)</label>
                <div className="relative">
                  <input
                    id="custom-code-input"
                    type="text"
                    className="w-full px-4 py-3 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-violet-600 focus:ring-1 focus:ring-violet-600 text-sm font-mono tracking-widest uppercase transition-all duration-150"
                    placeholder="e.g. MOVIE-NIGHT"
                    maxLength={12}
                    value={customCode}
                    onChange={(e) => setCustomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                    onKeyDown={(e) => handleKeyDown(e, createRoom)}
                  />
                </div>

                {/* Validation Response status */}
                {customCodeStatus && (
                  <div className="flex items-center gap-1.5 mt-1 text-xs transition-opacity duration-150">
                    {customCodeStatus === 'checking' && (
                      <span className="text-zinc-500 flex items-center gap-1">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking availability...
                      </span>
                    )}
                    {customCodeStatus === 'available' && (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Room code is available!
                      </span>
                    )}
                    {customCodeStatus === 'taken' && (
                      <span className="text-rose-400 flex items-center gap-1">
                        <XCircle className="w-3.5 h-3.5" /> Code is already in use
                      </span>
                    )}
                    {customCodeStatus === 'invalid' && (
                      <span className="text-amber-400 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" /> Min 3 alphanumeric characters
                      </span>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={createRoom}
                disabled={customCode.trim() && customCodeStatus !== 'available'}
                className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-600 text-white font-semibold text-sm transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-violet-950/20 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
              >
                <span>Create a room</span>
              </button>
            </div>

            {/* Divider */}
            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-zinc-800/80"></div>
              <span className="flex-shrink mx-4 text-zinc-500 text-xs font-semibold uppercase tracking-wider">or</span>
              <div className="flex-grow border-t border-zinc-800/80"></div>
            </div>

            {/* Join Existing Section */}
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <LogIn className="w-4 h-4 text-indigo-400" />
                <span>Join Existing Party</span>
              </h2>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-zinc-400">Room Code</label>
                <input
                  type="text"
                  className="w-full px-4 py-3 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-650 focus:ring-1 focus:ring-indigo-650 text-sm font-mono tracking-widest uppercase transition-all duration-150"
                  placeholder="e.g. ABC123"
                  maxLength={12}
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => handleKeyDown(e, joinRoom)}
                />
              </div>

              <button
                onClick={joinRoom}
                className="w-full py-3 rounded-xl bg-zinc-800 hover:bg-zinc-750 text-white font-semibold text-sm transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer border border-zinc-700/40 active:scale-[0.98]"
              >
                <span>Join room</span>
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

export default function LobbyPage() {
  return (
    <Suspense 
      fallback={
        <div className="min-h-[90vh] w-full flex items-center justify-center bg-[#07070a]">
          <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
        </div>
      }
    >
      <LobbyContent />
    </Suspense>
  );
}
