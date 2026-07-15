'use client';

import { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, Maximize2, Sparkles, Loader2, HelpCircle, ShieldAlert } from 'lucide-react';
import { formatTime } from '../lib/utils';
import EmojiReactions, { useEmojiSpawner } from './EmojiReactions';
import GuestRequestModal from './GuestRequestModal';
import Hls from 'hls.js';

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

const VideoPlayer = forwardRef(function VideoPlayer({
  videoUrl,
  isHost,
  guestControls,
  canControl,
  onPlay,
  onPause,
  onSeek,
  onLoadedMetadata,
  onHostBuffering,
  fullscreenNotifications = [],
  onRequestAction,
  guestRequests = [],
  onApproveRequest,
  onRejectRequest,
}, ref) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const scrubberRef = useRef(null);
  const skipRef = useRef(null);
  const playStateRef = useRef(null);
  const hlsRef = useRef(null);

  // Preview thumbnail refs
  const previewVideoRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const previewDebounceRef = useRef(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [tooltipTime, setTooltipTime] = useState('0:00');
  const [tooltipLeft, setTooltipLeft] = useState(0);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isFakeFullscreen, setIsFakeFullscreen] = useState(false);
  const [areControlsVisible, setAreControlsVisible] = useState(true);
  const controlsTimeoutRef = useRef(null);
  const [requestSentFlash, setRequestSentFlash] = useState(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);

  // Preview thumbnail state
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewLeft, setPreviewLeft] = useState(0);
  const [previewReady, setPreviewReady] = useState(false);

  const scrubDownRef = useRef(false);
  const spawnEmoji = useEmojiSpawner(canvasRef);

  // Stable refs for props that change frequently
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

  const playingRef = useRef(playing);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  const programmaticPlayCountRef = useRef(0);
  const programmaticPauseCountRef = useRef(0);
  const programmaticSeekCountRef = useRef(0);

  const [hostBuffering, setHostBufferingState] = useState(false);
  const hostBufferingRef = useRef(false);
  useEffect(() => { hostBufferingRef.current = hostBuffering; }, [hostBuffering]);

  // Fullscreen detection
  useEffect(() => {
    function handleFullscreenChange() {
      const nativeFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      setIsFullscreen(nativeFs);
      if (!nativeFs) {
        setIsFakeFullscreen(false);
      }
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  const resetControlsTimeout = useCallback(() => {
    setAreControlsVisible(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    if (isFullscreen || isFakeFullscreen) {
      controlsTimeoutRef.current = setTimeout(() => {
        setAreControlsVisible(false);
      }, 3000);
    }
  }, [isFullscreen, isFakeFullscreen]);

  useEffect(() => {
    resetControlsTimeout();
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [isFullscreen, isFakeFullscreen, resetControlsTimeout]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && isFakeFullscreen) {
        const panel = document.querySelector('.video-panel');
        if (panel) {
          panel.classList.remove('is-fake-fullscreen');
        }
        setIsFakeFullscreen(false);
        setIsFullscreen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFakeFullscreen]);

  const attemptPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    programmaticPlayCountRef.current += 1;
    video.play().catch((err) => {
      programmaticPlayCountRef.current = Math.max(0, programmaticPlayCountRef.current - 1);
      console.warn('[VideoPlayer] Playback blocked by browser policy, retrying muted:', err);

      video.muted = true;
      setMuted(true);

      programmaticPlayCountRef.current += 1;
      video.play().catch((err2) => {
        programmaticPlayCountRef.current = Math.max(0, programmaticPlayCountRef.current - 1);
        console.error('[VideoPlayer] Muted playback also failed:', err2);
      });
    });
  }, []);

  useImperativeHandle(ref, () => ({
    play: () => {
      if (videoRef.current) {
        if (videoRef.current.paused) {
          attemptPlay();
        }
      }
    },
    pause: () => {
      if (videoRef.current) {
        if (!videoRef.current.paused) {
          programmaticPauseCountRef.current += 1;
          videoRef.current.pause();
        }
      }
    },
    seek: (time) => {
      if (videoRef.current) {
        programmaticSeekCountRef.current += 1;
        videoRef.current.currentTime = time;
      }
    },
    setHostBuffering: (buffering) => {
      setHostBufferingState(buffering);
    },
    getCurrentTime: () => videoRef.current?.currentTime || 0,
    getVideo: () => videoRef.current,
    spawnEmoji,
  }));

  // Video event handlers
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function handlePlay() {
      if (programmaticPlayCountRef.current > 0) {
        setPlaying(true);
        showPlayState(true);
        programmaticPlayCountRef.current -= 1;
        return;
      }
      setPlaying(true);
      showPlayState(true);
      if (canControlRef.current) {
        onPlayRef.current(video.currentTime);
      }
    }

    function handlePause() {
      if (programmaticPauseCountRef.current > 0) {
        setPlaying(false);
        showPlayState(false);
        programmaticPauseCountRef.current -= 1;
        return;
      }
      if (video.seeking) {
        return;
      }
      if (hostBufferingRef.current) {
        return;
      }
      setPlaying(false);
      showPlayState(false);
      if (canControlRef.current) {
        onPauseRef.current(video.currentTime);
      }
    }

    function handleSeeked() {
      setIsBuffering(false);
      if (isHost) {
        onHostBufferingRef.current(false);
      }
      if (playingRef.current && video.paused) {
        attemptPlay();
      }
      if (programmaticSeekCountRef.current > 0) {
        programmaticSeekCountRef.current -= 1;
        return;
      }
      if (canControlRef.current) {
        onSeekRef.current(video.currentTime);
      }
    }

    function handleTimeUpdate() {
      if (!scrubDownRef.current) {
        setCurrentTime(video.currentTime);
      }
    }

    // Explicitly declare loaded metadata to parent
    function handleLoadedMetadata() {
      setDuration(video.duration);
      if (onLoadedMetadata) {
        onLoadedMetadata();
      }
    }

    function handleProgress() {
      if (!video.duration) return;
      const b = video.buffered;
      if (b.length) {
        setBuffered((b.end(b.length - 1) / video.duration) * 100);
      }
    }

    function handleWaiting() {
      setIsBuffering(true);
      if (isHost) {
        onHostBufferingRef.current(true);
      }
    }
    function handlePlaying() {
      setIsBuffering(false);
      if (isHost) {
        onHostBufferingRef.current(false);
      }
    }
    function handleCanPlay() {
      setIsBuffering(false);
      if (isHost) {
        onHostBufferingRef.current(false);
      }
    }
    function handleError() {
      setIsBuffering(false);
      if (isHost) {
        onHostBufferingRef.current(false);
      }
    }

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('progress', handleProgress);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('progress', handleProgress);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('error', handleError);
    };
  }, [isHost]);

  // Load video (with HLS support)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHLS = videoUrl.endsWith('.m3u8');

    if (isHLS && Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: 90,
        maxMaxBufferLength: 120,
        backBufferLength: 300,
        startLevel: -1,
        enableWorker: true,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 1000,
        fragLoadingMaxRetryDelay: 8000,
      });
      hlsRef.current = hls;
      hls.loadSource(videoUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('[HLS] Manifest parsed, ready to play');
      });
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.error('[HLS] Fatal error:', data.type, data.details);
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          }
        }
      });
    } else if (isHLS && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = videoUrl;
      video.load();
    } else {
      video.src = videoUrl;
      video.load();
    }

    setCurrentTime(0);
    setBuffered(0);
    setPlaying(false);

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [videoUrl]);

  // Load preview video for thumbnails
  useEffect(() => {
    if (!videoUrl) {
      setPreviewReady(false);
      return;
    }
    const previewVideo = document.createElement('video');
    previewVideo.preload = 'metadata';
    previewVideo.muted = true;
    previewVideo.playsInline = true;
    previewVideo.src = videoUrl;
    previewVideo.crossOrigin = 'anonymous';
    previewVideoRef.current = previewVideo;

    // 'loadeddata' — 'canplaythrough' often never fires with preload="metadata",
    // which would leave hover previews permanently disabled
    function handleLoadedData() {
      setPreviewReady(true);
    }
    previewVideo.addEventListener('loadeddata', handleLoadedData);
    return () => {
      previewVideo.removeEventListener('loadeddata', handleLoadedData);
      previewVideo.pause();
      previewVideo.removeAttribute('src');
      previewVideo.load();
      previewVideoRef.current = null;
      setPreviewReady(false);
    };
  }, [videoUrl]);

  // Pause guests while the host buffers; resume when the host recovers.
  // handlePause skips the broadcast while hostBuffering is set, so this stays local.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (hostBuffering) {
      video.pause();
    } else if (playingRef.current && video.paused) {
      attemptPlay();
    }
  }, [hostBuffering, attemptPlay]);

  // Keyboard shortcuts: Space play/pause, ←/→ skip, M mute, F fullscreen.
  // Control handlers already fall back to guest requests when !canControl.
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
  }, [isFakeFullscreen, videoUrl]); // re-bind so toggleFullscreen sees current fake-fs state

  // Handle Play/Pause toggles.
  // Raw play()/pause() on purpose — the resulting events reach handlePlay/handlePause
  // unsuppressed, which is what broadcasts the action to the room. Marking these
  // programmatic would silence the sync.
  function togglePlay() {
    if (!canControlRef.current) {
      if (onRequestActionRef.current) {
        const video = videoRef.current;
        onRequestActionRef.current(video && !video.paused ? 'pause' : 'play');
        flashRequestSent();
      }
      return;
    }
    if (!videoUrl) return;
    const video = videoRef.current;
    if (!video) return;
    video.paused ? video.play().catch(() => {}) : video.pause();
  }

  // Handle volume controls
  function handleVolumeChange(val) {
    const v = parseFloat(val);
    setVolume(v);
    const video = videoRef.current;
    if (video) {
      video.volume = v;
      video.muted = v === 0;
      setMuted(v === 0);
    }
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    const newMute = !video.muted;
    video.muted = newMute;
    setMuted(newMute);
  }

  // Fullscreen routines
  function toggleFullscreen() {
    const panel = document.querySelector('.video-panel');
    if (!panel) return;

    // Fake fullscreen active → this toggle exits it (native path would no-op here
    // since document.fullscreenElement is null in fake mode)
    if (isFakeFullscreen) {
      panel.classList.remove('is-fake-fullscreen');
      setIsFakeFullscreen(false);
      setIsFullscreen(false);
      return;
    }

    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
      setIsFullscreen(false);
    } else {
      const requestFs = panel.requestFullscreen || panel.webkitRequestFullscreen;
      if (requestFs) {
        requestFs.call(panel).then(() => {
          setIsFullscreen(true);
        }).catch(() => {
          setIsFakeFullscreen(true);
          setIsFullscreen(true);
          panel.classList.add('is-fake-fullscreen');
        });
      } else {
        setIsFakeFullscreen(true);
        setIsFullscreen(true);
        panel.classList.add('is-fake-fullscreen');
      }
    }
  }

  // Skip offsets. Seeks stay unsuppressed so the 'seeked' handler broadcasts them.
  // Guests without control send a request to the host instead.
  function skipBack() {
    if (!canControlRef.current) {
      if (onRequestActionRef.current) {
        onRequestActionRef.current('seek-backward');
        flashRequestSent();
      }
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, video.currentTime - 10);
    flashSkipIndicator('-10s');
  }

  function skipForward() {
    if (!canControlRef.current) {
      if (onRequestActionRef.current) {
        onRequestActionRef.current('seek-forward');
        flashRequestSent();
      }
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
    flashSkipIndicator('+10s');
  }

  // Scrubber calculations. Drag is tracked on document so releasing outside the
  // bar still ends the scrub; the seek stays unsuppressed so 'seeked' broadcasts it.
  function handleScrubberMouseDown(e) {
    if (!canControlRef.current || !videoUrl || !videoRef.current) return;
    scrubDownRef.current = true;
    setIsScrubbing(true);
    resetControlsTimeout();
    seekFromEvent(e);

    const onMove = (ev) => seekFromEvent(ev);
    const onUp = () => {
      scrubDownRef.current = false;
      setIsScrubbing(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function seekFromEvent(e) {
    const rect = scrubberRef.current?.getBoundingClientRect();
    const video = videoRef.current;
    if (!rect || !video || !video.duration) return;
    const pos = (e.clientX - rect.left) / rect.width;
    const pct = Math.max(0, Math.min(1, pos));
    const time = pct * video.duration;
    setCurrentTime(time);
    video.currentTime = time;
  }

  function handleScrubberMouseMove(e) {
    if (!duration || !scrubberRef.current) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const pct = Math.max(0, Math.min(1, pos));
    const time = pct * duration;

    setTooltipTime(formatTime(time));
    setTooltipLeft(pct * 100);
    setTooltipVisible(true);

    if (previewReady) {
      setPreviewLeft(pct * 100);
      setPreviewVisible(true);
      renderPreviewThumbnail(time);
    }
  }

  function handleScrubberMouseLeave() {
    setTooltipVisible(false);
    setPreviewVisible(false);
  }

  // Render thumbnail previews on scrubbing hover
  const renderPreviewThumbnail = useCallback((time) => {
    if (previewDebounceRef.current) {
      cancelAnimationFrame(previewDebounceRef.current);
    }

    previewDebounceRef.current = requestAnimationFrame(() => {
      const previewVideo = previewVideoRef.current;
      const previewCanvas = previewCanvasRef.current;
      if (!previewVideo || !previewCanvas) return;

      previewVideo.currentTime = time;

      const seekHandler = () => {
        const ctx = previewCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(previewVideo, 0, 0, 160, 90);
        }
        previewVideo.removeEventListener('seeked', seekHandler);
      };
      previewVideo.addEventListener('seeked', seekHandler);
    });
  }, [previewReady]);

  // Flash UI indications
  function flashPlayState(isPlay) {
    const el = playStateRef.current;
    if (!el) return;
    el.textContent = isPlay ? '▶' : '⏸';
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%, -50%) scale(1.5)';
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translate(-50%, -50%) scale(1)';
    }, 500);
  }

  function showPlayState(isPlay) {
    flashPlayState(isPlay);
  }

  function flashSkipIndicator(text) {
    const el = skipRef.current;
    if (!el) return;
    el.textContent = text;
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%, -50%) scale(1.3)';
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translate(-50%, -50%) scale(1)';
    }, 450);
  }

  function flashRequestSent() {
    const id = Date.now();
    setRequestSentFlash(id);
    setTimeout(() => setRequestSentFlash(null), 1800);
  }

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div 
      className="video-panel relative w-full h-full bg-black flex items-center justify-center group overflow-hidden select-none"
      onMouseMove={resetControlsTimeout}
    >
      {/* Actual HTML Video */}
      <video
        ref={videoRef}
        className="w-full h-full max-h-full object-contain cursor-pointer"
        playsInline
        preload="metadata"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
      />

      {/* Floating Emoji Canvas */}
      <EmojiReactions canvasRef={canvasRef} />

      {/* Buffering Indicator */}
      {(isBuffering || hostBuffering) && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-20 pointer-events-none transition-opacity duration-200">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 text-violet-500 animate-spin" />
            {hostBuffering && (
              <span className="text-xs text-zinc-400 bg-zinc-950/70 px-3 py-1 rounded-full border border-zinc-900 font-medium">
                Waiting for host buffering...
              </span>
            )}
          </div>
        </div>
      )}

      {/* Custom indicators */}
      <div 
        ref={playStateRef} 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none text-white text-5xl bg-zinc-950/70 w-20 h-20 rounded-full flex items-center justify-center opacity-0 scale-100 transition-all duration-300 z-30" 
      />
      
      <div 
        ref={skipRef} 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none text-white text-3xl bg-zinc-950/70 px-6 py-3 rounded-full opacity-0 scale-100 transition-all duration-300 z-30 font-bold" 
      />

      {/* Request flashing banner */}
      {requestSentFlash && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-violet-600/90 border border-violet-500 rounded-xl text-xs font-semibold text-white shadow-2xl z-30 animate-bounce">
          🙋 Request sent to host
        </div>
      )}

      {/* Guest Lock Screen */}
      {!canControl && (
        <div
          title="Click to request control from host"
          onClick={() => {
            if (onRequestActionRef.current) {
              const video = videoRef.current;
              onRequestActionRef.current(video && !video.paused ? 'pause' : 'play');
              flashRequestSent();
            }
          }}
          className="absolute inset-0 bg-transparent cursor-pointer z-20"
        />
      )}

      {/* Fullscreen Notifications stack */}
      {isFullscreen && fullscreenNotifications.length > 0 && (
        <div className="absolute top-6 left-6 flex flex-col gap-2 z-40 max-w-sm">
          {fullscreenNotifications.map((notif) => (
            <div
              key={notif.id}
              className={`p-3 rounded-xl backdrop-blur-md border flex items-start gap-2.5 shadow-2xl transition-all duration-300 ${
                notif.exiting 
                  ? 'opacity-0 -translate-x-8' 
                  : 'opacity-100 translate-x-0'
              } ${
                notif.isSystem 
                  ? 'bg-zinc-950/80 border-zinc-900 text-zinc-400 text-[11px]' 
                  : 'bg-violet-950/80 border-violet-900/40 text-white text-xs'
              }`}
            >
              <span className="text-sm mt-0.5">{notif.isSystem ? '🔔' : '💬'}</span>
              <div className="flex flex-col min-w-0">
                {notif.sender && !notif.isSystem && (
                  <span className="font-extrabold text-[10px] text-violet-400 uppercase tracking-wider">{notif.sender}</span>
                )}
                <span className="leading-snug break-words">{notif.message}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Guest Request Modal popups inside fullscreen */}
      {isHost && isFullscreen && guestRequests.length > 0 && (
        <div className="absolute bottom-24 right-6 z-50">
          <GuestRequestModal
            requests={guestRequests}
            onApprove={onApproveRequest}
            onReject={onRejectRequest}
          />
        </div>
      )}

      {/* Empty placeholder */}
      {!videoUrl && (
        <div className="absolute inset-0 bg-[#07070a] flex flex-col items-center justify-center gap-4 text-center z-10 p-6 select-none">
          <div className="w-16 h-16 rounded-3xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-2 shadow-inner text-2xl">
            🎬
          </div>
          <div>
            <h3 className="text-base font-bold text-white">No video selected</h3>
            <p className="text-xs text-zinc-500 max-w-[280px] leading-relaxed mt-1 mx-auto">
              {isHost
                ? 'Select a video from the Videos tab on the right to start playing'
                : 'Waiting for the host to select a video file...'}
            </p>
          </div>
        </div>
      )}

      {/* Control Overlay Bar */}
      <div 
        className={`absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 via-black/40 to-transparent flex flex-col gap-3 transition-opacity duration-300 z-40 ${
          areControlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Scrubber progress */}
        <div
          ref={scrubberRef}
          onMouseDown={handleScrubberMouseDown}
          onMouseMove={handleScrubberMouseMove}
          onMouseLeave={handleScrubberMouseLeave}
          className="w-full h-4 flex items-center cursor-pointer group/scrub relative"
        >
          <div className="w-full h-1 bg-zinc-800/80 rounded-full group-hover/scrub:h-1.5 transition-all relative overflow-hidden">
            {/* Buffered progress */}
            <div className="absolute top-0 bottom-0 left-0 bg-zinc-700/60 transition-all duration-150" style={{ width: buffered + '%' }} />
            {/* Playing progress */}
            <div className="absolute top-0 bottom-0 left-0 bg-violet-600 rounded-full" style={{ width: progressPct + '%' }} />
          </div>
          {/* Thumb marker */}
          <div 
            className="absolute w-3 h-3 rounded-full bg-white scale-0 group-hover/scrub:scale-100 transition-transform -translate-x-1.5"
            style={{ left: progressPct + '%' }}
          />

          {/* Hover preview canvases */}
          {previewReady && (
            <div
              className={`absolute bottom-full mb-2 bg-zinc-950 border border-zinc-800 p-1 rounded-xl shadow-2xl flex flex-col items-center gap-1.5 pointer-events-none transition-all duration-150 -translate-x-1/2 ${
                previewVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-95'
              }`}
              style={{ left: previewLeft + '%' }}
            >
              <canvas ref={previewCanvasRef} width="160" height="90" className="rounded-lg object-cover bg-black" />
              <span className="text-[10px] font-bold font-mono text-zinc-300">{tooltipTime}</span>
            </div>
          )}

          {/* Fallback simple tooltip */}
          {!previewReady && tooltipVisible && (
            <div
              className="absolute bottom-full mb-2 px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-[10px] font-bold font-mono text-zinc-300 -translate-x-1/2"
              style={{ left: tooltipLeft + '%' }}
            >
              {tooltipTime}
            </div>
          )}
        </div>

        {/* Buttons Control Row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Back 10s */}
            <button
              onClick={skipBack}
              className="p-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 active:scale-90 transition-all cursor-pointer"
              title={canControl ? 'Back 10s' : 'Request skip back from host'}
            >
              <RotateCcw className="w-5 h-5" />
            </button>

            {/* Play/Pause Button */}
            <button 
              onClick={togglePlay}
              className="p-2 rounded-full bg-white text-zinc-950 hover:scale-105 active:scale-95 transition-all cursor-pointer"
              title="Play / Pause"
            >
              {playing ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </button>

            {/* Forward 10s */}
            <button
              onClick={skipForward}
              className="p-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 active:scale-90 transition-all cursor-pointer"
              title={canControl ? 'Forward 10s' : 'Request skip forward from host'}
            >
              <RotateCw className="w-5 h-5" />
            </button>

            {/* Volume controller */}
            <div className="flex items-center gap-2 group/volume pl-1 relative">
              <button 
                onClick={toggleMute}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Mute"
              >
                {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
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

            {/* Time code display */}
            <span className="text-[11px] font-mono font-semibold text-zinc-400 ml-1">
              {formatTime(currentTime)} <span className="text-zinc-600">/</span> {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Speed Adjuster */}
            <div className="relative">
              <button
                onClick={() => setSpeedMenuOpen(!speedMenuOpen)}
                className="px-2.5 py-1 rounded-lg text-xs font-bold text-zinc-300 hover:text-white border border-zinc-800 hover:border-zinc-700 bg-zinc-950/80 cursor-pointer transition-all"
                title="Playback Speed"
              >
                {playbackRate}x
              </button>
              {speedMenuOpen && (
                <div className="absolute bottom-full right-0 mb-2 w-20 py-1 bg-zinc-950 border border-zinc-900 rounded-xl shadow-2xl flex flex-col gap-0.5 z-[60]">
                  {SPEED_OPTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => {
                        setPlaybackRate(s);
                        const video = videoRef.current;
                        if (video) video.playbackRate = s;
                        setSpeedMenuOpen(false);
                      }}
                      className={`w-full py-1.5 text-center text-xs transition-colors cursor-pointer ${
                        playbackRate === s 
                          ? 'bg-violet-600 text-white font-extrabold' 
                          : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Fullscreen Button */}
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
    </div>
  );
});

export default VideoPlayer;
