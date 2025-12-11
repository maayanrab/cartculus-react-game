import React, { useEffect, useState } from "react";
import * as socket from "../multiplayer/socket";

export default function Lobby({ onJoined, fullScreen = false, initialRoomId = null }) {
  const [name, setName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [rooms, setRooms] = useState([]);
  const [manualRoomId, setManualRoomId] = useState("");

  useEffect(() => {
    if (!initialRoomId) {
      socket.on("rooms_list", (list) => setRooms(list || []));
      socket.requestRooms();
    }
  }, [initialRoomId]);

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
    ? { maxWidth: 420, background: 'white', padding: 20, borderRadius: 8, margin: '0 auto' }
    : { right: 16, top: 80, width: 300, background: 'white', zIndex: 2000 };

  if (fullScreen) {
    return (
      <div className="lobby p-3 border rounded mt-3" style={wrapperStyle}>
        {InnerLobbyContent()}
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
    const handleSubmit = (e) => {
      e.preventDefault();
      // Attempt to create and join the room when Enter is pressed in either input
      if (initialRoomId) {
        join(initialRoomId);
      } else if (name && name.trim() !== "" && roomName && roomName.trim() !== "") {
        createRoom();
      }
    };

    if (initialRoomId) {
      return (
        <>
          <h4 className="mb-3">Join Room</h4>
          <p className="text-muted">Room ID: <strong>{initialRoomId}</strong></p>
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label">Player Name</label>
              <input
                className="form-control"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
                autoFocus
              />
            </div>
            <div className="d-grid">
              <button type="submit" className="btn btn-primary" disabled={!name || name.trim() === ""}>
                Join Game
              </button>
            </div>
          </form>
        </>
      );
    }

    return (
      <>
        <h4 className="mb-3">Multiplayer</h4>
        <form onSubmit={handleSubmit}>
          <div className="mb-2">
            <label className="form-label">Player Name</label>
            <input className="form-control" value={name} onChange={(e) => setName(e.target.value)} placeholder="Visible by others (required)" />
          </div>

          <div className="mb-2 text-center">
            <label className="form-label">Create Room</label>
            <input className="form-control form-control-sm mb-1" placeholder="Room display name (required)" value={roomName} onChange={(e) => setRoomName(e.target.value)} />
            <div className="d-flex justify-content-center mt-2">
              <button type="submit" className="btn btn-success btn-sm" disabled={!name || !roomName}>Create & Join</button>
            </div>
          </div>
        </form>

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

        <hr />
        <div className="mb-2">
          <label className="form-label">Join by room ID:</label>
          <div className="d-flex gap-2">
            <input
              type="text"
              className="form-control form-control-sm"
              placeholder="Enter Room ID"
              value={manualRoomId}
              onChange={(e) => setManualRoomId(e.target.value)}
            />
            <button
              className="btn btn-primary btn-sm"
              type="button"
              disabled={!name || !manualRoomId}
              onClick={() => join(manualRoomId)}
            >
              Join
            </button>
          </div>
        </div>
      </>
    );
  }
}
