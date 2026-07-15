'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Users, Tv, ShieldCheck, Mail, Globe, Calendar, Lock, Unlock, Settings, Trash2, Shield, UploadCloud, UserPlus, UserCheck, UserX, Loader2 } from 'lucide-react';
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

        // Load my uploaded videos
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

      setMyVideos(prev => prev.filter(v => v.id !== videoId));
    } catch (err) {
      alert('Error deleting video: ' + err.message);
    }
  }

  if (loading) {
    return (
      <div className="min-h-[85vh] w-full flex items-center justify-center bg-[#07070a]">
        <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-12 bg-[#07070a] min-h-[90vh] flex flex-col gap-8">
      {/* Profile Header Summary */}
      <div className="p-6 rounded-3xl bg-zinc-900/20 border border-zinc-900 backdrop-blur-md relative overflow-hidden flex flex-col sm:flex-row items-center sm:items-start gap-6 select-none shadow-xl">
        {/* Glow */}
        <div className="absolute -right-20 -top-20 w-44 h-44 rounded-full bg-violet-600/10 blur-3xl pointer-events-none" />

        {/* Avatar */}
        <div className="flex-shrink-0 relative">
          {avatarUrl ? (
            <img 
              src={avatarUrl} 
              alt="Avatar" 
              className="w-24 h-24 rounded-3xl border-2 border-zinc-800 object-cover shadow-2xl" 
            />
          ) : (
            <div className="w-24 h-24 rounded-3xl bg-zinc-800 flex items-center justify-center text-4xl font-black text-zinc-400 border border-zinc-800 uppercase shadow-inner">
              {username.charAt(0)}
            </div>
          )}
        </div>

        {/* Details summary */}
        <div className="flex-1 text-center sm:text-left flex flex-col justify-center gap-2">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-center sm:justify-start">
            <h2 className="text-2xl font-black text-white flex items-center gap-2.5 tracking-tight justify-center sm:justify-start">
              {username}
              {profile?.is_verified && <VerifiedBadge size={18} />}
            </h2>
            {country && (
              <span className="text-lg bg-zinc-900 px-2 py-0.5 rounded-lg border border-zinc-800 inline-block self-center">
                {getFlagEmoji(country)}
              </span>
            )}
          </div>

          <p className="text-xs text-zinc-400 flex items-center gap-1.5 justify-center sm:justify-start">
            <Mail className="w-3.5 h-3.5 text-zinc-500" />
            <span>{user?.email}</span>
          </p>

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-2">
            <span className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border flex items-center gap-1.5 ${
              isPrivate 
                ? 'bg-red-950/20 border-red-900/20 text-red-400' 
                : 'bg-emerald-950/20 border-emerald-900/20 text-emerald-400'
            }`}>
              {isPrivate ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
              <span>{isPrivate ? 'Private Profile' : 'Public Profile'}</span>
            </span>

            <span className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-[10px] font-bold text-zinc-400 flex items-center gap-1">
              <Users className="w-3 h-3 text-zinc-500" />
              <span>{friends.length} Friends</span>
            </span>

            <span className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-[10px] font-bold text-zinc-400 flex items-center gap-1">
              <Tv className="w-3 h-3 text-zinc-500" />
              <span>{myVideos.length} Videos</span>
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-col gap-6">
        <div className="w-full flex border-b border-zinc-900 gap-1.5">
          {[
            { id: 'edit', label: 'Edit Profile', icon: Settings },
            { id: 'friends', label: 'Friends', icon: Users, badge: friendRequests.length },
            { id: 'videos', label: 'My Videos', icon: Tv, badge: myVideos.length },
          ].map(tab => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative px-4 py-3 text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors duration-150 ${
                  isActive ? 'text-white' : 'text-zinc-500 hover:text-zinc-400'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
                {tab.badge > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-violet-600 text-white text-[9px] font-extrabold animate-pulse">
                    {tab.badge}
                  </span>
                )}
                {isActive && (
                  <motion.div
                    layoutId="profile-tab-bar"
                    className="absolute bottom-0 left-0 right-0 h-[2px] bg-violet-500"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab Content Cards */}
        <div className="bg-zinc-900/35 border border-zinc-800/60 p-6 rounded-3xl backdrop-blur-md min-h-[300px]">
          <AnimatePresence mode="wait">
            {activeTab === 'edit' && (
              <motion.form 
                key="edit"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                onSubmit={handleUpdateProfile} 
                className="flex flex-col gap-5"
              >
                {message.text && (
                  <div className={`p-3 rounded-xl border text-xs ${
                    message.type === 'error'
                      ? 'bg-red-950/20 border-red-900/30 text-red-400'
                      : 'bg-emerald-950/20 border-emerald-900/30 text-emerald-400'
                  }`}>
                    {message.type === 'error' ? '⚠️ ' : '✅ '} {message.text}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-zinc-400">Username</label>
                    <input
                      type="text"
                      className="w-full px-4 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-200 focus:outline-none focus:border-violet-600 text-sm transition-all"
                      required
                      maxLength={20}
                      value={username}
                      onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-zinc-400">Country</label>
                    <select
                      className="w-full px-3 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-200 focus:outline-none focus:border-violet-600 text-sm transition-all cursor-pointer"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                    >
                      {COUNTRIES.map(c => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-zinc-400">Date of Birth</label>
                    <input
                      type="date"
                      className="w-full px-4 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-200 focus:outline-none focus:border-violet-600 text-sm transition-all"
                      value={dob}
                      onChange={(e) => setDob(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5 justify-center">
                    <label className="text-xs font-semibold text-zinc-400 mb-1">Privacy Scope</label>
                    <label className="flex items-center gap-3 cursor-pointer py-1.5 select-none">
                      <input
                        type="checkbox"
                        checked={isPrivate}
                        onChange={(e) => setIsPrivate(e.target.checked)}
                        className="w-[18px] h-[18px] rounded border-zinc-800 bg-zinc-950 text-violet-600 focus:ring-violet-600 cursor-pointer"
                      />
                      <span className="text-xs text-zinc-300 font-medium">Make profile private (friends only)</span>
                    </label>
                  </div>
                </div>

                {/* Avatar upload */}
                <div className="flex flex-col gap-2.5 mt-2 pt-4 border-t border-zinc-900/60">
                  <label className="text-xs font-semibold text-zinc-400">Avatar Image</label>
                  <div className="flex items-center gap-5">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="Avatar" className="w-14 h-14 rounded-2xl object-cover border border-zinc-800 shadow" />
                    ) : (
                      <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center text-xl font-bold border border-zinc-800 uppercase text-zinc-400">
                        {username.charAt(0)}
                      </div>
                    )}
                    
                    <label className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-zinc-800 hover:bg-zinc-800 text-xs font-semibold text-zinc-300 hover:text-white cursor-pointer transition-colors">
                      <UploadCloud className="w-4 h-4 text-violet-400" />
                      <span>Upload Photo</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            setAvatarUrl(reader.result);
                          };
                          reader.readAsDataURL(file);
                        }}
                      />
                    </label>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={saveLoading}
                  className="w-full mt-4 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 active:scale-[0.98] text-white font-semibold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-violet-900/25"
                >
                  {saveLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Profile Changes'}
                </button>
              </motion.form>
            )}

            {/* Tab: Friends list */}
            {activeTab === 'friends' && (
              <motion.div 
                key="friends"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="flex flex-col gap-6"
              >
                {/* Pending requests */}
                {friendRequests.length > 0 && (
                  <div className="flex flex-col gap-3 pb-6 border-b border-zinc-900">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-violet-400">
                      Pending Inbound Requests ({friendRequests.length})
                    </h4>
                    <div className="flex flex-col gap-2">
                      {friendRequests.map(req => (
                        <div key={req.id} className="flex items-center justify-between p-3.5 rounded-2xl bg-zinc-950 border border-zinc-900">
                          <div className="flex items-center gap-3">
                            <span className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-300">
                              {req.username.charAt(0).toUpperCase()}
                            </span>
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-white flex items-center gap-1">
                                {req.username}
                                {req.country && getFlagEmoji(req.country)}
                              </span>
                            </div>
                          </div>
                          
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleAcceptRequest(req.friendshipId, req.username)}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-600 text-white text-[11px] font-bold cursor-pointer active:scale-95 transition-all"
                            >
                              <UserCheck className="w-3.5 h-3.5" />
                              <span>Accept</span>
                            </button>
                            <button
                              onClick={() => handleDeclineRequest(req.friendshipId)}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-red-400 text-[11px] font-semibold cursor-pointer transition-colors"
                            >
                              <UserX className="w-3.5 h-3.5" />
                              <span>Decline</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Active Friends */}
                <div className="flex flex-col gap-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                    My Friends ({friends.length})
                  </h4>
                  {friends.length === 0 ? (
                    <div className="text-center py-10 text-zinc-500 text-xs bg-zinc-950/20 border border-zinc-900/60 rounded-2xl">
                      Your friends list is currently empty.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {friends.map(friend => (
                        <div key={friend.id} className="flex items-center justify-between p-3 rounded-2xl bg-zinc-950 border border-zinc-900">
                          <div className="flex items-center gap-2.5">
                            {friend.avatar_url ? (
                              <img src={friend.avatar_url} alt={friend.username} className="w-9 h-9 rounded-full object-cover border border-zinc-800" />
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400 uppercase">
                                {friend.username.charAt(0)}
                              </div>
                            )}
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-white flex items-center gap-1">
                                {friend.username}
                                {friend.isVerified && <VerifiedBadge size={12} />}
                                {friend.country && getFlagEmoji(friend.country)}
                              </span>
                              <span className="text-[9px] text-zinc-500 font-medium">{friend.is_private ? '🔒 Private' : '🌐 Public'}</span>
                            </div>
                          </div>

                          <button
                            onClick={() => handleUnfriend(friend.friendshipId)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[10px] font-bold text-zinc-400 hover:text-red-400 cursor-pointer transition-colors"
                          >
                            <UserMinus className="w-3 h-3" />
                            <span>Remove</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* Tab: My Videos */}
            {activeTab === 'videos' && (
              <motion.div 
                key="videos"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="flex flex-col gap-4"
              >
                <div className="flex justify-between items-center pb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                    Uploaded Videos ({myVideos.length})
                  </h4>
                </div>

                {myVideos.length === 0 ? (
                  <div className="text-center py-10 text-zinc-500 text-xs bg-zinc-950/20 border border-zinc-900/60 rounded-2xl">
                    You have not uploaded any videos yet.
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {myVideos.map(video => (
                      <div 
                        key={video.id} 
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl bg-zinc-950 border border-zinc-900 gap-4"
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <span className="text-2xl mt-0.5">🎬</span>
                          <div className="flex flex-col min-w-0">
                            <span className="text-sm font-semibold text-zinc-200 truncate">{video.display_name}</span>
                            <span className="text-[10px] text-zinc-500 font-mono mt-0.5 truncate">{video.filename}</span>
                            <span className="text-[9px] text-zinc-600 mt-1">Uploaded {new Date(video.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 self-end sm:self-center">
                          {/* Privacy Toggle Button */}
                          <button
                            onClick={() => handleToggleVideoPrivacy(video.id, video.is_private)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[10px] font-bold transition-all cursor-pointer ${
                              video.is_private
                                ? 'bg-red-950/25 border-red-900/30 text-red-400 hover:bg-red-950/40'
                                : 'bg-emerald-950/25 border-emerald-900/30 text-emerald-400 hover:bg-emerald-950/40'
                            }`}
                            title={video.is_private ? 'Friends Only' : 'Public'}
                          >
                            {video.is_private ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                            <span>{video.is_private ? 'Private' : 'Public'}</span>
                          </button>

                          {/* Delete Button */}
                          <button
                            onClick={() => handleDeleteVideo(video.id, video.filename)}
                            className="p-2 rounded-xl bg-zinc-900 hover:bg-red-950/20 border border-zinc-800 hover:border-red-900/30 text-zinc-400 hover:text-red-400 transition-all cursor-pointer"
                            title="Delete Video"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
