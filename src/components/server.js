const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const Rooms = require("./rooms");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const rooms = new Rooms();

io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);

  socket.on("join_room", ({ roomId, playerName }) => {
    rooms.addPlayer(roomId, socket.id, playerName);
    socket.join(roomId);
    io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
    console.log(`${playerName} joined ${roomId}`);
  });

  socket.on("leave_room", ({ roomId }) => {
    rooms.removePlayer(roomId, socket.id);
    socket.leave(roomId);
    io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
  });

  socket.on("start_game", ({ roomId }) => {
    const deal = rooms.startGame(roomId);
    io.to(roomId).emit("deal_riddle", deal.publicDeal);
    io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
  });

  socket.on("play_move", ({ roomId, playerId, move }) => {
    const awarded = rooms.playerFinished(roomId, playerId);
    io.to(roomId).emit("state_sync", rooms.getStateForRoom(roomId, playerId));
    if (awarded) {
      io.to(roomId).emit("score_update", { scores: rooms.getScores(roomId), awardedTo: awarded });
    }
  });

  socket.on("declare_no_solution", ({ roomId, playerId }) => {
    rooms.startNoSolutionTimer(roomId, playerId, (result) => {
      io.to(roomId).emit("no_solution_timer", result.broadcast);
      if (result.awardedTo) {
        io.to(roomId).emit("score_update", { scores: rooms.getScores(roomId), awardedTo: result.awardedTo });
      }
      io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
    });

    io.to(roomId).emit("no_solution_timer", rooms.getNoSolutionTimerPublic(roomId));
  });

  socket.on("skip_vote", ({ roomId, playerId, originPlayerId }) => {
    const done = rooms.registerSkipVote(roomId, playerId, originPlayerId);
    io.to(roomId).emit("no_solution_timer", rooms.getNoSolutionTimerPublic(roomId));
    if (done) {
      const result = rooms.finishNoSolutionBySkip(roomId, originPlayerId);
      io.to(roomId).emit("score_update", { scores: rooms.getScores(roomId), awardedTo: result.awardedTo });
      io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
      io.to(roomId).emit("no_solution_timer", result.broadcast);
    }
  });

  socket.on("request_reshuffle", ({ roomId }) => {
    const deal = rooms.reshuffle(roomId);
    io.to(roomId).emit("deal_riddle", deal.publicDeal);
    io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
  });

  socket.on("disconnect", () => {
    rooms.removePlayerBySocket(socket.id);
    rooms.broadcastAllLobby(io);
    console.log("socket disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Socket.IO server listening on port ${PORT}`);
});
