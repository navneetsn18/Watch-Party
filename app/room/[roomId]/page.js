'use client';

import { useState, useEffect, useRef, useCallback, use, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { getSocket, disconnectSocket } from '../../../lib/socket';
import { formatSize } from '../../../lib/utils';
import { ToastProvider, useToast } from '../../../components/Toast';
import TopBar from '../../../components/TopBar';
import VideoPlayer from '../../../components/VideoPlayer';
import ChatPanel from '../../../components/ChatPanel';
import ShareModal from '../../../components/ShareModal';
import GuestRequestModal from '../../../components/GuestRequestModal';
import { supabase } from '../../../lib/supabase';
import { getFlagEmoji } from '../../../components/NavBar';

function RoomContent({ roomId }) {
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('Viewer');
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const initialVideo = searchParams.get('video');

  // Load user profile on room load
  useEffect(() => {
    async function loadUserProfile() {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (currentUser) {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        if (token) {
          try {
            const res = await fetch('/api/profile', {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
              const currentProfile = await res.json();
              setProfile(currentProfile);
              const flag = currentProfile.country ? ` ${getFlagEmoji(currentProfile.country)}` : '';
              const verified = currentProfile.is_verified || currentProfile.isVerified ? '✔️ ' : '';
              setUsername(`${verified}${currentProfile.username}${flag}`);
            } else {
              setUsername(currentUser.username || 'Viewer');
            }
          } catch (err) {
            setUsername(currentUser.username || 'Viewer');
          }
        } else {
          setUsername(currentUser.username || 'Viewer');
        }
      } else {
        setUsername(searchParams.get('username') || 'Guest');
      }
      setAuthLoading(false);
    }
    loadUserProfile();
  }, [searchParams]);

  const [isHost, setIsHost] = useState(false);
  const [userCount, setUserCount] = useState(1);
  const [guestControls, setGuestControls] = useState(true);
  const [videoUrl, setVideoUrl] = useState(null);
  const [currentVideoKey, setCurrentVideoKey] = useState(null);
  const [videos, setVideos] = useState([]);
  const [messages, setMessages] = useState([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');
  const [connected, setConnected] = useState(false);

  // Fullscreen notifications
  const [fsNotifications, setFsNotifications] = useState([]);
  const fsNotifIdRef = useRef(0);

  // Guest request queue (host side)
  const [guestRequests, setGuestRequests] = useState([]);

  const socketRef = useRef(null);
  const playerRef = useRef(null);
  const pendingSyncRef = useRef(null);
  const showToast = useToast();

  const isHostRef = useRef(isHost);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);

  // ── Stable refs for callbacks used inside socket effect ──
  // This prevents the socket effect from re-running when these change
  const showToastRef = useRef(showToast);
  const currentVideoKeyRef = useRef(currentVideoKey);
  useEffect(() => { showToastRef.current = showToast; }, [showToast]);
  useEffect(() => { currentVideoKeyRef.current = currentVideoKey; }, [currentVideoKey]);

  // ── Push fullscreen notification ──
  const pushFsNotification = useCallback(({ message, sender, isSystem }) => {
    const id = ++fsNotifIdRef.current;
    const notif = { id, message, sender, isSystem, exiting: false };
    setFsNotifications(prev => [...prev.slice(-4), notif]); // keep max 5

    // Start exit animation after 2s
    setTimeout(() => {
      setFsNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, exiting: true } : n)
      );
    }, 2000);

    // Remove after exit animation (2s + 0.5s for animation)
    setTimeout(() => {
      setFsNotifications(prev => prev.filter(n => n.id !== id));
    }, 2500);
  }, []);

  const pushFsNotificationRef = useRef(pushFsNotification);
  useEffect(() => { pushFsNotificationRef.current = pushFsNotification; }, [pushFsNotification]);

  // ── Load video by key ──
  const loadVideo = useCallback(async (key) => {
    if (key === currentVideoKeyRef.current) return false;
    currentVideoKeyRef.current = key;
    setCurrentVideoKey(key);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token || '';
      
      const res = await fetch('/api/video-url?key=' + encodeURIComponent(key) + '&roomId=' + encodeURIComponent(roomId), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      setVideoUrl(data.url);
      return true;
    } catch (err) {
      console.error('Error loading video:', err);
      return false;
    }
  }, [roomId]);

  const isVideoReady = useCallback(() => {
    const video = playerRef.current?.getVideo();
    return video && video.readyState >= 1; // 1 = HAVE_METADATA
  }, []);

  // ── Load video list ──
  const loadVideoList = useCallback(async () => {
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token || '';
      
      const res = await fetch('/api/videos', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      setVideos(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error loading video list:', err);
    }
  }, []);

  const handleDeleteVideo = async (videoKey) => {
    const filename = videoKey.replace(/^videos\//, '');
    if (!confirm(`Are you sure you want to delete "${filename}"? This will permanently remove it.`)) return;

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token || '';

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

      await loadVideoList();
    } catch (err) {
      alert(err.message);
    }
  };

  // ── Socket connection (depends on roomId + username + profile) ──
  useEffect(() => {
    if (authLoading) return; // Wait until auth check completes

    const socket = getSocket();
    socketRef.current = socket;

    const joinData = {
      roomId,
      username,
      userId: profile?.id || null,
      avatarUrl: profile?.avatar_url || null,
      country: profile?.country || null
    };

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join-room', joinData);
    });

    // If already connected (e.g. HMR), join immediately
    if (socket.connected) {
      setConnected(true);
      socket.emit('join-room', joinData);
    }

    socket.on('role', ({ role }) => {
      const host = role === 'host';
      setIsHost(host);
      if (host) {
        loadVideoList();
        setActiveTab('videos');
      }
    });

    socket.on('join-success', ({ roomId: rid, userCount: count }) => {
      setUserCount(count);
      showToastRef.current('🎉 Joined room ' + rid);
    });

    socket.on('user-count', (c) => setUserCount(c));

    socket.on('guest-controls-changed', ({ enabled }) => {
      setGuestControls(enabled);
    });

    socket.on('video-selected', async ({ videoKey }) => {
      await loadVideo(videoKey);
      addSystemMessage('🎬 Host picked: ' + videoKey.replace(/^videos\//, ''));
    });

    socket.on('play', ({ currentTime }) => {
      if (!isVideoReady()) {
        pendingSyncRef.current = { currentTime, playing: true, hostBuffering: false };
        return;
      }
      const player = playerRef.current;
      if (player) {
        player.seek(currentTime);
        player.play();
      }
      addSystemMessage('▶ Playback started');
    });

    socket.on('pause', ({ currentTime }) => {
      if (!isVideoReady()) {
        pendingSyncRef.current = { currentTime, playing: false, hostBuffering: false };
        return;
      }
      const player = playerRef.current;
      if (player) {
        player.seek(currentTime);
        player.pause();
      }
      addSystemMessage('⏸ Playback paused');
    });

    socket.on('seek', ({ currentTime, playing }) => {
      if (!isVideoReady()) {
        pendingSyncRef.current = { currentTime, playing: !!playing, hostBuffering: false };
        return;
      }
      const player = playerRef.current;
      if (player) {
        player.seek(currentTime);
        if (playing) {
          player.play();
        } else {
          player.pause();
        }
      }
    });

    socket.on('sync-state', async ({ videoKey, playing, currentTime, hostBuffering }) => {
      if (!videoKey) return;
      const isNewVideo = await loadVideo(videoKey);
      
      const performSync = () => {
        const player = playerRef.current;
        if (player) {
          player.seek(currentTime);
          if (playing) {
            player.play();
          } else {
            player.pause();
          }
          player.setHostBuffering(!!hostBuffering);
        }
      };

      if (isNewVideo) {
        pendingSyncRef.current = { currentTime, playing, hostBuffering: !!hostBuffering };
      } else {
        performSync();
      }
    });

    socket.on('host-buffering', ({ isBuffering }) => {
      const player = playerRef.current;
      if (player) {
        player.setHostBuffering(!!isBuffering);
      }
    });

    socket.on('host-time-update', ({ currentTime, playing, timestamp }) => {
      if (!isHostRef.current) {
        const player = playerRef.current;
        if (player) {
          const video = player.getVideo();
          if (video && !video.paused && playing) {
            const elapsed = (Date.now() - timestamp) / 1000;
            const expectedTime = currentTime + elapsed;
            const drift = Math.abs(video.currentTime - expectedTime);
            if (drift > 2.0) {
              console.log(`[SYNC] Guest drift detected: ${drift.toFixed(2)}s. Syncing to expected host time.`);
              player.seek(expectedTime);
            }
          }
        }
      }
    });

    socket.on('host-changed', ({ newHostName }) => {
      showToastRef.current(`👑 ${newHostName} is now the host`);
    });

    socket.on('chat-message', ({ sender, message, isSystem }) => {
      if (isSystem) {
        addSystemMessage(message);
        // Push fullscreen notification for system messages (join/leave)
        pushFsNotificationRef.current({ message, isSystem: true });
      } else {
        setMessages(prev => [...prev, { sender, message }]);
        // Push fullscreen notification for chat messages
        pushFsNotificationRef.current({ message, sender, isSystem: false });
      }
    });

    socket.on('reaction', ({ emoji }) => {
      const player = playerRef.current;
      if (player) player.spawnEmoji(emoji);
    });

    // ── Guest request events ──
    socket.on('guest-request-received', (request) => {
      // Host receives a guest request
      setGuestRequests(prev => [...prev, request]);
    });

    socket.on('request-approved', ({ requestId, action }) => {
      showToastRef.current(`✅ Host approved your ${action} request`);
    });

    socket.on('request-rejected', ({ requestId }) => {
      showToastRef.current('❌ Host rejected your request');
    });

    return () => {
      socket.removeAllListeners();
      disconnectSocket();
    };
  }, [roomId, username, profile, authLoading, loadVideo, loadVideoList, isVideoReady]);

  // Auto select video if passed in query param (Host only)
  useEffect(() => {
    if (isHost && initialVideo && connected) {
      const socket = socketRef.current;
      if (socket) {
        socket.emit('select-video', { roomId, videoKey: initialVideo });
        loadVideo(initialVideo);
      }
    }
  }, [isHost, initialVideo, connected, roomId, loadVideo]);

  // ── Host periodic playback time broadcast ──
  useEffect(() => {
    if (!isHost || !connected) return;
    const interval = setInterval(() => {
      const player = playerRef.current;
      if (player) {
        const video = player.getVideo();
        if (video && !video.paused) {
          const socket = socketRef.current;
          if (socket) {
            socket.emit('host-time-update', {
              roomId,
              currentTime: video.currentTime,
              playing: true,
              timestamp: Date.now()
            });
          }
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isHost, connected, roomId]);

  // ── Helpers ──
  function addSystemMessage(text) {
    setMessages(prev => [...prev, { message: text, isSystem: true }]);
  }

  function handleSendMessage(msg) {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('chat-message', { roomId, sender: username, message: msg });
    setMessages(prev => [...prev, { sender: username, message: msg }]);
  }

  function handleSendReaction(emoji) {
    // Spawn locally
    const player = playerRef.current;
    if (player) player.spawnEmoji(emoji);
    // Broadcast to others
    const socket = socketRef.current;
    if (socket) socket.emit('reaction', { roomId, emoji });
  }

  function handlePlay(currentTime) {
    const socket = socketRef.current;
    if (socket) socket.emit('play', { roomId, currentTime });
  }

  function handlePause(currentTime) {
    const socket = socketRef.current;
    if (socket) socket.emit('pause', { roomId, currentTime });
  }

  function handleSeek(currentTime) {
    const socket = socketRef.current;
    if (socket) {
      const player = playerRef.current;
      const video = player?.getVideo();
      const playing = video ? !video.paused : false;
      socket.emit('seek', { roomId, currentTime, playing });
    }
  }

  const handleLoadedMetadata = useCallback(() => {
    if (pendingSyncRef.current) {
      const { currentTime, playing, hostBuffering } = pendingSyncRef.current;
      pendingSyncRef.current = null;
      const player = playerRef.current;
      if (player) {
        player.seek(currentTime);
        if (playing) {
          player.play();
        } else {
          player.pause();
        }
        player.setHostBuffering(hostBuffering);
      }
    }
  }, []);

  const handleHostBuffering = useCallback((isBuffering) => {
    const socket = socketRef.current;
    if (socket && isHostRef.current) {
      socket.emit('host-buffering', { roomId, isBuffering });
    }
  }, [roomId]);

  function handleSelectVideo(video) {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('select-video', { roomId, videoKey: video.key });
    loadVideo(video.key);
  }

  function handleToggleGuestControls() {
    const socket = socketRef.current;
    if (!socket) return;
    const newState = !guestControls;
    socket.emit('toggle-guest-controls', { roomId, enabled: newState });
    showToast(newState ? '🎮 Guest controls enabled' : '🔒 Guest controls disabled');
  }

  function handleCopyRoomId() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(roomId).catch(() => {});
    }
    showToast('📋 Room code copied: ' + roomId);
  }

  // ── Guest request action (guest side) ──
  function handleRequestAction(action) {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('guest-request', { roomId, action });
  }

  // ── Host approve/reject guest requests ──
  function handleApproveRequest(request) {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('host-approve-request', {
      roomId,
      requestId: request.id,
      action: request.action,
      guestId: request.guestId,
    });
    setGuestRequests(prev => prev.filter(r => r.id !== request.id));
  }

  function handleRejectRequest(request) {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('host-reject-request', {
      roomId,
      requestId: request.id,
      guestId: request.guestId,
    });
    setGuestRequests(prev => prev.filter(r => r.id !== request.id));
  }

  const canControl = isHost || guestControls;

  return (
    <div className="app-shell">
      <TopBar
        roomId={roomId}
        userCount={userCount}
        isHost={isHost}
        guestControls={guestControls}
        videoName={currentVideoKey ? currentVideoKey.replace(/^videos\//, '') : null}
        onToggleGuestControls={handleToggleGuestControls}
        onShareClick={() => setShareOpen(true)}
        onCopyRoomId={handleCopyRoomId}
      />

      <div className="main-layout">
        <VideoPlayer
          ref={playerRef}
          videoUrl={videoUrl}
          isHost={isHost}
          guestControls={guestControls}
          canControl={canControl}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeek={handleSeek}
          onLoadedMetadata={handleLoadedMetadata}
          onHostBuffering={handleHostBuffering}
          fullscreenNotifications={fsNotifications}
          onRequestAction={!canControl ? handleRequestAction : undefined}
          guestRequests={guestRequests}
          onApproveRequest={handleApproveRequest}
          onRejectRequest={handleRejectRequest}
        />

        <div className="sidebar">
          <div className="sidebar-tab-bar">
            <button
              className={`sidebar-tab ${activeTab === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveTab('chat')}
              type="button"
            >
              💬 Chat
            </button>
            {isHost && (
              <button
                className={`sidebar-tab ${activeTab === 'videos' ? 'active' : ''}`}
                onClick={() => setActiveTab('videos')}
                type="button"
              >
                🎬 Videos
              </button>
            )}
          </div>

          {/* Chat pane */}
          <div className={`sidebar-pane ${activeTab === 'chat' ? 'active' : ''}`}>
            <ChatPanel
              messages={messages}
              onSendMessage={handleSendMessage}
              onSendReaction={handleSendReaction}
              username={username}
            />
          </div>

          {/* Videos pane (host only) */}
          <div className={`sidebar-pane ${activeTab === 'videos' ? 'active' : ''}`}>
            <div className="sidebar-section">
              {isHost ? (
                <div className="notice-host">
                  You are the host. Pick a video to start.
                </div>
              ) : (
                <div className="notice-guest">
                  Waiting for host to select a video…
                </div>
              )}
            </div>
            <div className="sidebar-section">
              <h3>Available Videos</h3>
              <div className="video-list">
                {videos.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                    No videos found. Add .mp4 or .mkv files to the videos/ folder.
                  </div>
                ) : (
                  videos.map((v) => (
                    <div
                      key={v.key}
                      className={`video-item ${currentVideoKey === v.key ? 'active' : ''}`}
                      onClick={() => handleSelectVideo(v)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '10px' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                        <span className="video-item-icon">🎬</span>
                        <div className="video-item-details-box" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                          <span className="video-item-name" title={v.name} style={{ fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {v.name}
                          </span>
                          <span className="video-item-uploader" style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            By: {v.uploaderName}
                            {v.isVerified && <span className="verified-badge" title="Verified Creator" style={{ color: '#3b82f6', marginLeft: '4px' }}>✔️</span>}
                            {v.country && ` ${getFlagEmoji(v.country)}`}
                            {v.isPrivate ? ' 🔒' : ''}
                          </span>
                        </div>
                      </div>
                      {v.uploaderId === profile?.id && (
                        <button
                          className="btn-delete-video-sidebar"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteVideo(v.key);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            padding: '4px 8px',
                            fontSize: '14px',
                            borderRadius: '4px',
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
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <ShareModal
        roomId={roomId}
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
      />

      {/* Guest request approval popups (host only) */}
      {isHost && (
        <GuestRequestModal
          requests={guestRequests}
          onApprove={handleApproveRequest}
          onReject={handleRejectRequest}
        />
      )}
    </div>
  );
}

export default function RoomPage({ params }) {
  const resolvedParams = use(params);
  const roomId = resolvedParams.roomId;

  return (
    <ToastProvider>
      <Suspense fallback={<div className="app-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>Loading room…</div>}>
        <RoomContent roomId={roomId} />
      </Suspense>
    </ToastProvider>
  );
}
