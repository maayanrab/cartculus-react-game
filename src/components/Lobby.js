import React, { useEffect, useState } from "react";
import * as socket from "../multiplayer/socket";

export default function Lobby({ onJoined, fullScreen = false }) {
  const [name, setName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [rooms, setRooms] = useState([]);

  useEffect(() => {
    socket.on("rooms_list", (list) => setRooms(list || []));
    socket.requestRooms();
  }, []);

  const join = (rId, rName = null) => {
    if (!name || name.trim() === "") return;
    socket.joinRoom(rId, name, rName);
    onJoined({ roomId: rId, playerName: name });
  };

  const createRoom = () => {
    if (!name || name.trim() === "") return;
    if (!roomName || roomName.trim() === "") return;
    const newId = `room-${Math.random().toString(36).slice(2, 8)}`;
    join(newId, roomName || newId);
  };

  const wrapperStyle = fullScreen
    ? { maxWidth: 420, background: 'white', padding: 20, borderRadius: 8 }
    : { right: 16, top: 80, width: 300, background: 'white', zIndex: 2000 };

  if (fullScreen) {
    return (
      <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '100vh' }}>
        <div className="lobby p-3 border rounded" style={wrapperStyle}>
          {InnerLobbyContent()}
        </div>
      </div>
    );
  }

  return (
    <div className="lobby p-3 border rounded" style={wrapperStyle}>
      {InnerLobbyContent()}
    </div>
  );

  // Inner content split out to avoid duplicating JSX
  function InnerLobbyContent() {
    return (
      <>
        <h4 className="mb-3">Multiplayer</h4>
        <div className="mb-2">
          <label className="form-label">Player Name</label>
          <input className="form-control" value={name} onChange={(e) => setName(e.target.value)} placeholder="" />
        </div>

        <div className="mb-2 text-center">
          <label className="form-label">Create Room</label>
          <input className="form-control form-control-sm mb-1" placeholder="Room display name (required)" value={roomName} onChange={(e) => setRoomName(e.target.value)} />
          <div className="d-flex justify-content-center mt-2">
            <button className="btn btn-success btn-sm" onClick={createRoom} disabled={!name || !roomName}>Create & Join</button>
          </div>
        </div>

        <div className="mb-2">
          <label className="form-label">Or join existing</label>
          <ul className="list-unstyled" style={{ maxHeight: 260, overflowY: 'auto' }}>
            {rooms.length === 0 && <li className="text-muted">No active rooms</li>}
            {rooms.map((r) => (
              <li key={r.roomId} className="d-flex justify-content-between align-items-center mb-1">
                <span>{r.roomName || "Unnamed Room"}</span>
                <button className="btn btn-primary btn-sm" onClick={() => join(r.roomId, r.roomName)} disabled={!name}>Join</button>
              </li>
            ))}
          </ul>
          <div className="mt-2 d-flex justify-content-center">
            <button className="btn btn-outline-secondary btn-sm" onClick={() => socket.requestRooms()}>Refresh</button>
          </div>
        </div>
      </>
    );
  }
}
