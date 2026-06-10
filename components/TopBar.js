'use client';

export default function TopBar({
  roomId,
  userCount,
  isHost,
  guestControls,
  videoName,
  onToggleGuestControls,
  onShareClick,
  onCopyRoomId,
}) {
  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="topbar-logo">🎬 Watch Party</div>
        <span
          className="room-code"
          onClick={onCopyRoomId}
          title="Click to copy room code"
        >
          Room: {roomId || '------'}
        </span>
      </div>

      {/* Center — video name */}
      {videoName ? (
        <h2 className="topbar-video-name" title={videoName}>
          ▶ {videoName}
        </h2>
      ) : (
        <div />
      )}

      <div className="topbar-right">
        {/* Guest controls toggle — host only */}
        {isHost && (
          <div
            className="guest-controls-toggle"
            onClick={onToggleGuestControls}
            title={guestControls ? 'Guests CAN control playback' : 'Only host controls playback'}
          >
            <span>{guestControls ? '🎮' : '🔒'} Guest Controls</span>
            <div className={`toggle-switch ${guestControls ? 'active' : ''}`} />
          </div>
        )}

        <div className="badge">
          <span className="badge-dot" />
          <span>{userCount}</span> watching
        </div>

        <div className={`badge ${isHost ? 'badge-host' : 'badge-guest'}`}>
          {isHost ? '👑 Host' : '👁 Guest'}
        </div>

        <button className="btn-icon" onClick={onShareClick}>
          🔗 Share
        </button>
      </div>
    </div>
  );
}
