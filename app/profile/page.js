'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { getFlagEmoji } from '../../components/NavBar';
import { VerifiedBadge } from '../../components/VerifiedBadge';

const COUNTRIES = [
  { code: 'IN', name: 'India' },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'JP', name: 'Japan' },
  { code: 'BR', name: 'Brazil' },
  { code: 'SG', name: 'Singapore' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'RU', name: 'Russia' },
  { code: 'CN', name: 'China' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'MX', name: 'Mexico' },
];

// Preset avatars removed to support custom user photo uploads.

export default function ProfilePage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('edit'); // edit | friends | videos
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  
  // Edit forms
  const [username, setUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [dob, setDob] = useState('');
  const [country, setCountry] = useState('IN');
  const [isPrivate, setIsPrivate] = useState(false);

  // Lists
  const [friends, setFriends] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [myVideos, setMyVideos] = useState([]);
  
  const [loading, setLoading] = useState(true);
  const [saveLoading, setSaveLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    async function loadData() {
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
        // Load profile
        const profileRes = await fetch('/api/profile', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (profileRes.ok) {
          const currentProfile = await profileRes.json();
          setProfile(currentProfile);
          setUsername(currentProfile.username);
          setAvatarUrl(currentProfile.avatar_url || '');
          setDob(currentProfile.dob || '');
          setCountry(currentProfile.country || 'IN');
          setIsPrivate(currentProfile.is_private || false);
        }

        // Load friends
        const friendsRes = await fetch('/api/friends/list', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (friendsRes.ok) {
          const friendships = await friendsRes.json();
          const acceptedFriends = [];
          const pendingRequests = [];

          friendships.forEach(f => {
            if (f.status === 'accepted') {
              const friendObj = f.sender_id === currentUser.id ? f.receiver : f.sender;
              acceptedFriends.push({ friendshipId: f.id, ...friendObj });
            } else if (f.status === 'pending' && f.receiver_id === currentUser.id) {
              pendingRequests.push({ friendshipId: f.id, ...f.sender });
            }
          });

          setFriends(acceptedFriends);
          setFriendRequests(pendingRequests);
        }

        // Load my uploaded videos from database
        const videosRes = await fetch('/api/videos', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (videosRes.ok) {
          const dbVideos = await videosRes.json();
          setMyVideos(dbVideos.filter(v => v.uploaderId === currentUser.id).map(v => ({
            id: v.id || v.key.replace(/^videos\//, ''),
            filename: v.filename || v.key.replace(/^videos\//, ''),
            display_name: v.name,
            is_private: v.isPrivate,
            created_at: v.createdAt || new Date().toISOString()
          })));
        }
      } catch (err) {
        console.error('Error loading profile page data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [router]);

  async function handleUpdateProfile(e) {
    e.preventDefault();
    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanUsername) return;
    setSaveLoading(true);
    setMessage({ type: '', text: '' });

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          username: cleanUsername,
          avatar_url: avatarUrl,
          dob: dob || null,
          country,
          is_private: isPrivate
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update profile');
      }

      setProfile(data);
      setMessage({ type: 'success', text: 'Profile updated successfully!' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Failed to update profile' });
    } finally {
      setSaveLoading(false);
    }
  }

  async function handleAcceptRequest(requestId, requesterUsername) {
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const res = await fetch(`/api/friends/${requestId}/accept`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to accept request');
      }

      // Update local list
      setFriendRequests(prev => prev.filter(r => r.friendshipId !== requestId));
      window.location.reload();
    } catch (err) {
      alert('Error accepting request: ' + err.message);
    }
  }

  async function handleDeclineRequest(requestId) {
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const res = await fetch(`/api/friends/${requestId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to decline request');
      }

      // Update local list
      setFriendRequests(prev => prev.filter(r => r.friendshipId !== requestId));
    } catch (err) {
      alert('Error declining request: ' + err.message);
    }
  }

  async function handleUnfriend(friendshipId) {
    if (!confirm('Are you sure you want to remove this friend?')) return;
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const res = await fetch(`/api/friends/${friendshipId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to remove friend');
      }

      // Update local list
      setFriends(prev => prev.filter(f => f.friendshipId !== friendshipId));
    } catch (err) {
      alert('Error removing friend: ' + err.message);
    }
  }

  async function handleToggleVideoPrivacy(videoId, currentStatus) {
    try {
      const newStatus = !currentStatus;
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const res = await fetch(`/api/videos/${videoId}/privacy`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ isPrivate: newStatus })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update video privacy');
      }

      // Update local list
      setMyVideos(prev => prev.map(v => v.id === videoId ? { ...v, is_private: newStatus } : v));
    } catch (err) {
      alert('Error updating video status: ' + err.message);
    }
  }

  async function handleDeleteVideo(videoId, filename) {
    if (!confirm(`Are you sure you want to delete "${filename}"? This will remove the file from storage.`)) return;
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      
      const res = await fetch(`/api/videos/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to delete video');
      }

      // Update local list
      setMyVideos(prev => prev.filter(v => v.id !== videoId));
    } catch (err) {
      alert('Error deleting video: ' + err.message);
    }
  }

  if (loading) {
    return (
      <div className="profile-container">
        <div className="lobby-logo" style={{ textAlign: 'center', marginTop: '60px' }}>
          <div className="logo-icon">👤</div>
          <h1>Profile</h1>
          <p>Loading details...</p>
          <div className="spinner" style={{ margin: '20px auto' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="profile-container">
      <div className="profile-header">
        <div className="profile-summary">
          {avatarUrl ? (
            <img src={avatarUrl} alt="Avatar" className="profile-large-avatar" />
          ) : (
            <div className="profile-large-avatar-placeholder">
              {username.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="profile-titles">
            <h2>
              {username} {profile?.is_verified && <VerifiedBadge size={16} />} {country && <span className="profile-flag-title">{getFlagEmoji(country)}</span>}
            </h2>
            <p>{user?.email}</p>
            <div className="profile-badges">
              <span className={`badge ${isPrivate ? 'badge-private' : 'badge-host'}`}>
                {isPrivate ? '🔒 Private Profile' : '🌐 Public Profile'}
              </span>
              <span className="badge badge-guest">{friends.length} Friends</span>
              <span className="badge badge-guest">{myVideos.length} Videos</span>
            </div>
          </div>
        </div>
      </div>

      <div className="profile-card">
        {/* Navigation Tabs */}
        <div className="profile-tabs">
          <button
            className={`profile-tab ${activeTab === 'edit' ? 'active' : ''}`}
            onClick={() => setActiveTab('edit')}
          >
            ✏️ Edit Profile
          </button>
          <button
            className={`profile-tab ${activeTab === 'friends' ? 'active' : ''}`}
            onClick={() => setActiveTab('friends')}
          >
            👥 Friends ({friends.length})
            {friendRequests.length > 0 && <span className="tab-alert-dot" />}
          </button>
          <button
            className={`profile-tab ${activeTab === 'videos' ? 'active' : ''}`}
            onClick={() => setActiveTab('videos')}
          >
            🎬 My Videos ({myVideos.length})
          </button>
        </div>

        {/* Tab Content: Edit Profile */}
        {activeTab === 'edit' && (
          <form onSubmit={handleUpdateProfile} className="profile-form">
            {message.text && (
              <div className={`auth-message ${message.type}`}>
                {message.type === 'error' ? '⚠️' : '✅'} {message.text}
              </div>
            )}

            <div className="input-group">
              <label className="input-label">Username</label>
              <input
                type="text"
                className="input-field"
                required
                maxLength={20}
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              />
            </div>

            <div className="input-group">
              <label className="input-label">Profile Picture</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '8px' }}>
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Preview" className="profile-large-avatar" style={{ margin: 0, width: '64px', height: '64px' }} />
                ) : (
                  <div className="profile-large-avatar-placeholder" style={{ margin: 0, width: '64px', height: '64px', fontSize: '1.5rem' }}>
                    {username.charAt(0).toUpperCase()}
                  </div>
                )}
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <input
                    type="file"
                    accept="image/*"
                    id="avatar-upload-input"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;

                      // Read file as base64
                      const reader = new FileReader();
                      reader.onload = async () => {
                        try {
                          const base64Data = reader.result;
                          const session = await supabase.auth.getSession();
                          const token = session.data.session?.access_token;

                          const res = await fetch('/api/profile/upload-avatar', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': `Bearer ${token}`
                            },
                            body: JSON.stringify({
                              data: base64Data,
                              filename: file.name,
                              contentType: file.type
                            })
                          });

                          if (!res.ok) {
                            const err = await res.json();
                            throw new Error(err.error || 'Failed to upload avatar');
                          }

                          const data = await res.json();
                          setAvatarUrl(data.url);
                          setMessage({ type: 'success', text: 'Avatar uploaded successfully! Click save to apply changes.' });
                        } catch (err) {
                          setMessage({ type: 'error', text: err.message });
                        }
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => document.getElementById('avatar-upload-input').click()}
                  >
                    📷 Upload Custom Photo
                  </button>
                  <span className="input-hint">JPG, PNG or WEBP (Max 5MB)</span>
                </div>
              </div>
            </div>

            <div className="input-row" style={{ display: 'flex', gap: '20px' }}>
              <div className="input-group" style={{ flex: 1 }}>
                <label className="input-label">Country</label>
                <select
                  className="input-field"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  style={{ height: '42px', backgroundColor: '#13131a', border: '1px solid #222', borderRadius: '6px', color: '#fff' }}
                >
                  {COUNTRIES.map(c => (
                    <option key={c.code} value={c.code}>
                      {getFlagEmoji(c.code)} {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="input-group" style={{ flex: 1 }}>
                <label className="input-label">Date of Birth</label>
                <input
                  type="date"
                  className="input-field"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                />
              </div>
            </div>

            <div className="privacy-toggle-group">
              <div className="privacy-toggle-text">
                <strong>Private Profile</strong>
                <p>When private, only accepted friends can watch your shared video uploads.</p>
              </div>
              <div
                className={`toggle-switch ${isPrivate ? 'active' : ''}`}
                onClick={() => setIsPrivate(!isPrivate)}
              />
            </div>

            <button className="btn btn-primary" type="submit" disabled={saveLoading} style={{ marginTop: '20px' }}>
              {saveLoading ? <div className="spinner-small" /> : '💾 Save Profile'}
            </button>
          </form>
        )}

        {/* Tab Content: Friends & Requests */}
        {activeTab === 'friends' && (
          <div className="friends-section">
            {/* Friend Requests */}
            <div className="friend-sub-section">
              <h3>Incoming Friend Requests ({friendRequests.length})</h3>
              {friendRequests.length === 0 ? (
                <div className="notice-empty">No pending friend requests</div>
              ) : (
                <div className="requests-list">
                  {friendRequests.map(r => (
                    <div key={r.id} className="social-user-item">
                      <div className="social-user-info">
                        {r.avatar_url ? (
                          <img src={r.avatar_url} alt="Avatar" className="social-avatar" />
                        ) : (
                          <div className="social-avatar-placeholder">{r.username.charAt(0).toUpperCase()}</div>
                        )}
                        <span className="social-username">
                          {r.username} {r.country && getFlagEmoji(r.country)}
                        </span>
                      </div>
                      <div className="social-actions">
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => handleAcceptRequest(r.friendshipId, r.username)}
                        >
                          Accept
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleDeclineRequest(r.friendshipId)}
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Friends list */}
            <div className="friend-sub-section" style={{ marginTop: '40px' }}>
              <h3>My Friends ({friends.length})</h3>
              {friends.length === 0 ? (
                <div className="notice-empty">You haven&apos;t added any friends yet. Use Search tab to find them!</div>
              ) : (
                <div className="requests-list">
                  {friends.map(f => (
                    <div key={f.id} className="social-user-item">
                      <div className="social-user-info">
                        {f.avatar_url ? (
                          <img src={f.avatar_url} alt="Avatar" className="social-avatar" />
                        ) : (
                          <div className="social-avatar-placeholder">{f.username.charAt(0).toUpperCase()}</div>
                        )}
                        <span className="social-username">
                          {f.username} {f.country && getFlagEmoji(f.country)}
                        </span>
                      </div>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleUnfriend(f.friendshipId)}
                      >
                        Unfriend
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab Content: My Videos */}
        {activeTab === 'videos' && (
          <div className="profile-videos-section">
            <h3>My Shared Videos ({myVideos.length})</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px' }}>
              Control visibility permissions for each of your uploaded video files.
            </p>

            {myVideos.length === 0 ? (
              <div className="notice-empty">You haven&apos;t uploaded any videos yet. Go to Lobby and click Upload!</div>
            ) : (
              <div className="my-videos-list">
                {myVideos.map(v => (
                  <div key={v.id} className="my-video-item">
                    <div className="my-video-info">
                      <span className="my-video-icon">🎬</span>
                      <div className="my-video-details">
                        <strong className="my-video-title">{v.display_name}</strong>
                        <span className="my-video-meta">Uploaded: {new Date(v.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    
                    <div className="my-video-actions">
                      <button
                        className={`btn ${v.is_private ? 'btn-secondary' : 'btn-primary'} btn-sm`}
                        onClick={() => handleToggleVideoPrivacy(v.id, v.is_private)}
                        title={v.is_private ? 'Change to Public' : 'Change to Private'}
                      >
                        {v.is_private ? '🔒 Private' : '🌐 Public'}
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDeleteVideo(v.id, v.filename)}
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
