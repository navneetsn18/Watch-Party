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

function RoomContent({ roomId }) {
  const searchParams = useSearchParams();
  const username = searchParams.get('username') || 'Viewer';

  const [isHost, setIsHost] = useState(false);
  const [userCount, setUserCount] = useState(1);
  const [guestControls, setGuestControls] = useState(false);
  const [videoUrl, setVideoUrl] = useState(null);
  const [currentVideoKey, setCurrentVideoKey] = useState(null);
  const [videos, setVideos] = useState([]);
  const [messages, setMessages] = useState([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');
  const [connected, setConnected] = useState(false);

  const socketRef = useRef(null);
  const playerRef = useRef(null);
  const isSyncingRef = useRef(false);
  const showToast = useToast();

  // ── Stable refs for callbacks used inside socket effect ──
  // This prevents the socket effect from re-running when these change
  const showToastRef = useRef(showToast);
  const currentVideoKeyRef = useRef(currentVideoKey);
  useEffect(() => { showToastRef.current = showToast; }, [showToast]);
  useEffect(() => { currentVideoKeyRef.current = currentVideoKey; }, [currentVideoKey]);

  // ── Load video by key (stable — no state deps) ──
  const loadVideo = useCallback(async (key) => {
    // Use ref to check current key so callback identity stays stable
    if (key === currentVideoKeyRef.current) return;
    currentVideoKeyRef.current = key;
    setCurrentVideoKey(key);
    try {
      const res = await fetch('/api/video-url?key=' + encodeURIComponent(key));
      const data = await res.json();
      setVideoUrl(data.url);
    } catch (err) {
      console.error('Error loading video:', err);
    }
  }, []);  // stable — no deps

  // ── Load video list (stable) ──
  const loadVideoList = useCallback(async () => {
    try {
      const res = await fetch('/api/videos');
      const data = await res.json();
      setVideos(data);
    } catch (err) {
      console.error('Error loading video list:', err);
    }
  }, []);

  // ── Socket connection (only depends on roomId + username) ──
  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join-room', { roomId, username });
    });

    // If already connected (e.g. HMR), join immediately
    if (socket.connected) {
      setConnected(true);
      socket.emit('join-room', { roomId, username });
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
      isSyncingRef.current = true;
      const player = playerRef.current;
      if (player) {
        player.seek(currentTime);
        player.play();
      }
      setTimeout(() => { isSyncingRef.current = false; }, 500);
      addSystemMessage('▶ Playback started');
    });

    socket.on('pause', ({ currentTime }) => {
      isSyncingRef.current = true;
      const player = playerRef.current;
      if (player) {
        player.seek(currentTime);
        player.pause();
      }
      setTimeout(() => { isSyncingRef.current = false; }, 500);
      addSystemMessage('⏸ Playback paused');
    });

    socket.on('seek', ({ currentTime }) => {
      isSyncingRef.current = true;
      const player = playerRef.current;
      if (player) player.seek(currentTime);
      setTimeout(() => { isSyncingRef.current = false; }, 500);
    });

    socket.on('sync-state', async ({ videoKey, playing, currentTime }) => {
      if (!videoKey) return;
      await loadVideo(videoKey);
      isSyncingRef.current = true;
      // Wait for video to be ready
      setTimeout(() => {
        const player = playerRef.current;
        if (player) {
          player.seek(currentTime);
          if (playing) player.play();
        }
        setTimeout(() => { isSyncingRef.current = false; }, 500);
      }, 500);
    });

    socket.on('host-changed', ({ newHostName }) => {
      showToastRef.current(`👑 ${newHostName} is now the host`);
    });

    socket.on('chat-message', ({ sender, message, isSystem }) => {
      if (isSystem) {
        addSystemMessage(message);
      } else {
        setMessages(prev => [...prev, { sender, message }]);
      }
    });

    socket.on('reaction', ({ emoji }) => {
      const player = playerRef.current;
      if (player) player.spawnEmoji(emoji);
    });

    return () => {
      socket.removeAllListeners();
      disconnectSocket();
    };
  }, [roomId, username, loadVideo, loadVideoList]);
  // loadVideo and loadVideoList are now stable (no state deps)

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
    if (socket) socket.emit('seek', { roomId, currentTime });
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

  const canControl = isHost || guestControls;

  return (
    <div className="app-shell">
      <TopBar
        roomId={roomId}
        userCount={userCount}
        isHost={isHost}
        guestControls={guestControls}
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
          isSyncing={isSyncingRef}
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
                    >
                      <span className="video-item-icon">🎬</span>
                      <span className="video-item-name" title={v.name}>{v.name}</span>
                      <span className="video-item-size">{formatSize(v.size)}</span>
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
