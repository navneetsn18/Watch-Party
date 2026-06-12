'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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

  // Refetch friendships
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

  // Helper to determine relationship with a user
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
      <div className="search-container">
        <div className="lobby-logo" style={{ textAlign: 'center', marginTop: '60px' }}>
          <div className="logo-icon">🔍</div>
          <h1>Search</h1>
          <p>Initializing...</p>
          <div className="spinner" style={{ margin: '20px auto' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="search-container">
      <div className="search-header">
        <div className="search-logo-box">
          <span className="search-icon">🔍</span>
          <h2>Search Users</h2>
          <p>Find friends, watch parties, and connect with other creators</p>
        </div>
      </div>

      <div className="search-card">
        <form onSubmit={handleSearch} className="search-form-row">
          <input
            type="text"
            className="input-field search-input-field"
            placeholder="Search by username (e.g. tofuthecat)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            required
          />
          <button type="submit" className="btn btn-primary search-submit-btn" disabled={searchLoading}>
            {searchLoading ? <div className="spinner-small" /> : 'Search'}
          </button>
        </form>

        <div className="search-results-section">
          {results.length === 0 && query && !searchLoading && (
            <div className="notice-empty">No matching users found</div>
          )}

          {results.length > 0 && (
            <div className="results-list">
              {results.map(profile => {
                const relation = getRelation(profile.id);

                return (
                  <div key={profile.id} className="social-user-item">
                    <div className="social-user-info">
                      {profile.avatar_url ? (
                        <img src={profile.avatar_url} alt="Avatar" className="social-avatar" />
                      ) : (
                        <div className="social-avatar-placeholder">
                          {profile.username.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="social-user-details">
                        <span className="social-username">
                          {profile.username}
                          {profile.isVerified && <VerifiedBadge size={14} />}
                          {profile.country && ` ${getFlagEmoji(profile.country)}`}
                        </span>
                        <span className="social-user-subtitle">
                          {profile.is_private ? '🔒 Private Account' : '🌐 Public Account'}
                        </span>
                      </div>
                    </div>

                    <div className="social-actions">
                      {relation.type === 'none' && (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => sendFriendRequest(profile.id)}
                        >
                          ➕ Add Friend
                        </button>
                      )}

                      {relation.type === 'sent' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="badge badge-guest">Pending</span>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => cancelOrUnfriend(relation.id)}
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      {relation.type === 'received' && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => acceptRequest(relation.id)}
                          >
                            Accept
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => cancelOrUnfriend(relation.id)}
                          >
                            Decline
                          </button>
                        </div>
                      )}

                      {relation.type === 'friends' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="badge badge-host">Friends</span>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => cancelOrUnfriend(relation.id)}
                          >
                            Unfriend
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
      <div className="search-card" style={{ marginTop: '24px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>👥</span> My Friends ({acceptedFriends.length})
        </h3>
        
        {acceptedFriends.length === 0 ? (
          <div className="notice-empty" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No friends added yet. Use the search bar above to find and add friends!
          </div>
        ) : (
          <div className="results-list">
            {acceptedFriends.map(friend => (
              <div key={friend.id} className="social-user-item">
                <div className="social-user-info">
                  {friend.avatar_url ? (
                    <img src={friend.avatar_url} alt="Avatar" className="social-avatar" />
                  ) : (
                    <div className="social-avatar-placeholder">
                      {friend.username.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="social-user-details">
                    <span className="social-username">
                      {friend.username}
                      {friend.isVerified && <VerifiedBadge size={14} />}
                      {friend.country && ` ${getFlagEmoji(friend.country)}`}
                    </span>
                    <span className="social-user-subtitle">
                      {friend.is_private ? '🔒 Private Account' : '🌐 Public Account'}
                    </span>
                  </div>
                </div>

                <div className="social-actions">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="badge badge-host">Friends</span>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => cancelOrUnfriend(friend.friendshipId)}
                    >
                      Unfriend
                    </button>
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
