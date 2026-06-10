'use client';

import { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { formatTime } from '../lib/utils';
import EmojiReactions, { useEmojiSpawner } from './EmojiReactions';

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
}, ref) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const scrubberRef = useRef(null);
  const skipRef = useRef(null);
  const playStateRef = useRef(null);

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

  const scrubDownRef = useRef(false);
  const spawnEmoji = useEmojiSpawner(canvasRef);

  // Stable refs for props that change frequently
  const canControlRef = useRef(canControl);
  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onSeekRef = useRef(onSeek);
  const onHostBufferingRef = useRef(onHostBuffering);

  useEffect(() => { canControlRef.current = canControl; }, [canControl]);
  useEffect(() => { onPlayRef.current = onPlay; }, [onPlay]);
  useEffect(() => { onPauseRef.current = onPause; }, [onPause]);
  useEffect(() => { onSeekRef.current = onSeek; }, [onSeek]);
  useEffect(() => { onHostBufferingRef.current = onHostBuffering; }, [onHostBuffering]);

  const programmaticPlayCountRef = useRef(0);
  const programmaticPauseCountRef = useRef(0);
  const programmaticSeekCountRef = useRef(0);

  const [hostBuffering, setHostBufferingState] = useState(false);
  const hostBufferingRef = useRef(false);
  useEffect(() => { hostBufferingRef.current = hostBuffering; }, [hostBuffering]);

  useImperativeHandle(ref, () => ({
    play: () => {
      if (videoRef.current) {
        programmaticPlayCountRef.current += 1;
        videoRef.current.play().catch(() => {});
      }
    },
    pause: () => {
      if (videoRef.current) {
        programmaticPauseCountRef.current += 1;
        videoRef.current.pause();
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

  // ── Video event handlers (stable — uses refs) ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function handlePlay() {
      setPlaying(true);
      showPlayState(true);
      if (programmaticPlayCountRef.current > 0) {
        programmaticPlayCountRef.current -= 1;
        return;
      }
      if (canControlRef.current) {
        onPlayRef.current(video.currentTime);
      }
    }

    function handlePause() {
      if (hostBufferingRef.current) {
        return;
      }
      setPlaying(false);
      showPlayState(false);
      if (programmaticPauseCountRef.current > 0) {
        programmaticPauseCountRef.current -= 1;
        return;
      }
      if (canControlRef.current) {
        onPauseRef.current(video.currentTime);
      }
    }

    function handleSeeked() {
      setIsBuffering(false);
      if (isHost) {
        onHostBufferingRef.current(false);
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
  }, [isHost]); // only isSyncing ref identity (stable)

  // ── Load video ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    video.src = videoUrl;
    video.load();
    setCurrentTime(0);
    setBuffered(0);
    setPlaying(false);
  }, [videoUrl]);

  // Sync playback with host buffering state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (hostBuffering) {
      video.pause();
    } else {
      if (playing) {
        video.play().catch(() => {});
      }
    }
  }, [hostBuffering, playing]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    function handleKeyDown(e) {
      const tag = document.activeElement?.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          if (canControlRef.current) togglePlay();
          break;
        case 'ArrowRight':
          if (canControlRef.current) skipForward();
          break;
        case 'ArrowLeft':
          if (canControlRef.current) skipBack();
          break;
        case 'KeyM':
          toggleMute();
          break;
        case 'KeyF':
          toggleFullscreen();
          break;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []); // stable — uses refs

  // ── Controls ──
  function togglePlay() {
    if (!canControlRef.current) return;
    const video = videoRef.current;
    if (!video) return;
    video.paused ? video.play().catch(() => {}) : video.pause();
  }

  function skipForward() {
    if (!canControlRef.current) return;
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
    onSeekRef.current(video.currentTime);
    flashSkip('+10');
  }

  function skipBack() {
    if (!canControlRef.current) return;
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, video.currentTime - 10);
    onSeekRef.current(video.currentTime);
    flashSkip('−10');
  }

  function flashSkip(label) {
    const el = skipRef.current;
    if (!el) return;
    el.textContent = label + 's';
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 700);
  }

  function showPlayState(isPlaying) {
    const el = playStateRef.current;
    if (!el) return;
    el.innerHTML = isPlaying
      ? '<svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><path d="M8 5v14l11-7z"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>';
    el.classList.remove('animate');
    // Force reflow
    void el.offsetWidth;
    el.classList.add('animate');
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }

  function handleVolumeChange(value) {
    const video = videoRef.current;
    if (!video) return;
    video.volume = parseFloat(value);
    video.muted = false;
    setVolume(parseFloat(value));
    setMuted(false);
  }

  function toggleFullscreen() {
    const panel = document.querySelector('.video-panel');
    if (!panel) return;
    if (!document.fullscreenElement) {
      panel.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  }

  // ── Scrubber ──
  function handleScrubberMouseDown(e) {
    if (!canControlRef.current) return;
    scrubDownRef.current = true;
    setIsScrubbing(true);
    applyScrub(e);

    function onMouseMove(ev) { applyScrub(ev); }
    function onMouseUp() {
      scrubDownRef.current = false;
      setIsScrubbing(false);
      if (canControlRef.current) onSeekRef.current(videoRef.current?.currentTime || 0);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function applyScrub(e) {
    const video = videoRef.current;
    const scrubber = scrubberRef.current;
    if (!video || !scrubber || !video.duration) return;
    const rect = scrubber.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = pct * video.duration;
    video.currentTime = time;
    setCurrentTime(time);
  }

  function handleScrubberMouseMove(e) {
    const video = videoRef.current;
    const scrubber = scrubberRef.current;
    if (!video || !scrubber) return;
    const rect = scrubber.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setTooltipTime(formatTime(pct * (video.duration || 0)));
    setTooltipLeft(pct * 100);
    setTooltipVisible(true);
  }

  function handleScrubberMouseLeave() {
    setTooltipVisible(false);
  }

  // Progress values
  const progressPct = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="video-panel">
      <div
        className="video-wrapper"
        onDoubleClick={toggleFullscreen}
      >
        <EmojiReactions canvasRef={canvasRef} />

        {/* Buffering spinner */}
        {(isBuffering || hostBuffering) && (
          <div className="buffering-overlay">
            <div className="spinner" />
          </div>
        )}

        {/* Play state overlay */}
        <div className="play-state-overlay" ref={playStateRef} />

        {/* Skip indicator */}
        <div className="skip-indicator" ref={skipRef} />

        {/* Guest lock overlay — only blocks the video, NOT the sidebar */}
        {!canControl && (
          <div className="guest-lock-overlay active" title="Only host can control playback" />
        )}

        {/* No video placeholder */}
        {!videoUrl && (
          <div className="no-video-placeholder">
            <div className="no-video-icon">🎬</div>
            <div className="no-video-title">No video selected</div>
            <div className="no-video-desc">
              {isHost
                ? 'Select a video from the Videos tab to start watching'
                : 'Waiting for the host to select a video…'}
            </div>
          </div>
        )}

        <video
          ref={videoRef}
          className="video-element"
          preload="metadata"
          style={{ display: videoUrl ? 'block' : 'none' }}
          onClick={canControl ? togglePlay : undefined}
        />
      </div>

      {/* Controls bar */}
      <div className="controls-bar">
        {/* Scrubber */}
        <div
          className="scrubber-wrap"
          ref={scrubberRef}
          onMouseDown={handleScrubberMouseDown}
          onMouseMove={handleScrubberMouseMove}
          onMouseLeave={handleScrubberMouseLeave}
        >
          <div className="scrubber-track">
            <div className="scrubber-buffered" style={{ width: buffered + '%' }} />
            <div className="scrubber-fill" style={{ width: progressPct + '%' }} />
            <div className="scrubber-thumb" style={{ left: progressPct + '%' }} />
          </div>
          <div
            className="scrubber-tooltip"
            style={{
              left: tooltipLeft + '%',
              opacity: tooltipVisible ? 1 : 0,
            }}
          >
            {tooltipTime}
          </div>
        </div>

        {/* Controls row */}
        <div className="ctrl-row">
          {/* Back 10s */}
          <button className="ctrl-btn" onClick={skipBack} title="Back 10s">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
              <text x="9.5" y="16" fontSize="7" fontWeight="bold" fill="currentColor" textAnchor="middle">10</text>
            </svg>
          </button>

          {/* Play/Pause */}
          <button className="ctrl-btn ctrl-btn-play" onClick={togglePlay} title="Play / Pause">
            {playing ? (
              <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6zm8-14v14h4V5z"/>
              </svg>
            ) : (
              <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
            )}
          </button>

          {/* Forward 10s */}
          <button className="ctrl-btn" onClick={skipForward} title="Forward 10s">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8V1l-5 5 5 5V7c3.31 0 6 2.69 6 6z"/>
              <text x="13.5" y="16" fontSize="7" fontWeight="bold" fill="currentColor" textAnchor="middle">10</text>
            </svg>
          </button>

          {/* Volume */}
          <div className="vol-group">
            <button className="ctrl-btn" onClick={toggleMute} title="Mute">
              {muted ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/>
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                </svg>
              )}
            </button>
            <div className="vol-slider-wrap">
              <input
                type="range"
                className="vol-range"
                min="0"
                max="1"
                step="0.02"
                value={muted ? 0 : volume}
                onChange={(e) => handleVolumeChange(e.target.value)}
              />
            </div>
          </div>

          <div className="ctrl-spacer" />

          {/* Time */}
          <span className="time-display">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <div className="ctrl-spacer" />

          {/* Fullscreen */}
          <button className="ctrl-btn" onClick={toggleFullscreen} title="Fullscreen">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
});

export default VideoPlayer;
