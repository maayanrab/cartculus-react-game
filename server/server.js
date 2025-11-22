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

  socket.on("list_rooms", () => {
    const list = rooms.listRooms();
    socket.emit("rooms_list", list);
  });

  socket.on("join_room", ({ roomId, playerName, roomName }) => {
    rooms.addPlayer(roomId, socket.id, playerName, roomName);
    socket.join(roomId);
    io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
    io.emit("rooms_list", rooms.listRooms());
    console.log(`${playerName} joined ${roomId}`);
    // If a game/deal is already in progress for this room, send the joining socket
    // a state snapshot so they receive their hand and the shared target immediately.
    try {
      const room = rooms.getRoom(roomId);
      // If there's a pending deal awaiting reveal, send the pending payload to this socket
      if (room && room.pendingDeal) {
        const hand = (room.pendingDeal.perPlayerHands && room.pendingDeal.perPlayerHands[socket.id]) || [];
        socket.emit("deal_pending", { roomId, hand, target: room.pendingDeal.target });
      } else {
        const state = rooms.getStateForRoom(roomId, socket.id);
        if (state && (Array.isArray(state.cards) && state.cards.length > 0 || state.target)) {
          socket.emit("state_sync", state);
        }
      }
    } catch (e) {
      console.error("error emitting state_sync to joining socket", e);
    }
  });

  socket.on("leave_room", ({ roomId }) => {
    rooms.removePlayer(roomId, socket.id);
    socket.leave(roomId);
    io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
    io.emit("rooms_list", rooms.listRooms());
    // If a pending deal exists, check whether everyone has loaded given the new player set
    try {
      const room = rooms.getRoom(roomId);
      if (room && room.pendingDeal) {
        const loaded = room.pendingDealLoaded ? room.pendingDealLoaded.size : 0;
        if (loaded === room.players.size) {
          if (room.pendingDealTimeout) {
            clearTimeout(room.pendingDealTimeout);
            room.pendingDealTimeout = null;
          }
          io.to(roomId).emit("deal_riddle", room.pendingDeal);
          room.pendingDeal = null;
          room.pendingDealLoaded = null;
          io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
        } else {
          io.to(roomId).emit("pending_status", { loadedCount: loaded, total: room.players.size });
        }
      }
    } catch (e) {
      console.error('error handling pending after leave', e);
    }
  });

  socket.on("start_game", ({ roomId }) => {
    const room = rooms.getRoom(roomId);
    if (!room) return;
    // only host may start game
    if (room.host !== socket.id) return;
    const deal = rooms.startGame(roomId);
    // Store pending deal and wait for clients to load before revealing
    room.pendingDeal = deal.publicDeal;
    room.pendingDealLoaded = new Set();
    // Cancel any previous pending timeout
    if (room.pendingDealTimeout) {
      clearTimeout(room.pendingDealTimeout);
      room.pendingDealTimeout = null;
    }
    // Send each player only their hand (so they can load but keep cards face-down)
    for (const p of room.players.values()) {
      const hand = deal.publicDeal.perPlayerHands[p.playerId] || [];
      io.to(p.socketId).emit("deal_pending", { roomId, hand, target: deal.publicDeal.target });
    }
    // Broadcast pending status
    io.to(roomId).emit("pending_status", { loadedCount: 0, total: room.players.size });
    // Auto-reveal after 8 seconds if not everyone has loaded
    room.pendingDealTimeout = setTimeout(() => {
      if (room && room.pendingDeal) {
        io.to(roomId).emit("deal_riddle", room.pendingDeal);
        room.pendingDeal = null;
        room.pendingDealLoaded = null;
        room.pendingDealTimeout = null;
        io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
      }
    }, 8000);
    io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
  });

  socket.on("play_move", ({ roomId, playerId, move }) => {
    const awarded = rooms.playerFinished(roomId, playerId);
    // If someone finished while a no-solution or reveal timer was active, cancel it
    try {
      const room = rooms.getRoom(roomId);
      if (room && room.noSolution) {
        // If solver is not the origin, cancel the noSolution timer (solver stole points)
        if (room.noSolution.originPlayerId !== playerId) {
          const originId = room.noSolution.originPlayerId;
          rooms.cancelNoSolution(roomId);
          io.to(roomId).emit("no_solution_timer", { originPlayerId: originId, skipped: false, resolvedBy: playerId });
        }
      }
      if (room && room.reveal) {
        // If someone solved during reveal, cancel the reveal timer
        if (room.reveal.originPlayerId !== playerId) {
          const originId = room.reveal.originPlayerId;
          rooms.cancelReveal(roomId);
          io.to(roomId).emit("reveal_timer", { originPlayerId: originId, skipped: false, resolvedBy: playerId });
        }
      }
    } catch (e) {
      console.error("error handling timers on play_move", e);
    }

    io.to(roomId).emit("state_sync", rooms.getStateForRoom(roomId, playerId));
    if (awarded) {
      io.to(roomId).emit("score_update", { scores: rooms.getScores(roomId), awardedTo: awarded });
      io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
    }

    // If all players finished, start a fresh round after a short delay
    try {
      const room = rooms.getRoom(roomId);
      if (room) {
        const allFinished = Array.from(room.players.values()).every((p) => p.finished);
        if (allFinished) {
          setTimeout(() => {
            const deal = rooms.startGame(roomId);
            // Use pending/reveal flow for auto-start as well
            const r = rooms.getRoom(roomId);
            r.pendingDeal = deal.publicDeal;
            r.pendingDealLoaded = new Set();
            if (r.pendingDealTimeout) {
              clearTimeout(r.pendingDealTimeout);
              r.pendingDealTimeout = null;
            }
            for (const p of r.players.values()) {
              const hand = deal.publicDeal.perPlayerHands[p.playerId] || [];
              io.to(p.socketId).emit("deal_pending", { roomId, hand, target: deal.publicDeal.target });
            }
            io.to(roomId).emit("pending_status", { loadedCount: 0, total: r.players.size });
            r.pendingDealTimeout = setTimeout(() => {
              if (r && r.pendingDeal) {
                io.to(roomId).emit("deal_riddle", r.pendingDeal);
                r.pendingDeal = null;
                r.pendingDealLoaded = null;
                r.pendingDealTimeout = null;
                io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
              }
            }, 8000);
            io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
          }, 1500);
        }
      }
    } catch (e) {
      console.error("error auto-starting next round", e);
    }

    // After someone finishes, if only one player remains with a live hand, start reveal timer
    try {
      const room = rooms.getRoom(roomId);
      if (room) {
        const unfinished = Array.from(room.players.values()).filter((p) => !p.finished);
        if (unfinished.length === 1) {
          const remainingId = unfinished[0].playerId;
          rooms.startRevealTimer(roomId, remainingId, (result) => {
            io.to(roomId).emit("reveal_timer", result.broadcast);
            if (result.awardedTo) {
              io.to(roomId).emit("score_update", { scores: rooms.getScores(roomId), awardedTo: result.awardedTo });
            }
            io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
          });
        }
      }
    } catch (e) {
      console.error("error checking for reveal timer", e);
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
    const room = rooms.getRoom(roomId);
    if (room) {
      room.pendingDeal = deal.publicDeal;
      room.pendingDealLoaded = new Set();
      if (room.pendingDealTimeout) {
        clearTimeout(room.pendingDealTimeout);
        room.pendingDealTimeout = null;
      }
      for (const p of room.players.values()) {
        const hand = deal.publicDeal.perPlayerHands[p.playerId] || [];
        io.to(p.socketId).emit("deal_pending", { roomId, hand, target: deal.publicDeal.target });
      }
      io.to(roomId).emit("pending_status", { loadedCount: 0, total: room.players.size });
      room.pendingDealTimeout = setTimeout(() => {
        if (room && room.pendingDeal) {
          io.to(roomId).emit("deal_riddle", room.pendingDeal);
          room.pendingDeal = null;
          room.pendingDealLoaded = null;
          room.pendingDealTimeout = null;
          io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
        }
      }, 8000);
      io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
    }
  });

  socket.on("deal_loaded", ({ roomId }) => {
    const room = rooms.getRoom(roomId);
    if (!room || !room.pendingDeal) return;
    room.pendingDealLoaded = room.pendingDealLoaded || new Set();
    room.pendingDealLoaded.add(socket.id);
    // Broadcast updated pending status
    io.to(roomId).emit("pending_status", { loadedCount: room.pendingDealLoaded.size, total: room.players.size });
    // If everyone has loaded, reveal the deal for all
    if (room.pendingDealLoaded.size === room.players.size) {
      // cancel timeout
      if (room.pendingDealTimeout) {
        clearTimeout(room.pendingDealTimeout);
        room.pendingDealTimeout = null;
      }
      io.to(roomId).emit("deal_riddle", room.pendingDeal);
      room.pendingDeal = null;
      room.pendingDealLoaded = null;
      io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
    }
  });

  socket.on("disconnect", () => {
    rooms.removePlayerBySocket(socket.id);
    io.emit("rooms_list", rooms.listRooms());
    rooms.broadcastAllLobby(io);
    console.log("socket disconnected:", socket.id);
    // If a pending deal exists in any room this socket belonged to, re-evaluate
    try {
      for (const [roomId, room] of rooms.rooms) {
        if (room.pendingDeal) {
          const loaded = room.pendingDealLoaded ? room.pendingDealLoaded.size : 0;
          if (loaded === room.players.size) {
            if (room.pendingDealTimeout) {
              clearTimeout(room.pendingDealTimeout);
              room.pendingDealTimeout = null;
            }
            io.to(roomId).emit("deal_riddle", room.pendingDeal);
            room.pendingDeal = null;
            room.pendingDealLoaded = null;
            io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
          } else {
            io.to(roomId).emit("pending_status", { loadedCount: loaded, total: room.players.size });
          }
        }
      }
    } catch (e) {
      console.error('error handling pending after disconnect', e);
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Socket.IO server listening on port ${PORT}`);
});
