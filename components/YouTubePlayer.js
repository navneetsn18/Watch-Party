'use client';

import { useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Loader2 } from 'lucide-react';
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

// Same imperative interface as VideoPlayer, driving a YouTube embed instead of
// a <video> element. Sync rules are identical: user actions broadcast, remote
// commands are counted as "programmatic" so they don't echo back into the room.
const YouTubePlayer = forwardRef(function YouTubePlayer({
  videoId,
  isHost,
  canControl,
  onPlay,
  onPause,
  onSeek,
  onLoadedMetadata,
  onHostBuffering,
  onRequestAction,
}, ref) {
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

  const spawnEmoji = useEmojiSpawner(canvasRef);

  const canControlRef = useRef(canControl);
  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onSeekRef = useRef(onSeek);
  const onHostBufferingRef = useRef(onHostBuffering);
  const onRequestActionRef = useRef(onRequestAction);
  useEffect(() => { canControlRef.current = canControl; }, [canControl]);
  useEffect(() => { onPlayRef.current = onPlay; }, [onPlay]);
  useEffect(() => { onPauseRef.current = onPause; }, [onPause]);
  useEffect(() => { onSeekRef.current = onSeek; }, [onSeek]);
  useEffect(() => { onHostBufferingRef.current = onHostBuffering; }, [onHostBuffering]);
  useEffect(() => { onRequestActionRef.current = onRequestAction; }, [onRequestAction]);

  function currentTime() {
    try { return playerRef.current?.getCurrentTime?.() || 0; } catch { return 0; }
  }

  // Create / destroy the player when videoId changes
  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    readyRef.current = false;
    setIsReady(false);
    setLoadError('');

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
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            readyRef.current = true;
            setIsReady(true);
            lastTimeRef.current = 0;
            lastPollWallRef.current = Date.now();
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
          onStateChange: (e) => {
            if (cancelled) return;
            const S = YT.PlayerState;
            if (e.data === S.PLAYING) {
              playingRef.current = true;
              lastTimeRef.current = currentTime();
              lastPollWallRef.current = Date.now();
              if (isHost) onHostBufferingRef.current?.(false);
              if (suppressPlayRef.current > 0) {
                suppressPlayRef.current -= 1;
                return;
              }
              if (canControlRef.current) onPlayRef.current?.(currentTime());
            } else if (e.data === S.PAUSED || e.data === S.ENDED) {
              playingRef.current = false;
              if (suppressPauseRef.current > 0) {
                suppressPauseRef.current -= 1;
                return;
              }
              if (canControlRef.current) onPauseRef.current?.(currentTime());
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

  // Seek detection: YouTube has no seek event, so poll for time jumps the
  // normal passage of time can't explain.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!readyRef.current) return;
      const now = Date.now();
      const cur = currentTime();
      const elapsed = (now - lastPollWallRef.current) / 1000;
      const expected = playingRef.current ? lastTimeRef.current + elapsed : lastTimeRef.current;
      const jumped = Math.abs(cur - expected) > 1.5;
      lastTimeRef.current = cur;
      lastPollWallRef.current = now;
      if (!jumped) return;
      if (suppressSeekRef.current > 0) {
        suppressSeekRef.current -= 1;
        return;
      }
      if (canControlRef.current) onSeekRef.current?.(cur);
    }, 500);
    return () => clearInterval(interval);
  }, []);

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

  useImperativeHandle(ref, () => ({
    play: () => {
      const p = playerRef.current;
      if (!p || !readyRef.current || playingRef.current) return;
      suppressPlayRef.current += 1;
      try { p.playVideo(); } catch {}
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
    getCurrentTime: () => currentTime(),
    // Shim so the room page's readyState/paused/currentTime checks work
    // unchanged against a YouTube player.
    getVideo: () => {
      if (!readyRef.current) return null;
      return {
        readyState: 4,
        get paused() { return !playingRef.current; },
        get currentTime() { return currentTime(); },
        get seeking() { return false; },
      };
    },
    spawnEmoji,
  }));

  return (
    <div className="video-panel relative w-full h-full bg-black flex items-center justify-center overflow-hidden select-none">
      {/* YouTube iframe mounts here */}
      <div ref={containerRef} className="absolute inset-0 [&>iframe]:w-full [&>iframe]:h-full" />

      <EmojiReactions canvasRef={canvasRef} />

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
        <div className="absolute top-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-violet-600/90 border border-violet-500 rounded-xl text-xs font-semibold text-white shadow-2xl z-30 animate-bounce">
          🙋 Request sent to host
        </div>
      )}

      {/* Guest lock — blocks the iframe's native controls for locked guests */}
      {!canControl && (
        <div
          title="Click to request control from host"
          onClick={() => {
            if (onRequestActionRef.current) {
              onRequestActionRef.current(playingRef.current ? 'pause' : 'play');
              flashRequestSent();
            }
          }}
          className="absolute inset-0 bg-transparent cursor-pointer z-20"
        />
      )}
    </div>
  );
});

export default YouTubePlayer;
