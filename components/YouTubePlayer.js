'use client';

import { useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, Maximize2, Loader2, Settings } from 'lucide-react';
import EmojiReactions, { useEmojiSpawner } from './EmojiReactions';

// Load the official IFrame API once per page
let apiPromise = null;
function loadYouTubeAPI() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return apiPromise;
}

const QUALITY_LABELS = { hd1080: '1080p', hd720: '720p', large: '480p', medium: '360p', small: '240p', tiny: '144p', auto: 'Auto' };

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Same imperative interface as VideoPlayer, driving a YouTube embed instead of
// a <video> element. Sync rules: play/pause/seek broadcast (or, when locked,
// send a request); volume/mute/quality/fullscreen are always local and never
// touch the room's synced state — YouTube's native chrome is hidden
// (playerVars.controls=0) so there's nothing left for a locked guest to reach
// that would bypass that split.
const YouTubePlayer = forwardRef(function YouTubePlayer({
  videoId,
  isHost,
  canControl,
  onPlay,
  onPause,
  onSeek,
  onLoadedMetadata,
  onHostBuffering,
  onEnded,
  onRequestAction,
}, ref) {
  const panelRef = useRef(null);
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const playerRef = useRef(null);      // YT.Player instance
  const readyRef = useRef(false);
  const playingRef = useRef(false);
  const lastTimeRef = useRef(0);
  const lastPollWallRef = useRef(0);

  const suppressPlayRef = useRef(0);
  const suppressPauseRef = useRef(0);
  const suppressSeekRef = useRef(0);

  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [requestSentFlash, setRequestSentFlash] = useState(null);
  const [hostBuffering, setHostBufferingState] = useState(false);
  const wasPlayingBeforeBufferRef = useRef(false);

  // UI-only state — never synced
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedFraction, setBufferedFraction] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [availableQualities, setAvailableQualities] = useState([]);
  const [currentQuality, setCurrentQuality] = useState('auto');
  const [isScrubbing, setIsScrubbing] = useState(false);
  const scrubberRef = useRef(null);

  const spawnEmoji = useEmojiSpawner(canvasRef);

  const canControlRef = useRef(canControl);
  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onSeekRef = useRef(onSeek);
  const onHostBufferingRef = useRef(onHostBuffering);
  const onRequestActionRef = useRef(onRequestAction);
  const onEndedRef = useRef(onEnded);
  useEffect(() => { canControlRef.current = canControl; }, [canControl]);
  useEffect(() => { onPlayRef.current = onPlay; }, [onPlay]);
  useEffect(() => { onPauseRef.current = onPause; }, [onPause]);
  useEffect(() => { onSeekRef.current = onSeek; }, [onSeek]);
  useEffect(() => { onHostBufferingRef.current = onHostBuffering; }, [onHostBuffering]);
  useEffect(() => { onRequestActionRef.current = onRequestAction; }, [onRequestAction]);
  useEffect(() => { onEndedRef.current = onEnded; }, [onEnded]);

  function currentTimeSec() {
    try { return playerRef.current?.getCurrentTime?.() || 0; } catch { return 0; }
  }

  // Fullscreen detection
  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      panelRef.current?.requestFullscreen?.();
    }
  }

  // Create / destroy the player when videoId changes
  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    readyRef.current = false;
    setIsReady(false);
    setLoadError('');
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    loadYouTubeAPI().then((YT) => {
      if (cancelled || !containerRef.current) return;
      // The API replaces the div we hand it, so give it a child of ours
      const mount = document.createElement('div');
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(mount);

      playerRef.current = new YT.Player(mount, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          rel: 0,
          playsinline: 1,
          controls: 0, // we render our own bar so volume/quality can stay independent of the room lock
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            readyRef.current = true;
            setIsReady(true);
            lastTimeRef.current = 0;
            lastPollWallRef.current = Date.now();
            try {
              const p = playerRef.current;
              setVolume((p.getVolume?.() ?? 100) / 100);
              setMuted(!!p.isMuted?.());
              setAvailableQualities(p.getAvailableQualityLevels?.() || []);
              setCurrentQuality(p.getPlaybackQuality?.() || 'auto');
            } catch {}
            onLoadedMetadata?.();
          },
          onError: (e) => {
            if (cancelled) return;
            // 101/150 = embedding disabled by the channel
            const msg = (e.data === 101 || e.data === 150)
              ? 'This video does not allow embedding — it only plays on youtube.com (members-only and age-restricted videos always block embeds).'
              : `YouTube player error (code ${e.data})`;
            setLoadError(msg);
          },
          onPlaybackQualityChange: (e) => {
            if (cancelled) return;
            setCurrentQuality(e.data);
          },
          onStateChange: (e) => {
            if (cancelled) return;
            const S = YT.PlayerState;
            if (e.data === S.PLAYING) {
              playingRef.current = true;
              setPlaying(true);
              lastTimeRef.current = currentTimeSec();
              lastPollWallRef.current = Date.now();
              if (isHost) onHostBufferingRef.current?.(false);
              if (suppressPlayRef.current > 0) {
                suppressPlayRef.current -= 1;
                return;
              }
              if (canControlRef.current) onPlayRef.current?.(currentTimeSec());
            } else if (e.data === S.PAUSED) {
              playingRef.current = false;
              setPlaying(false);
              if (suppressPauseRef.current > 0) {
                suppressPauseRef.current -= 1;
                return;
              }
              if (canControlRef.current) onPauseRef.current?.(currentTimeSec());
            } else if (e.data === S.ENDED) {
              playingRef.current = false;
              setPlaying(false);
              // Only the host reports ended (mirrors VideoPlayer) — the
              // server checks room.host on 'video-ended' too, but no need
              // for every guest's player to fire it.
              if (isHost) onEndedRef.current?.();
            } else if (e.data === S.BUFFERING) {
              if (isHost) onHostBufferingRef.current?.(true);
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      try { playerRef.current?.destroy?.(); } catch {}
      playerRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, isHost]);

  // Poll: seek-jump detection (YouTube has no seek event) + UI time/buffer
  // display. canControl gates whether a detected jump broadcasts — it never
  // gates whether the UI shows the current position.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!readyRef.current || isScrubbing) return;
      const p = playerRef.current;
      const now = Date.now();
      const cur = currentTimeSec();
      const elapsed = (now - lastPollWallRef.current) / 1000;
      const expected = playingRef.current ? lastTimeRef.current + elapsed : lastTimeRef.current;
      const jumped = Math.abs(cur - expected) > 1.5;
      lastTimeRef.current = cur;
      lastPollWallRef.current = now;

      setCurrentTime(cur);
      try {
        const d = p?.getDuration?.();
        if (d) setDuration(d);
        const frac = p?.getVideoLoadedFraction?.();
        if (typeof frac === 'number') setBufferedFraction(frac);
      } catch {}

      if (!jumped) return;
      if (suppressSeekRef.current > 0) {
        suppressSeekRef.current -= 1;
        return;
      }
      if (canControlRef.current) onSeekRef.current?.(cur);
    }, 500);
    return () => clearInterval(interval);
  }, [isScrubbing]);

  // Pause guests while the host buffers; resume after
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !readyRef.current) return;
    if (hostBuffering) {
      wasPlayingBeforeBufferRef.current = playingRef.current;
      if (playingRef.current) {
        suppressPauseRef.current += 1;
        try { p.pauseVideo(); } catch {}
      }
    } else if (wasPlayingBeforeBufferRef.current && !playingRef.current) {
      suppressPlayRef.current += 1;
      try { p.playVideo(); } catch {}
    }
  }, [hostBuffering]);

  function flashRequestSent() {
    setRequestSentFlash(Date.now());
    setTimeout(() => setRequestSentFlash(null), 1800);
  }

  // Local user action (this client clicked play/pause) — calls the YT API
  // directly with no suppression, so the resulting onStateChange event
  // flows through normally and broadcasts to the room, exactly as if the
  // user had clicked YouTube's own (now-hidden) native button.
  function togglePlay() {
    const p = playerRef.current;
    if (!p || !readyRef.current) return;
    if (!canControlRef.current) {
      onRequestActionRef.current?.(playingRef.current ? 'pause' : 'play');
      flashRequestSent();
      return;
    }
    try { playingRef.current ? p.pauseVideo() : p.playVideo(); } catch {}
  }

  function seekToLocal(time) {
    const p = playerRef.current;
    if (!p || !readyRef.current || !canControlRef.current) return;
    lastTimeRef.current = time;
    lastPollWallRef.current = Date.now();
    setCurrentTime(time);
    try { p.seekTo(time, true); } catch {}
    onSeekRef.current?.(time);
  }

  function skipBack() {
    if (!canControlRef.current) {
      onRequestActionRef.current?.('seek-backward');
      flashRequestSent();
      return;
    }
    seekToLocal(Math.max(0, currentTimeSec() - 10));
  }

  function skipForward() {
    if (!canControlRef.current) {
      onRequestActionRef.current?.('seek-forward');
      flashRequestSent();
      return;
    }
    seekToLocal(Math.min(duration || Infinity, currentTimeSec() + 10));
  }

  // Space play/pause, arrows skip, M mute, F fullscreen — matches
  // VideoPlayer's shortcuts. togglePlay/skip already fall back to a guest
  // request when locked; mute/fullscreen are always local either way.
  useEffect(() => {
    function handleShortcut(e) {
      const tag = document.activeElement?.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          skipForward();
          break;
        case 'ArrowLeft':
          skipBack();
          break;
        case 'KeyM':
          toggleMute();
          break;
        case 'KeyF':
          toggleFullscreen();
          break;
      }
    }
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  });

  function handleScrubberInteract(e) {
    if (!canControlRef.current) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    seekToLocal(ratio * duration);
  }

  useEffect(() => {
    if (!isScrubbing) return;
    function onMove(e) { handleScrubberInteract(e); }
    function onUp() { setIsScrubbing(false); }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScrubbing, duration]);

  // Volume/mute/quality/fullscreen — always local, never broadcast, never
  // gated by canControl. This is the whole point of hiding YouTube's native
  // chrome: a locked guest still owns these.
  function handleVolumeChange(val) {
    const v = parseFloat(val);
    setVolume(v);
    const p = playerRef.current;
    if (!p) return;
    try {
      p.setVolume(v * 100);
      if (v > 0 && muted) { p.unMute(); setMuted(false); }
    } catch {}
  }

  function toggleMute() {
    const p = playerRef.current;
    if (!p) return;
    try {
      if (muted) { p.unMute(); setMuted(false); } else { p.mute(); setMuted(true); }
    } catch {}
  }

  function handleQualityChange(level) {
    const p = playerRef.current;
    setQualityMenuOpen(false);
    if (!p) return;
    try { p.setPlaybackQuality(level); setCurrentQuality(level); } catch {}
  }

  useImperativeHandle(ref, () => ({
    play: () => {
      const p = playerRef.current;
      if (!p || !readyRef.current || playingRef.current) return;
      suppressPlayRef.current += 1;
      try { p.playVideo(); } catch {}
      // Programmatic play (e.g. auto-advancing to the next queued video) has
      // no fresh user gesture behind it and browsers may block it — mirror
      // VideoPlayer's muted-retry fallback.
      setTimeout(() => {
        if (!playingRef.current) {
          try { p.mute(); p.playVideo(); } catch {}
        }
      }, 1200);
    },
    pause: () => {
      const p = playerRef.current;
      if (!p || !readyRef.current || !playingRef.current) return;
      suppressPauseRef.current += 1;
      try { p.pauseVideo(); } catch {}
    },
    seek: (time) => {
      const p = playerRef.current;
      if (!p || !readyRef.current) return;
      suppressSeekRef.current += 1;
      lastTimeRef.current = time;
      lastPollWallRef.current = Date.now();
      try { p.seekTo(time, true); } catch {}
    },
    setHostBuffering: (buffering) => setHostBufferingState(!!buffering),
    getCurrentTime: () => currentTimeSec(),
    // Shim so the room page's readyState/paused/currentTime checks work
    // unchanged against a YouTube player.
    getVideo: () => {
      if (!readyRef.current) return null;
      return {
        readyState: 4,
        get paused() { return !playingRef.current; },
        get currentTime() { return currentTimeSec(); },
        get seeking() { return false; },
      };
    },
    spawnEmoji,
  }));

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div ref={panelRef} className="video-panel relative w-full h-full bg-black flex flex-col select-none">
      <div className="relative flex-1 overflow-hidden">
        {/* YouTube iframe mounts here */}
        <div ref={containerRef} className="absolute inset-0 [&>iframe]:w-full [&>iframe]:h-full" />

        <EmojiReactions canvasRef={canvasRef} />

        {/* Click-catcher: always on top of the iframe so a locked guest can
            never reach YouTube's (hidden) native play/pause via focus/click,
            and so our own togglePlay drives sync consistently either way. */}
        <div
          title={canControl ? undefined : 'Click to request play/pause from host'}
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
          className="absolute inset-0 bg-transparent cursor-pointer z-10"
        />

        {/* Loading state */}
        {!isReady && !loadError && (
          <div className="absolute inset-0 bg-[#07070a] flex items-center justify-center pointer-events-none">
            <Loader2 className="w-10 h-10 text-violet-500 animate-spin" />
          </div>
        )}

        {/* Embed-blocked / error state */}
        {loadError && (
          <div className="absolute inset-0 bg-[#07070a] flex flex-col items-center justify-center gap-3 text-center p-8">
            <span className="text-3xl">🚫</span>
            <p className="text-sm text-zinc-300 max-w-md leading-relaxed">{loadError}</p>
          </div>
        )}

        {/* Host buffering overlay */}
        {hostBuffering && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-20 pointer-events-none">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-10 h-10 text-violet-500 animate-spin" />
              <span className="text-xs text-zinc-400 bg-zinc-950/70 px-3 py-1 rounded-full border border-zinc-900 font-medium">
                Waiting for host buffering...
              </span>
            </div>
          </div>
        )}

        {/* Request-sent flash */}
        {requestSentFlash && (
          <div className="absolute top-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-violet-600/90 border border-violet-500 rounded-xl text-xs font-semibold text-white shadow-2xl z-30 animate-bounce pointer-events-none">
            🙋 Request sent to host
          </div>
        )}
      </div>

      {/* Custom control bar — play/pause/seek gated by canControl;
          volume/mute/quality/fullscreen are always independent per viewer. */}
      {isReady && !loadError && (
        <div className="relative z-20 flex flex-col gap-2 px-4 py-2.5 bg-zinc-950/90 border-t border-zinc-900">
          <div
            ref={scrubberRef}
            onMouseDown={(e) => { if (canControl) { setIsScrubbing(true); handleScrubberInteract(e); } }}
            className={`relative h-1.5 rounded-full bg-zinc-800 overflow-hidden group ${canControl ? 'cursor-pointer' : 'cursor-not-allowed'}`}
          >
            <div className="absolute inset-y-0 left-0 bg-zinc-700" style={{ width: `${bufferedFraction * 100}%` }} />
            <div className="absolute inset-y-0 left-0 bg-violet-500" style={{ width: `${progressPct}%` }} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={skipBack}
                title={canControl ? 'Back 10s' : 'Request skip back from host'}
                className="p-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 active:scale-90 transition-all cursor-pointer"
              >
                <RotateCcw className="w-[18px] h-[18px]" />
              </button>

              <button
                onClick={togglePlay}
                title={canControl ? (playing ? 'Pause' : 'Play') : 'Request control from host'}
                className="p-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 active:scale-90 transition-all cursor-pointer"
              >
                {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </button>

              <button
                onClick={skipForward}
                title={canControl ? 'Forward 10s' : 'Request skip forward from host'}
                className="p-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 active:scale-90 transition-all cursor-pointer"
              >
                <RotateCw className="w-[18px] h-[18px]" />
              </button>

              <div className="flex items-center gap-2 group/volume">
                <button
                  onClick={toggleMute}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="Mute (independent per viewer)"
                >
                  {muted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
                <div className="w-0 overflow-hidden group-hover/volume:w-20 transition-all duration-300 ease-out flex items-center">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.02"
                    value={muted ? 0 : volume}
                    onChange={(e) => handleVolumeChange(e.target.value)}
                    className="w-16 h-1 rounded-full bg-zinc-700 appearance-none cursor-pointer outline-none accent-white"
                  />
                </div>
              </div>

              <span className="text-[11px] font-mono font-semibold text-zinc-400">
                {formatTime(currentTime)} <span className="text-zinc-600">/</span> {formatTime(duration)}
              </span>
            </div>

            <div className="flex items-center gap-3">
              {availableQualities.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setQualityMenuOpen(!qualityMenuOpen)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-zinc-300 hover:text-white border border-zinc-800 hover:border-zinc-700 bg-zinc-950/80 cursor-pointer transition-all"
                    title="Video quality (independent per viewer)"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    <span>{QUALITY_LABELS[currentQuality] || currentQuality}</span>
                  </button>
                  {qualityMenuOpen && (
                    <div className="absolute bottom-full right-0 mb-2 w-24 py-1 bg-zinc-950 border border-zinc-900 rounded-xl shadow-2xl flex flex-col gap-0.5 z-[60]">
                      {availableQualities.map(q => (
                        <button
                          key={q}
                          onClick={() => handleQualityChange(q)}
                          className={`w-full py-1.5 text-center text-xs transition-colors cursor-pointer ${
                            currentQuality === q ? 'bg-violet-600 text-white font-extrabold' : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
                          }`}
                        >
                          {QUALITY_LABELS[q] || q}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={toggleFullscreen}
                className="p-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Fullscreen"
              >
                <Maximize2 className="w-[18px] h-[18px]" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default YouTubePlayer;
