'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Users, Settings, Lock, Share2, User, Power, Play, Tv } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function TopBar({
  roomId,
  userCount,
  watchers = [],
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
    <div className="w-full bg-zinc-950 border-b border-zinc-900 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 select-none">
      {/* Left side */}
      <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
        <div 
          className="flex items-center gap-1.5 cursor-pointer font-black text-lg bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent"
          onClick={() => router.push('/')}
        >
          🎬 Watch Party
        </div>
        
        <div className="flex items-center gap-2">
          <span
            className="px-3 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-300 hover:text-white hover:border-zinc-700 cursor-pointer transition-all duration-150 active:scale-95 select-all"
            onClick={onCopyRoomId}
            title="Click to copy room code"
          >
            Room: {roomId || '------'}
          </span>
          <button 
            onClick={() => router.push('/')} 
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-red-950/20 border border-red-900/30 hover:bg-red-950/40 text-red-400 cursor-pointer transition-colors duration-150"
            title="Exit Room"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Exit</span>
          </button>
        </div>
      </div>

      {/* Center - current video title */}
      {videoName ? (
        <div className="flex items-center gap-2 max-w-full sm:max-w-[40%] text-zinc-200">
          <Tv className="w-4 h-4 text-violet-400 flex-shrink-0 animate-pulse-slow" />
          <h2 className="text-sm font-semibold truncate" title={videoName}>
            {videoName.replace(/^videos\//, '')}
          </h2>
        </div>
      ) : (
        <div className="hidden sm:block w-px h-1" />
      )}

      {/* Right side */}
      <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
        {/* Toggle guest controls (Host only) */}
        {isHost && (
          <button
            onClick={onToggleGuestControls}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-all duration-150 ${
              guestControls
                ? 'bg-violet-950/20 border-violet-800/40 text-violet-400 hover:bg-violet-950/40'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800'
            }`}
            title={guestControls ? 'Guests CAN control playback' : 'Only host controls playback'}
          >
            {guestControls ? <Settings className="w-3.5 h-3.5 animate-spin-slow" /> : <Lock className="w-3.5 h-3.5" />}
            <span>{guestControls ? 'Guest Controls: On' : 'Guest Controls: Off'}</span>
            <div className={`w-6 h-3 rounded-full relative p-0.5 transition-colors duration-200 ${guestControls ? 'bg-violet-500' : 'bg-zinc-700'}`}>
              <div className={`w-2 h-2 rounded-full bg-white transition-transform duration-200 ${guestControls ? 'translate-x-3' : 'translate-x-0'}`} />
            </div>
          </button>
        )}

        {/* Viewers badge — hover shows who's watching */}
        <div className="relative group">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-medium text-zinc-300 cursor-default">
            <Users className="w-3.5 h-3.5 text-zinc-400" />
            <span>{userCount}</span>
          </div>
          {watchers.length > 0 && (
            <div className="absolute right-0 top-full mt-2 w-52 py-2 rounded-xl bg-zinc-950 border border-zinc-800 shadow-2xl z-[80] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 pointer-events-none">
              <div className="px-3 pb-1.5 mb-1 border-b border-zinc-900 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Watching now ({watchers.length})
              </div>
              {watchers.map(w => (
                <div key={w.id} className="px-3 py-1.5 flex items-center gap-2 text-xs text-zinc-300">
                  {w.avatarUrl ? (
                    <img src={w.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover border border-zinc-800" />
                  ) : (
                    <span className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center text-[9px] font-bold text-zinc-400 uppercase">
                      {(w.username || '?').charAt(0)}
                    </span>
                  )}
                  <span className="truncate">{w.username}</span>
                  {w.isHost && <span className="ml-auto text-[9px] text-amber-400 font-bold flex-shrink-0">👑 HOST</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Role badge */}
        <div className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
          isHost 
            ? 'bg-amber-950/20 border-amber-900/30 text-amber-400' 
            : 'bg-blue-950/20 border-blue-900/30 text-blue-400'
        }`}>
          {isHost ? '👑 Host' : '👁 Guest'}
        </div>

        {/* Share Button */}
        <button 
          onClick={onShareClick} 
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-900/20 transition-all cursor-pointer"
        >
          <Share2 className="w-3.5 h-3.5" />
          <span>Share</span>
        </button>

        {user && (
          <div className="flex items-center gap-1.5 border-l border-zinc-800 pl-3">
            <button 
              onClick={() => router.push('/profile')} 
              className="p-1.5 rounded-lg hover:bg-zinc-900 border border-transparent hover:border-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer" 
              title="Go to Profile"
            >
              <User className="w-4 h-4" />
            </button>
            <button 
              onClick={handleSignOut} 
              className="p-1.5 rounded-lg hover:bg-zinc-900 border border-transparent hover:border-zinc-800 text-zinc-400 hover:text-red-400 transition-colors cursor-pointer" 
              title="Sign Out"
            >
              <Power className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
