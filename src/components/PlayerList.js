import React from "react";

export default function PlayerList({ players = [], scores = {} }) {
  return (
    <div className="player-list p-2 position-absolute" style={{ left: 16, top: 80, width: 200, background: "white", borderRadius: 6, zIndex: 2000 }}>
      <h6>Players</h6>
      <ul className="list-unstyled mb-0">
        {players.map((p) => (
          <li key={p.playerId} className="d-flex justify-content-between">
            <span>{p.name}</span>
            <span className="text-muted">{scores[p.playerId] || 0}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
