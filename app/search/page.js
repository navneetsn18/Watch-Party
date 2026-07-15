'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, UserPlus, UserMinus, UserCheck, UserX, User, Loader2, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getFlagEmoji } from '../../components/NavBar';
import { VerifiedBadge } from '../../components/VerifiedBadge';

export default function SearchPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [friendships, setFriendships] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        router.push('/auth');
        return;
      }
      setUser(currentUser);
      
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return;

      const res = await fetch('/api/friends/list', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setFriendships(data);
      }
      setLoading(false);
    }
    checkAuth();
  }, [router]);

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearchLoading(true);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const res = await fetch(`/api/users/search?q=${encodeURIComponent(query.trim())}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to search users');
      setResults(data || []);
    } catch (err) {
      alert('Error searching users: ' + err.message);
    } finally {
      setSearchLoading(false);
    }
  }

  async function refreshFriendships() {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    const res = await fetch('/api/friends/list', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      setFriendships(data);
    }
  }

  async function sendFriendRequest(receiverId) {
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const res = await fetch('/api/friends/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ receiverId })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send request');
      await refreshFriendships();
    } catch (err) {
      alert('Error sending request: ' + err.message);
    }
  }

  async function cancelOrUnfriend(friendshipId) {
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const res = await fetch(`/api/friends/${friendshipId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to cancel or unfriend');
      }
      await refreshFriendships();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  async function acceptRequest(friendshipId) {
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const res = await fetch(`/api/friends/${friendshipId}/accept`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to accept request');
      }
      await refreshFriendships();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  function getRelation(targetId) {
    const relation = friendships.find(
      f => (f.sender_id === user.id && f.receiver_id === targetId) ||
           (f.sender_id === targetId && f.receiver_id === user.id)
    );

    if (!relation) return { type: 'none' };
    if (relation.status === 'accepted') return { type: 'friends', id: relation.id };
    if (relation.status === 'pending') {
      if (relation.sender_id === user.id) {
        return { type: 'sent', id: relation.id };
      } else {
        return { type: 'received', id: relation.id };
      }
    }
    return { type: 'none' };
  }

  const acceptedFriends = friendships
    .filter(f => f.status === 'accepted')
    .map(f => {
      const friendObj = f.sender_id === user?.id ? f.receiver : f.sender;
      return { friendshipId: f.id, ...friendObj };
    });

  if (loading) {
    return (
      <div className="min-h-[80vh] w-full flex items-center justify-center bg-[#07070a]">
        <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-12 bg-[#07070a] min-h-[90vh] flex flex-col gap-8">
      {/* Header */}
      <div className="pb-6 border-b border-zinc-900">
        <h1 className="text-3xl font-black text-white flex items-center gap-2.5 tracking-tight">
          <Search className="w-7 h-7 text-violet-400" />
          Search Users
        </h1>
        <p className="text-sm text-zinc-400 mt-1.5">
          Find creators, manage your friendships, and see who is ready for a watch party
        </p>
      </div>

      {/* Search Input Card */}
      <div className="bg-zinc-900/35 border border-zinc-800/60 p-6 rounded-3xl backdrop-blur-md">
        <form onSubmit={handleSearch} className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              className="w-full pl-11 pr-4 py-3 rounded-2xl bg-zinc-950 border border-zinc-800 focus:outline-none focus:border-violet-600 text-sm text-white placeholder-zinc-500 transition-colors"
              placeholder="Enter username (e.g. tofuthecat)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              required
            />
          </div>
          <button 
            type="submit" 
            disabled={searchLoading}
            className="px-6 rounded-2xl bg-violet-600 hover:bg-violet-500 active:scale-[0.97] text-white font-semibold text-sm transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-violet-900/10 disabled:opacity-50"
          >
            {searchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
          </button>
        </form>

        {/* Results Section */}
        <div className="mt-6">
          {results.length === 0 && query && !searchLoading && (
            <div className="text-center py-6 text-zinc-500 text-xs bg-zinc-950/20 border border-zinc-900 rounded-2xl">
              No matching users found
            </div>
          )}

          {results.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {results.map(profile => {
                const relation = getRelation(profile.id);

                return (
                  <div 
                    key={profile.id} 
                    className="flex items-center justify-between p-4 rounded-2xl bg-zinc-950 border border-zinc-900/80 hover:border-zinc-800/80 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {profile.avatar_url ? (
                        <img 
                          src={profile.avatar_url} 
                          alt={profile.username} 
                          className="w-10 h-10 rounded-full object-cover border border-zinc-800" 
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-sm font-bold text-zinc-400 border border-zinc-805 uppercase">
                          {profile.username.charAt(0)}
                        </div>
                      )}
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-zinc-200 flex items-center gap-1">
                          {profile.username}
                          {profile.isVerified && <VerifiedBadge size={14} />}
                          {profile.country && (
                            <span className="text-xs">{getFlagEmoji(profile.country)}</span>
                          )}
                        </span>
                        <span className="text-[10px] text-zinc-500 font-medium">
                          {profile.is_private ? '🔒 Private' : '🌐 Public'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {relation.type === 'none' && (
                        <button
                          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 active:scale-95 text-white text-xs font-semibold shadow-md shadow-violet-900/10 cursor-pointer transition-all"
                          onClick={() => sendFriendRequest(profile.id)}
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          <span>Add Friend</span>
                        </button>
                      )}

                      {relation.type === 'sent' && (
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-[10px] font-bold text-zinc-400">
                            Sent
                          </span>
                          <button
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-red-400 text-xs font-medium cursor-pointer transition-colors"
                            onClick={() => cancelOrUnfriend(relation.id)}
                          >
                            <UserMinus className="w-3.5 h-3.5" />
                            <span>Cancel</span>
                          </button>
                        </div>
                      )}

                      {relation.type === 'received' && (
                        <div className="flex gap-2">
                          <button
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer transition-all active:scale-95 shadow-md"
                            onClick={() => acceptRequest(relation.id)}
                          >
                            <UserCheck className="w-3.5 h-3.5" />
                            <span>Accept</span>
                          </button>
                          <button
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-zinc-905 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-red-400 text-xs font-medium cursor-pointer transition-colors"
                            onClick={() => cancelOrUnfriend(relation.id)}
                          >
                            <UserX className="w-3.5 h-3.5" />
                            <span>Decline</span>
                          </button>
                        </div>
                      )}

                      {relation.type === 'friends' && (
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-1.5 rounded-lg bg-violet-950/20 border border-violet-900/20 text-[10px] font-bold text-violet-400">
                            Friends
                          </span>
                          <button
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-red-450 text-xs font-medium cursor-pointer transition-colors"
                            onClick={() => cancelOrUnfriend(relation.id)}
                          >
                            <UserMinus className="w-3.5 h-3.5" />
                            <span>Unfriend</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* My Friends Section */}
      <div className="bg-zinc-900/35 border border-zinc-800/60 p-6 rounded-3xl backdrop-blur-md">
        <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-violet-400" />
          <span>My Friends ({acceptedFriends.length})</span>
        </h3>
        
        {acceptedFriends.length === 0 ? (
          <div className="text-center py-8 text-zinc-500 text-xs bg-zinc-950/20 border border-zinc-900 rounded-2xl">
            No friends added yet. Start searching to add friends!
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {acceptedFriends.map(friend => (
              <div 
                key={friend.id} 
                className="flex items-center justify-between p-3.5 rounded-2xl bg-zinc-950 border border-zinc-900"
              >
                <div className="flex items-center gap-2.5">
                  {friend.avatar_url ? (
                    <img 
                      src={friend.avatar_url} 
                      alt={friend.username} 
                      className="w-9 h-9 rounded-full object-cover border border-zinc-800" 
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400 border border-zinc-800 uppercase">
                      {friend.username.charAt(0)}
                    </div>
                  )}
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1">
                      {friend.username}
                      {friend.isVerified && <VerifiedBadge size={12} />}
                      {friend.country && (
                        <span className="text-xs">{getFlagEmoji(friend.country)}</span>
                      )}
                    </span>
                    <span className="text-[9px] text-zinc-500">
                      {friend.is_private ? '🔒 Private' : '🌐 Public'}
                    </span>
                  </div>
                </div>

                <button
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-red-400 text-[10px] font-bold cursor-pointer transition-colors active:scale-95"
                  onClick={() => cancelOrUnfriend(friend.friendshipId)}
                >
                  <UserMinus className="w-3 h-3" />
                  <span>Unfriend</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
