import React, { useEffect, useState } from "react";
import * as socket from "../multiplayer/socket";

export default function Lobby({ onJoined }) {
  const [name, setName] = useState("Player");
  const [roomName, setRoomName] = useState("");
  const [rooms, setRooms] = useState([]);

  useEffect(() => {
    socket.on("rooms_list", (list) => setRooms(list || []));
    socket.requestRooms();
  }, []);

  const join = (rId, rName = null) => {
    socket.joinRoom(rId, name, rName);
    onJoined({ roomId: rId, playerName: name });
  };

  const createRoom = () => {
    const newId = `room-${Math.random().toString(36).slice(2, 8)}`;
    join(newId, roomName || newId);
  };

  return (
    <div className="lobby p-3 border rounded position-absolute" style={{ right: 16, top: 80, width: 300, background: "white", zIndex: 2000 }}>
      <h5>Multiplayer</h5>
      <div className="mb-2">
        <label className="form-label">Name</label>
        <input className="form-control" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="mb-2">
        <label className="form-label">Create Room</label>
        <input className="form-control form-control-sm mb-1" placeholder="Room display name" value={roomName} onChange={(e) => setRoomName(e.target.value)} />
        <div className="d-flex gap-2">
          <button className="btn btn-success btn-sm" onClick={createRoom}>Create & Join</button>
        </div>
      </div>

      <div className="mb-2">
        <label className="form-label">Or join existing</label>
        <ul className="list-unstyled" style={{ maxHeight: 180, overflowY: 'auto' }}>
          {rooms.length === 0 && <li className="text-muted">No active rooms</li>}
          {rooms.map((r) => (
            <li key={r.roomId} className="d-flex justify-content-between align-items-center mb-1">
              <span>{r.roomName || "Unnamed Room"}</span>
              <button className="btn btn-primary btn-sm" onClick={() => join(r.roomId, r.roomName)}>Join</button>
            </li>
          ))}
        </ul>
        <div className="mt-2">
          <div className="d-flex gap-2">
            <button className="btn btn-outline-secondary btn-sm" onClick={() => socket.requestRooms()}>Refresh</button>
          </div>
        </div>
      </div>
    </div>
  );
}
