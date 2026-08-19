'use client';

import { useState, useEffect, useRef, useCallback, use, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, MessageSquare, Tv, Crown, Eye, ShieldAlert, ShieldCheck, Loader2, CirclePlay, Check, X, SkipForward, Clock } from 'lucide-react';
import { getSocket, disconnectSocket } from '../../../lib/socket';
import { formatSize } from '../../../lib/utils';
import { ToastProvider, useToast } from '../../../components/Toast';
import TopBar from '../../../components/TopBar';
import VideoPlayer from '../../../components/VideoPlayer';
import YouTubePlayer from '../../../components/YouTubePlayer';
import ChatPanel from '../../../components/ChatPanel';
import ShareModal from '../../../components/ShareModal';
import GuestRequestModal from '../../../components/GuestRequestModal';
import { supabase } from '../../../lib/supabase';
import { getFlagEmoji } from '../../../components/NavBar';
import { VerifiedBadge } from '../../../components/VerifiedBadge';

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
              const isVerified = currentProfile.is_verified || currentProfile.isVerified;
              const suffix = isVerified ? ' [VERIFIED]' : '';
              setUsername(`${currentProfile.username}${flag}${suffix}`);
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
  const [watchers, setWatchers] = useState([]);
  const [ytUrl, setYtUrl] = useState('');
  const [queue, setQueue] = useState([]);
  const [guestControls, setGuestControls] = useState(true);
  const [videoUrl, setVideoUrl] = useState(null);
  const [subtitles, setSubtitles] = useState([]);
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

  const showToastRef = useRef(showToast);
  const currentVideoKeyRef = useRef(currentVideoKey);
  useEffect(() => { showToastRef.current = showToast; }, [showToast]);
  useEffect(() => { currentVideoKeyRef.current = currentVideoKey; }, [currentVideoKey]);

  // Fullscreen notification
  const pushFsNotification = useCallback(({ message, sender, isSystem }) => {
    const id = ++fsNotifIdRef.current;
    const notif = { id, message, sender, isSystem, exiting: false };
    setFsNotifications(prev => [...prev.slice(-4), notif]);

    setTimeout(() => {
      setFsNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, exiting: true } : n)
      );
    }, 2000);

    setTimeout(() => {
      setFsNotifications(prev => prev.filter(n => n.id !== id));
    }, 2500);
  }, []);

  const pushFsNotificationRef = useRef(pushFsNotification);
  useEffect(() => { pushFsNotificationRef.current = pushFsNotification; }, [pushFsNotification]);

  // Load video by key
  const loadVideo = useCallback(async (key) => {
    if (key === currentVideoKeyRef.current) return false;
    currentVideoKeyRef.current = key;
    setCurrentVideoKey(key);
    // YouTube keys need no URL resolution — the player embeds the ID directly
    if (key.startsWith('youtube:')) {
      setVideoUrl(null);
      setSubtitles([]);
      return true;
    }
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
      setSubtitles(data.subtitles || []);
      return true;
    } catch (err) {
      console.error('Error loading video:', err);
      return false;
    }
  }, [roomId]);

  const isVideoReady = useCallback(() => {
    const video = playerRef.current?.getVideo();
    return video && video.readyState >= 1; 
  }, []);

  // Load video list
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

  // Socket connection
  useEffect(() => {
    if (authLoading) return;

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

    socket.on('user-list', (list) => setWatchers(Array.isArray(list) ? list : []));

    socket.on('guest-controls-changed', ({ enabled }) => {
      setGuestControls(enabled);
    });

    socket.on('video-selected', async ({ videoKey, autoplay }) => {
      await loadVideo(videoKey);
      // autoplay comes from queue auto-advance (video ended, host skipped, a
      // pending item got approved) — pendingSyncRef is the same mechanism
      // used for late-join sync-state, applied once the player reports ready.
      if (autoplay) {
        pendingSyncRef.current = { currentTime: 0, playing: true, hostBuffering: false };
      }
      const label = videoKey.startsWith('youtube:') ? 'a YouTube video' : videoKey.replace(/^videos\//, '');
      addSystemMessage(autoplay ? '⏭ Now playing: ' + label : '🎬 Host picked: ' + label);
    });

    socket.on('queue-updated', (q) => setQueue(Array.isArray(q) ? q : []));
    socket.on('queue-error', ({ message }) => showToastRef.current('⚠️ ' + message));
    socket.on('queue-info', ({ message }) => showToastRef.current('ℹ️ ' + message));

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
        pushFsNotificationRef.current({ message, isSystem: true });
      } else {
        setMessages(prev => [...prev, { sender, message }]);
        pushFsNotificationRef.current({ message, sender, isSystem: false });
      }
    });

    socket.on('reaction', ({ emoji }) => {
      const player = playerRef.current;
      if (player) player.spawnEmoji(emoji);
    });

    socket.on('guest-request-received', (request) => {
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

  // Host periodic playback time broadcast
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
    const player = playerRef.current;
    if (player) player.spawnEmoji(emoji);
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

  // Server does all URL/playlist parsing and validation (oEmbed lookup, etc.)
  // — client just forwards the raw text and reacts to queue-error/queue-info.
  function handleAddToQueue() {
    const socket = socketRef.current;
    if (!socket || !ytUrl.trim()) return;
    socket.emit('queue-add', { roomId, url: ytUrl.trim() });
    setYtUrl('');
  }

  function handleQueueApprove(itemId) {
    socketRef.current?.emit('queue-approve', { roomId, itemId });
  }

  function handleQueueReject(itemId) {
    socketRef.current?.emit('queue-reject', { roomId, itemId });
  }

  function handleQueueRemove(itemId) {
    socketRef.current?.emit('queue-remove', { roomId, itemId });
  }

  function handleQueueSkip() {
    socketRef.current?.emit('queue-skip', { roomId });
  }

  function handleQueuePlayNow(itemId) {
    socketRef.current?.emit('queue-play-now', { roomId, itemId });
  }

  const handleVideoEnded = useCallback(() => {
    const socket = socketRef.current;
    if (socket && isHostRef.current) socket.emit('video-ended', { roomId });
  }, [roomId]);

  function isMyQueueItem(item) {
    return item.addedBySocketId === socketRef.current?.id
      || (item.addedByUserId && profile?.id && item.addedByUserId === profile.id);
  }

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

  function handleRequestAction(action) {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('guest-request', { roomId, action });
  }

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
    <div className="flex flex-col h-screen w-screen bg-zinc-950 overflow-hidden text-zinc-100">
      {/* Top Header */}
      <TopBar
        roomId={roomId}
        userCount={userCount}
        watchers={watchers}
        isHost={isHost}
        guestControls={guestControls}
        videoName={currentVideoKey ? (currentVideoKey.startsWith('youtube:') ? '▶ YouTube video' : currentVideoKey.replace(/^videos\//, '')) : null}
        onToggleGuestControls={handleToggleGuestControls}
        onShareClick={() => setShareOpen(true)}
        onCopyRoomId={handleCopyRoomId}
      />

      {/* Main Splits Workspace */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden relative">
        {/* Left Side: Video Player Container */}
        <div className="flex-1 bg-black relative flex items-center justify-center min-h-[40vh] md:min-h-0 overflow-hidden">
          {currentVideoKey?.startsWith('youtube:') ? (
            <YouTubePlayer
              ref={playerRef}
              videoId={currentVideoKey.slice(8)}
              isHost={isHost}
              canControl={canControl}
              onPlay={handlePlay}
              onPause={handlePause}
              onSeek={handleSeek}
              onLoadedMetadata={handleLoadedMetadata}
              onHostBuffering={handleHostBuffering}
              onEnded={handleVideoEnded}
              onRequestAction={!canControl ? handleRequestAction : undefined}
            />
          ) : (
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
              onEnded={handleVideoEnded}
              fullscreenNotifications={fsNotifications}
              onRequestAction={!canControl ? handleRequestAction : undefined}
              guestRequests={guestRequests}
              onApproveRequest={handleApproveRequest}
              onRejectRequest={handleRejectRequest}
              subtitles={subtitles}
            />
          )}
        </div>

        {/* Right Side: Sidebar Panel */}
        <aside className="w-full md:w-[350px] border-t md:border-t-0 md:border-l border-zinc-900 bg-zinc-950 flex flex-col flex-shrink-0 min-h-0 overflow-hidden select-none">
          {/* Tab Selection */}
          <div className="flex border-b border-zinc-900 bg-zinc-950/80 backdrop-blur">
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex-1 py-3 text-xs font-bold transition-all relative ${
                activeTab === 'chat' ? 'text-white font-black' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Chat</span>
              </span>
              {activeTab === 'chat' && (
                <motion.div
                  layoutId="room-sidebar-tab"
                  className="absolute bottom-0 left-0 right-0 h-[2px] bg-violet-500"
                  transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                />
              )}
            </button>
            <button
              onClick={() => setActiveTab('videos')}
              className={`flex-1 py-3 text-xs font-bold transition-all relative ${
                activeTab === 'videos' ? 'text-white font-black' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                <Tv className="w-3.5 h-3.5" />
                <span>Videos</span>
                {queue.filter(q => q.status === 'pending').length > 0 && isHost && (
                  <span className="w-4 h-4 rounded-full bg-violet-600 text-white text-[9px] font-extrabold flex items-center justify-center">
                    {queue.filter(q => q.status === 'pending').length}
                  </span>
                )}
              </span>
              {activeTab === 'videos' && (
                <motion.div
                  layoutId="room-sidebar-tab"
                  className="absolute bottom-0 left-0 right-0 h-[2px] bg-violet-500"
                  transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                />
              )}
            </button>
          </div>

          {/* Chat Panel view */}
          {activeTab === 'chat' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-zinc-950/40">
              <ChatPanel
                messages={messages}
                onSendMessage={handleSendMessage}
                onSendReaction={handleSendReaction}
                username={username}
              />
            </div>
          )}

          {/* Videos picker panel */}
          {activeTab === 'videos' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-zinc-950/40">
              {/* Instructions banner */}
              <div className="p-3 bg-violet-950/20 border-b border-violet-900/35 text-[10px] text-violet-300 font-semibold flex items-center gap-1.5">
                <Crown className="w-3.5 h-3.5 text-violet-400" />
                <span>
                  {isHost
                    ? 'You are Room Host. Add YouTube videos or pick a local clip below.'
                    : guestControls
                      ? 'Add YouTube videos below — they play automatically.'
                      : 'Add YouTube videos below — the host approves each one before it plays.'}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
                {/* YouTube add box — everyone can add */}
                <span className="text-[10px] uppercase font-black text-zinc-500 tracking-wider mb-1 block">
                  Add from YouTube
                </span>
                <div className="flex items-center gap-2 p-2 rounded-xl border bg-zinc-950 border-zinc-900/80 transition-all">
                  <CirclePlay className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <input
                    type="text"
                    value={ytUrl}
                    onChange={(e) => setYtUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddToQueue(); }}
                    placeholder="Paste a video or playlist link…"
                    className="flex-1 min-w-0 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none"
                  />
                  <button
                    onClick={handleAddToQueue}
                    className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold cursor-pointer transition-colors flex-shrink-0"
                  >
                    Add
                  </button>
                </div>
                <span className="text-[9px] text-zinc-600 mb-1 leading-snug">
                  Public videos only — members-only and embed-blocked videos won&apos;t play. Playlists add up to 15 recent videos. Ads may briefly desync viewers; sync self-heals after.
                </span>

                {/* Queue */}
                <div className="flex items-center justify-between mt-2 mb-1">
                  <span className="text-[10px] uppercase font-black text-zinc-500 tracking-wider">
                    Up Next ({queue.filter(q => q.status === 'approved').length})
                    {isHost && queue.some(q => q.status === 'approved') && (
                      <span className="normal-case font-medium text-zinc-600 tracking-normal"> — click one to play it now</span>
                    )}
                  </span>
                  {isHost && currentVideoKey?.startsWith('youtube:') && (
                    <button
                      onClick={handleQueueSkip}
                      className="flex items-center gap-1 text-[9px] font-bold text-zinc-400 hover:text-white cursor-pointer transition-colors"
                      title="Skip to next in queue"
                    >
                      <SkipForward className="w-3 h-3" /> Skip
                    </button>
                  )}
                </div>

                {queue.length === 0 ? (
                  <div className="text-center py-6 border border-zinc-900 rounded-xl bg-zinc-950/20 text-zinc-500 text-xs leading-relaxed mb-2">
                    Queue is empty. Paste a YouTube link above to start.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 mb-2">
                    {queue.map((item) => {
                      const canPlayNow = isHost && item.status === 'approved';
                      return (
                      <div
                        key={item.id}
                        onClick={canPlayNow ? () => handleQueuePlayNow(item.id) : undefined}
                        title={canPlayNow ? 'Play now' : undefined}
                        className={`group flex items-center gap-2.5 p-2 rounded-xl border transition-colors ${
                          item.status === 'pending'
                            ? 'bg-amber-950/10 border-amber-900/30'
                            : 'bg-zinc-950 border-zinc-900/80'
                        } ${canPlayNow ? 'cursor-pointer hover:border-violet-800/50 hover:bg-violet-950/10' : ''}`}
                      >
                        {item.thumbnail ? (
                          <div className="relative w-14 h-8 flex-shrink-0">
                            <img src={item.thumbnail} alt="" className="w-full h-full object-cover rounded-md" />
                            {canPlayNow && (
                              <div className="absolute inset-0 rounded-md bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <CirclePlay className="w-4 h-4 text-white" />
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="w-14 h-8 rounded-md bg-zinc-900 flex items-center justify-center flex-shrink-0">
                            <CirclePlay className="w-3.5 h-3.5 text-zinc-600" />
                          </div>
                        )}
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-xs font-bold text-zinc-200 truncate" title={item.title}>
                            {item.title}
                          </span>
                          <span className="text-[9px] text-zinc-500 truncate mt-0.5 flex items-center gap-1">
                            Added by {item.addedByName}
                            {item.status === 'pending' && (
                              <span className="text-amber-400 flex items-center gap-0.5">
                                <Clock className="w-2.5 h-2.5" /> pending
                              </span>
                            )}
                          </span>
                        </div>
                        {item.status === 'pending' && isHost && (
                          <>
                            <button
                              onClick={() => handleQueueApprove(item.id)}
                              title="Approve"
                              className="p-1.5 rounded-lg bg-emerald-950/20 border border-emerald-900/30 text-emerald-400 hover:bg-emerald-950/40 cursor-pointer transition-colors flex-shrink-0"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleQueueReject(item.id)}
                              title="Reject"
                              className="p-1.5 rounded-lg bg-red-950/20 border border-red-900/30 text-red-400 hover:bg-red-950/40 cursor-pointer transition-colors flex-shrink-0"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        {(isHost || isMyQueueItem(item)) && item.status !== 'pending' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleQueueRemove(item.id); }}
                            title="Remove from queue"
                            className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-950/20 transition-all cursor-pointer flex-shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      );
                    })}
                  </div>
                )}

                {/* Local video library — host only, unchanged instant-select */}
                {isHost && (
                  <>
                    <span className="text-[10px] uppercase font-black text-zinc-500 tracking-wider mb-1 block mt-2 pt-3 border-t border-zinc-900/60">
                      Local Library ({videos.length})
                    </span>

                    {videos.length === 0 ? (
                      <div className="text-center py-8 border border-zinc-900 rounded-xl bg-zinc-950/20 text-zinc-500 text-xs leading-relaxed">
                        No videos found. Upload video files via the Navigation menu first!
                      </div>
                    ) : (
                      videos.map((v) => {
                        const isActive = currentVideoKey === v.key;
                        return (
                          <div
                            key={v.key}
                            onClick={() => handleSelectVideo(v)}
                            className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                              isActive
                                ? 'bg-violet-950/15 border-violet-800/40 text-white'
                                : 'bg-zinc-950 border-zinc-900/80 text-zinc-300 hover:border-zinc-800 hover:text-white'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <span className="text-lg">🎬</span>
                              <div className="flex flex-col min-w-0 flex-1">
                                <span className="text-xs font-bold truncate" title={v.name}>
                                  {v.name}
                                </span>
                                <span className="text-[9px] text-zinc-500 truncate mt-0.5">
                                  By: {v.uploaderName} {v.country && getFlagEmoji(v.country)}
                                  {v.isPrivate ? ' • 🔒' : ''}
                                </span>
                              </div>
                            </div>

                            {v.uploaderId === profile?.id && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteVideo(v.key);
                                }}
                                className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-950/20 transition-all cursor-pointer flex items-center justify-center border border-transparent hover:border-red-900/30"
                                title="Delete Video"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Invite Share Modal overlay */}
      <ShareModal
        roomId={roomId}
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
      />

      {/* Guest controller request popup (host-only) */}
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
      <Suspense fallback={
        <div className="h-screen w-screen bg-[#07070a] flex items-center justify-center text-zinc-400 text-xs font-medium">
          <Loader2 className="w-6 h-6 text-violet-500 animate-spin mr-2" />
          <span>Synchronizing Lobby...</span>
        </div>
      }>
        <RoomContent roomId={roomId} />
      </Suspense>
    </ToastProvider>
  );
}
