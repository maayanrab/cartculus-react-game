import { io } from "socket.io-client";

let socket = null;

// Choose server URL based on environment:
// - In development (npm start) -> localhost:4000
// - In production (GitHub Pages build) -> Render backend URL
const SERVER_URL =
  process.env.NODE_ENV === "production"
    ? "https://cartculus-mp-server.onrender.com/"
    : "http://localhost:4000";

export function connect(url = SERVER_URL) {
  if (socket) return socket;
  socket = io(url, { autoConnect: true });
  return socket;
}

export function disconnect() {
  if (!socket) return;
  socket.disconnect();
  socket = null;
}

export function getSocketId() {
  return socket ? socket.id : null;
}

export function joinRoom(roomId, playerName, roomName = null) {
  if (!socket) connect();
  socket.emit("join_room", { roomId, playerName, roomName });
}

export function leaveRoom(roomId) {
  if (!socket) return;
  socket.emit("leave_room", { roomId });
}

export function startGame(roomId) {
  if (!socket) return;
  socket.emit("start_game", { roomId });
}

export function emitPlayMove(roomId, playerId, move) {
  if (!socket) return;
  socket.emit("play_move", { roomId, playerId, move });
}

export function emitDeclareNoSolution(roomId, playerId) {
  if (!socket) return;
  socket.emit("declare_no_solution", { roomId, playerId });
}

export function emitSkipVote(roomId, playerId, originPlayerId) {
  if (!socket) return;
  socket.emit("skip_vote", { roomId, playerId, originPlayerId });
}

// NEW: origin player gives up during reveal window
export function emitGiveUpReveal(roomId, playerId) {
  if (!socket) return;
  socket.emit("give_up_reveal", { roomId, playerId });
}

export function on(event, cb) {
  if (!socket) connect();
  socket.on(event, cb);
}

export function requestRooms() {
  if (!socket) connect();
  socket.emit("list_rooms");
}

export function requestReshuffle(roomId) {
  if (!socket) connect();
  socket.emit("request_reshuffle", { roomId });
}

export function emitDealLoaded(roomId) {
  if (!socket) return;
  socket.emit("deal_loaded", { roomId });
}

export default {
  connect,
  disconnect,
  joinRoom,
  leaveRoom,
  startGame,
  emitPlayMove,
  emitDeclareNoSolution,
  emitSkipVote,
  emitGiveUpReveal,
  requestReshuffle,
  emitDealLoaded,
  on,
  getSocketId,
};
