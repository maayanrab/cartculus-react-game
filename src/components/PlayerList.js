import React from "react";

export default function PlayerList({ players = [], scores = {}, hostId = null, roomId = null, currentPlayerId = null, onStartGame = null }) {
  const isHost = hostId && currentPlayerId && hostId === currentPlayerId;
  return (
    <div className="player-list p-2 position-absolute" style={{ left: 16, top: 80, width: 240, background: "white", borderRadius: 6, zIndex: 2000 }}>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h6 className="mb-0">Players</h6>
        {isHost && players.length >= 2 && (
          <button className="btn btn-sm btn-success" onClick={() => onStartGame && onStartGame(roomId)}>Start</button>
        )}
      </div>
      <ul className="list-unstyled mb-0">
        {players.map((p) => (
          <li key={p.playerId} className="d-flex justify-content-between">
            <span>{p.name} {p.playerId === hostId ? <strong>(host)</strong> : null}</span>
            <span className="text-muted">{scores[p.playerId] || 0}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
