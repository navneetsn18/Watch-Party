'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Home, Compass, Search, User, Upload, Coffee, LogOut, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { VerifiedBadge } from './VerifiedBadge';

export function getFlagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return '';
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

export default function NavBar() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [hoveredTab, setHoveredTab] = useState(null);

  // Monitor auth state
  useEffect(() => {
    async function loadSession() {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user || null);
      if (session?.user) {
        loadProfile();
      }
    }

    loadSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
      if (session?.user) {
        loadProfile();
      } else {
        setProfile(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function loadProfile() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;

      const res = await fetch('/api/profile', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
      }
    } catch (err) {
      console.error('Failed to load profile in NavBar:', err);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/auth');
  }

  const isAuthPage = pathname === '/auth';
  const isRoomPage = pathname.startsWith('/room/');

  if (isAuthPage || isRoomPage) return null;

  const tabs = [
    { id: '/feed', name: 'Feed', icon: Compass },
    { id: '/search', name: 'Search', icon: Search },
    { id: '/', name: 'Lobby', icon: Home },
    { id: '/profile', name: 'Profile', icon: User },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-800/40 bg-zinc-950/70 backdrop-blur-md px-6 py-3 flex items-center justify-between">
      {/* Logo */}
      <div 
        className="flex items-center gap-2 cursor-pointer text-xl font-extrabold tracking-tight text-white hover:opacity-90 transition-opacity"
        onClick={() => router.push('/')}
      >
        <span className="bg-gradient-to-r from-violet-400 to-fuchsia-500 bg-clip-text text-transparent">🎬 Watch Party</span>
      </div>

      {/* Tabs */}
      <nav className="hidden md:flex items-center gap-1 relative">
        {tabs.map((tab) => {
          const isActive = pathname === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => router.push(tab.id)}
              onMouseEnter={() => setHoveredTab(tab.id)}
              onMouseLeave={() => setHoveredTab(null)}
              className={`relative px-4 py-2 text-sm font-medium rounded-full transition-colors duration-250 flex items-center gap-2 ${
                isActive ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.name}</span>
              
              {isActive && (
                <motion.div
                  layoutId="active-nav-tab"
                  className="absolute inset-0 bg-zinc-800/60 rounded-full -z-10"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Actions */}
      <div className="flex items-center gap-4">
        {/* Upload Button */}
        {user && (
          <button
            onClick={() => router.push('/upload')}
            className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-900/20 hover:shadow-violet-900/40 active:scale-95 transition-all duration-150 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload</span>
          </button>
        )}

        {/* Buy Me a Coffee */}
        <a
          href="https://buymeacoffee.com/navneetsn18"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer"
          title="Buy Me a Coffee"
        >
          <Coffee className="w-4 h-4" />
        </a>

        {/* Profile Avatar & Sign Out */}
        {user && (
          <div className="flex items-center gap-3">
            {/* Avatar Container with Tooltip */}
            <div className="group relative cursor-pointer">
              {profile?.avatar_url ? (
                <img 
                  src={profile.avatar_url} 
                  alt="Avatar" 
                  className="w-8 h-8 rounded-full border border-zinc-700/60 object-cover" 
                />
              ) : (
                <div className="w-8 h-8 rounded-full border border-zinc-700/60 bg-zinc-800 flex items-center justify-center text-sm font-semibold text-zinc-200">
                  {(profile?.username || 'U').charAt(0).toUpperCase()}
                </div>
              )}
              
              {/* Dropdown/Tooltip on Hover */}
              <div className="absolute right-0 top-full mt-2 w-64 p-4 rounded-2xl bg-zinc-900/95 border border-zinc-800/80 shadow-2xl backdrop-blur-md opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto transition-all duration-200 z-[60] flex flex-col gap-2">
                <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/60">
                  <span className="font-bold text-white text-sm truncate flex items-center gap-1.5">
                    {profile?.username || 'user'}
                    {profile?.is_verified && <ShieldCheck className="w-4 h-4 text-violet-400 fill-violet-400/20" />}
                  </span>
                  {profile?.country && (
                    <span className="text-sm">{getFlagEmoji(profile.country)}</span>
                  )}
                </div>
                <div className="text-xs text-zinc-400 truncate">
                  <span className="font-medium text-zinc-500">Email: </span>
                  {user.email}
                </div>
                {profile?.dob && (
                  <div className="text-xs text-zinc-400">
                    <span className="font-medium text-zinc-500">DOB: </span>
                    {profile.dob}
                  </div>
                )}
                <div className="text-xs text-zinc-400">
                  <span className="font-medium text-zinc-500">Scope: </span>
                  {profile?.is_private ? '🔒 Private' : '🌐 Public'}
                </div>
              </div>
            </div>

            {/* Logout button */}
            <button 
              onClick={handleSignOut} 
              className="flex items-center justify-center p-2 rounded-full hover:bg-zinc-900 border border-transparent hover:border-zinc-800 text-zinc-400 hover:text-red-400 transition-colors duration-150 cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
