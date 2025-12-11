import React from "react";

export default function PlayerList({ players = [], scores = {}, hostId = null, roomId = null, currentPlayerId = null, onStartGame = null, gameStarted = false }) {
  const isHost = hostId && currentPlayerId && hostId === currentPlayerId;

  const handleShare = async () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join my CartCulus game!',
          text: `Join my room ${roomId}`,
          url: url,
        });
      } catch (err) {
        console.error('Share failed:', err);
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        alert("Link copied to clipboard!");
      } catch (err) {
        console.error('Clipboard failed:', err);
        alert(`Share this link: ${url}`);
      }
    }
  };

  return (
    <div className="player-list p-2" style={{ width: '100%', background: 'white', borderRadius: 6 }}>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <div>
          <h6 className="mb-0">Player List</h6>
          {roomId && <small className="text-muted" style={{ fontSize: '0.8em' }}>Room ID: {roomId}</small>}
        </div>
        <div className="d-flex gap-2">
          {!gameStarted && roomId && (
            <button className="btn btn-sm btn-outline-primary" onClick={handleShare} title="Share Room Link">
              Share
            </button>
          )}
          {/* Start button visible only to host and only before the match starts */}
          {isHost && players.length >= 2 && !gameStarted && (
            <button className="btn btn-sm btn-success" onClick={() => onStartGame && onStartGame(roomId)}>Start</button>
          )}
        </div>
      </div>
      <ul className="list-unstyled mb-0 d-flex flex-column gap-1">
        {players.map((p) => {
          const isMe = p.playerId === currentPlayerId;
          return (
            <li key={p.playerId} className="d-flex justify-content-between align-items-center">
              <span style={isMe ? { fontStyle: 'italic', color: '#0000ffff' } : {}}>
                {p.name} {p.playerId === hostId ? <strong>(host)</strong> : null}
              </span>
              <span className="text-muted" style={isMe ? { fontStyle: 'italic', color: '#0000ffff' } : {}}>
                {scores[p.playerId] || 0}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
