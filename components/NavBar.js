'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '../lib/supabase';
import { VerifiedBadge } from './VerifiedBadge';

// Helper to convert ISO country code to flag emoji
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

  // Monitor auth state changes
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

  // Do not show NavBar on auth page or inside a room page (which is full-screen and has its own TopBar)
  const isAuthPage = pathname === '/auth';
  const isRoomPage = pathname.startsWith('/room/');

  if (isAuthPage || isRoomPage) return null;

  return (
    <nav className="global-navbar">
      <div className="navbar-logo" onClick={() => router.push('/')}>
        🎬 Watch Party
      </div>

      <div className="navbar-links">
        <button
          className={`nav-link ${pathname === '/feed' ? 'active' : ''}`}
          onClick={() => router.push('/feed')}
        >
          🏠 Feed
        </button>
        <button
          className={`nav-link ${pathname === '/search' ? 'active' : ''}`}
          onClick={() => router.push('/search')}
        >
          🔍 Search
        </button>
        <button
          className={`nav-link ${pathname === '/' ? 'active' : ''}`}
          onClick={() => router.push('/')}
        >
          🎮 Lobby
        </button>
        <button
          className={`nav-link ${pathname === '/profile' ? 'active' : ''}`}
          onClick={() => router.push('/profile')}
        >
          👤 Profile
        </button>
      </div>

      <div className="navbar-actions">
        {/* Upload Button */}
        {user && (
          <button
            onClick={() => router.push('/upload')}
            className="btn btn-primary"
            style={{
              fontSize: '0.85rem',
              fontWeight: '700',
              padding: '8px 16px',
              borderRadius: 'var(--radius-sm)',
              marginRight: '12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              border: 'none',
              height: 'auto'
            }}
          >
            📤 Upload Video
          </button>
        )}

        {/* Buy Me a Coffee Button */}
        <a
          href="https://buymeacoffee.com/navneetsn18"
          target="_blank"
          rel="noopener noreferrer"
          className="coffee-btn"
        >
          ☕
        </a>

        {user && (
          <div className="navbar-user">
            <div className="nav-avatar-container">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="Avatar" className="nav-avatar" />
              ) : (
                <div className="nav-avatar-placeholder">
                  {(profile?.username || 'U').charAt(0).toUpperCase()}
                </div>
              )}
              
              {/* Tooltip on Hover */}
              <div className="nav-profile-tooltip">
                <div className="tooltip-item">
                  <strong>Username:</strong> {profile?.username || 'N/A'}
                  {profile?.is_verified && <VerifiedBadge size={14} />}
                </div>
                <div className="tooltip-item"><strong>Email:</strong> {user.email}</div>
                <div className="tooltip-item"><strong>DOB:</strong> {profile?.dob || 'Not set'}</div>
                <div className="tooltip-item"><strong>Country:</strong> {profile?.country ? `${profile.country} ${getFlagEmoji(profile.country)}` : 'Not set'}</div>
              </div>
            </div>

            <button className="btn btn-secondary nav-signout-btn btn-sm" onClick={handleSignOut}>
              🚪 Out
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
