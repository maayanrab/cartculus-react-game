import React from "react";

export default function PlayerList({ players = [], scores = {}, hostId = null, roomId = null, currentPlayerId = null, onStartGame = null, gameStarted = false }) {
  const isHost = hostId && currentPlayerId && hostId === currentPlayerId;
  return (
    <div className="player-list p-2" style={{ width: '100%', background: 'white', borderRadius: 6 }}>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h6 className="mb-0">Players</h6>
        {/* Start button visible only to host and only before the match starts */}
        {isHost && players.length >= 2 && !gameStarted && (
          <button className="btn btn-sm btn-success" onClick={() => onStartGame && onStartGame(roomId)}>Start</button>
        )}
      </div>
      <ul className="list-unstyled mb-0 d-flex flex-column gap-1">
        {players.map((p) => (
          <li key={p.playerId} className="d-flex justify-content-between align-items-center">
            <span>{p.name} {p.playerId === hostId ? <strong>(host)</strong> : null}</span>
            <span className="text-muted">{scores[p.playerId] || 0}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
