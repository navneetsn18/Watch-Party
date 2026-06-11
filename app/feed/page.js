'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { getFlagEmoji } from '../../components/NavBar';

export default function FeedPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadFeed() {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        router.push('/auth');
        return;
      }
      setUser(currentUser);

      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return;

      try {
        // Load profile info
        const profileRes = await fetch('/api/profile', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (profileRes.ok) {
          const currentProfile = await profileRes.json();
          setProfile(currentProfile);
        }

        // Fetch visible videos from Express API using auth header
        const res = await fetch('/api/videos', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const data = await res.json();
        setVideos(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Error fetching videos feed:', err);
      } finally {
        setLoading(false);
      }
    }

    loadFeed();
  }, [router]);

  function startWatchParty(videoKey) {
    const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const name = profile?.username || 'Host';
    router.push(`/room/${randomCode}?username=${encodeURIComponent(name)}&video=${encodeURIComponent(videoKey)}`);
  }

  async function handleDeleteVideo(videoKey) {
    const filename = videoKey.replace(/^videos\//, '');
    if (!confirm(`Are you sure you want to delete "${filename}"? This will permanently remove it.`)) return;

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return;

      const res = await fetch('/api/videos/' + encodeURIComponent(filename), {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete video');
      }

      setVideos(prev => prev.filter(v => v.key !== videoKey));
    } catch (err) {
      alert(err.message);
    }
  }

  if (loading) {
    return (
      <div className="feed-container">
        <div className="lobby-logo" style={{ textAlign: 'center', marginTop: '60px' }}>
          <div className="logo-icon">🏠</div>
          <h1>Feed</h1>
          <p>Loading your feed...</p>
          <div className="spinner" style={{ margin: '20px auto' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="feed-container">
      <div className="feed-header">
        <div className="feed-logo-box">
          <span className="feed-icon">🎬</span>
          <h2>Explore Feed</h2>
          <p>Discover public uploads and watch videos in real-time sync with friends</p>
        </div>
      </div>

      <div className="feed-content">
        {videos.length === 0 ? (
          <div className="feed-card" style={{ padding: '40px', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>📭</div>
            <h3>Your Feed is Empty</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px', maxWidth: '400px', margin: '10px auto' }}>
              No public videos have been uploaded yet. Upload a video yourself or search and add friends to see their shared clips here!
            </p>
            <button className="btn btn-primary" onClick={() => router.push('/')} style={{ marginTop: '15px' }}>
              📤 Upload Video
            </button>
          </div>
        ) : (
          <div className="feed-grid">
            {videos.map((video, idx) => (
              <div key={video.key || idx} className="feed-item-card">
                <div className="feed-item-preview">
                  <div className="feed-preview-overlay">
                    <button className="btn-play-pulse" onClick={() => startWatchParty(video.key)}>
                      ▶
                    </button>
                  </div>
                  <span className="feed-preview-icon">🎬</span>
                </div>

                <div className="feed-item-details">
                  <h3 className="feed-video-title">{video.name}</h3>
                  
                  <div className="feed-uploader-info">
                    {video.avatarUrl ? (
                      <img src={video.avatarUrl} alt="Avatar" className="feed-avatar" />
                    ) : (
                      <div className="feed-avatar-placeholder">
                        {video.uploaderName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="feed-uploader-text">
                      <span className="feed-username">
                        {video.uploaderName}
                        {video.isVerified && <span className="verified-badge" title="Verified Creator" style={{ color: '#3b82f6', marginLeft: '4px' }}>✔️</span>}
                        {video.country && ` ${getFlagEmoji(video.country)}`}
                      </span>
                      <span className="feed-privacy-tag">
                        {video.isPrivate ? '🔒 Friends' : '🌐 Public'}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', width: '100%', marginTop: '10px' }}>
                    <button
                      className="btn btn-primary start-party-btn"
                      onClick={() => startWatchParty(video.key)}
                      style={{ flex: 1 }}
                    >
                      ✨ Watch Together
                    </button>
                    {video.uploaderId === profile?.id && (
                      <button
                        className="btn btn-danger"
                        onClick={() => handleDeleteVideo(video.key)}
                        style={{
                          padding: '0 12px',
                          background: '#ef4444',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                        title="Delete Video"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
