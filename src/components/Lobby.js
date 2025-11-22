import React, { useState } from "react";
import * as socket from "../multiplayer/socket";

export default function Lobby({ onJoined }) {
  const [roomId, setRoomId] = useState("room1");
  const [name, setName] = useState("Player");

  const join = () => {
    socket.joinRoom(roomId, name);
    onJoined({ roomId, playerName: name });
  };

  return (
    <div className="lobby p-3 border rounded position-absolute" style={{ right: 16, top: 80, width: 240, background: "white", zIndex: 2000 }}>
      <h5>Multiplayer</h5>
      <div className="mb-2">
        <label className="form-label">Room</label>
        <input className="form-control" value={roomId} onChange={(e) => setRoomId(e.target.value)} />
      </div>
      <div className="mb-2">
        <label className="form-label">Name</label>
        <input className="form-control" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="d-flex gap-2">
        <button className="btn btn-primary btn-sm" onClick={join}>Join</button>
      </div>
    </div>
  );
}
