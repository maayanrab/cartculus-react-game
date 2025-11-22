import { io } from "socket.io-client";

let socket = null;

export function connect(url = "http://localhost:4000") {
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

export function on(event, cb) {
  if (!socket) connect();
  socket.on(event, cb);
}

export function requestRooms() {
  if (!socket) connect();
  socket.emit("list_rooms");
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
  on,
  getSocketId,
};
