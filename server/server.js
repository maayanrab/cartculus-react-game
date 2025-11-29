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

/**
 * Deal a brand-new round to everyone in the room:
 *  - calls rooms.startGame (which resets per-round flags & hands)
 *  - stores pendingDeal + pendingDealLoaded
 *  - sends "deal_pending" to each player with their own 4 cards + shared target
 *  - after 8s (or when all clients confirm "deal_loaded"), sends "deal_riddle"
 */
function startNewRoundForRoom(roomId) {
  const room = rooms.getRoom(roomId);
  if (!room) return;

  // Clear any "auto next round" timer that might be hanging
  if (room.autoNextRoundTimeout) {
    clearTimeout(room.autoNextRoundTimeout);
    room.autoNextRoundTimeout = null;
  }

  const deal = rooms.startGame(roomId);
  const r = rooms.getRoom(roomId);
  if (!r) return;

  r.pendingDeal = deal.publicDeal;
  r.pendingDealLoaded = new Set();

  if (r.pendingDealTimeout) {
    clearTimeout(r.pendingDealTimeout);
    r.pendingDealTimeout = null;
  }

  // Send each player only their hand
  for (const p of r.players.values()) {
    const hand = deal.publicDeal.perPlayerHands[p.playerId] || [];
    io.to(p.socketId).emit("deal_pending", {
      roomId,
      hand,
      target: deal.publicDeal.target,
    });
  }

  io.to(roomId).emit("pending_status", {
    loadedCount: 0,
    total: r.players.size,
  });

  r.pendingDealTimeout = setTimeout(() => {
    const rr = rooms.getRoom(roomId);
    if (rr && rr.pendingDeal) {
      io.to(roomId).emit("deal_riddle", rr.pendingDeal);
      rr.pendingDeal = null;
      rr.pendingDealLoaded = null;
      rr.pendingDealTimeout = null;
      io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
    }
  }, 8000);

  io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
}

/**
 * When EVERY player in the room is in "waiting" state,
 * schedule a new round to be dealt after a short delay.
 *
 * Uses rooms.areAllPlayersWaiting(roomId) to check.
 */
function scheduleNewRoundIfAllWaiting(roomId) {
  const room = rooms.getRoom(roomId);
  if (!room) return;

  // If a round is already pending, don't double-schedule
  if (room.pendingDeal) return;

  // If there's already an auto-next timer, don't create another
  if (room.autoNextRoundTimeout) return;

  if (!rooms.areAllPlayersWaiting(roomId)) return;

  room.autoNextRoundTimeout = setTimeout(() => {
    const r = rooms.getRoom(roomId);
    if (!r) return;
    r.autoNextRoundTimeout = null;

    // Re-check conditions at fire time
    if (r.pendingDeal) return;
    if (!rooms.areAllPlayersWaiting(roomId)) return;

    startNewRoundForRoom(roomId);
  }, 1500);
}

/**
 * After someone finishes, check if only one active player remains unfinished.
 * If so, start a reveal timer for that player.
 */
function checkForRevealTimer(roomId) {
  try {
    const room = rooms.getRoom(roomId);
    if (!room) return;

    // Only check active players (not mid-round joiners)
    const unfinished = Array.from(room.players.values()).filter(
      (p) => p.isActiveInRound && !p.roundFinished
    );

    if (unfinished.length === 1) {
      const remainingId = unfinished[0].playerId;

      // When reveal timer expires with no solver, start new round with no points
      rooms.startRevealTimer(roomId, remainingId, (result) => {
        io.to(roomId).emit("reveal_timer", result.broadcast);
        if (result.awardedTo) {
          io.to(roomId).emit("score_update", {
            scores: rooms.getScores(roomId),
            awardedTo: result.awardedTo,
          });
        }
        io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));

        // If the reveal window expired and no one solved, deal a new round (no points).
        if (!result.awardedTo && result.broadcast && result.broadcast.expired) {
          try {
            // FIX: mark last player as finished when reveal times out
            rooms.markPlayerRoundFinished(roomId, result.broadcast.originPlayerId);

            // Now everyone should be in "waiting", so the auto-next-round
            // logic based on waiting-state will also be consistent with logs.
            startNewRoundForRoom(roomId);
          } catch (e) {
            console.error(
              "error auto-starting next round after reveal timeout",
              e
            );
          }
        }
      });
    }
  } catch (e) {
    console.error("error checking for reveal timer", e);
  }
}

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
      if (room && room.pendingDeal) {
        const hand =
          (room.pendingDeal.perPlayerHands &&
            room.pendingDeal.perPlayerHands[socket.id]) ||
          [];
        socket.emit("deal_pending", {
          roomId,
          hand,
          target: room.pendingDeal.target,
        });
      } else {
        const state = rooms.getStateForRoom(roomId, socket.id);
        if (
          state &&
          ((Array.isArray(state.cards) && state.cards.length > 0) ||
            state.target)
        ) {
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
        const loaded = room.pendingDealLoaded
          ? room.pendingDealLoaded.size
          : 0;
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
          io.to(roomId).emit("pending_status", {
            loadedCount: loaded,
            total: room.players.size,
          });
        }
      }
    } catch (e) {
      console.error("error handling pending after leave", e);
    }
  });

  socket.on("start_game", ({ roomId }) => {
    const room = rooms.getRoom(roomId);
    if (!room) return;
    // only host may start game
    if (room.host !== socket.id) return;

    startNewRoundForRoom(roomId);
  });

  socket.on("play_move", ({ roomId, playerId, move }) => {
    const room = rooms.getRoom(roomId);
    let isNoSolutionChallenge = false;
    let isRevealChallenge = false;

    // Check if this is solving someone else's "no solution" challenge
    if (room && room.noSolution && room.noSolution.originPlayerId !== playerId) {
      isNoSolutionChallenge = true;
    }

    // Check if this is solving someone else's revealed hand
    if (room && room.reveal && room.reveal.originPlayerId !== playerId) {
      isRevealChallenge = true;
    }

    const awarded = rooms.playerFinished(roomId, playerId, isNoSolutionChallenge || isRevealChallenge);

    // If someone finished while a no-solution or reveal timer was active, cancel it
    try {
      if (room && room.noSolution) {
        if (room.noSolution.originPlayerId !== playerId) {
          const originId = room.noSolution.originPlayerId;
          rooms.cancelNoSolution(roomId);
          rooms.markPlayerRoundFinished(roomId, originId);
          io.to(roomId).emit("no_solution_timer", {
            originPlayerId: originId,
            skipped: false,
            resolvedBy: playerId,
          });

          const solver = Array.from(room.players.values()).find(
            (p) => p.playerId === playerId
          );
          if (solver && !solver.roundFinished) {
            const state = rooms.getStateForRoom(roomId, playerId);
            io.to(socket.id).emit("state_sync", state);
          }
        }
      }

      if (room && room.reveal) {
        if (room.reveal.originPlayerId !== playerId) {
          const originId = room.reveal.originPlayerId;
          rooms.cancelReveal(roomId);
          rooms.markPlayerRoundFinished(roomId, originId);
          io.to(roomId).emit("reveal_timer", {
            originPlayerId: originId,
            skipped: false,
            resolvedBy: playerId,
          });
        }
      }
    } catch (e) {
      console.error("error handling timers on play_move", e);
    }

    if (awarded) {
      io.to(roomId).emit("score_update", {
        scores: rooms.getScores(roomId),
        awardedTo: awarded,
        // NEW: distinguish a normal win vs solving someone else's no-solution or reveal
        reason: isNoSolutionChallenge ? "no_solution_challenge" : 
                isRevealChallenge ? "reveal_challenge" : "win",
      });
      io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));

      if (!isNoSolutionChallenge && !isRevealChallenge) {
        // Solver waits without cards; everyone else continues
      }
    }

    // if all players are now in "waiting" state, schedule next round.
    try {
      scheduleNewRoundIfAllWaiting(roomId);
    } catch (e) {
      console.error("error scheduling next round after play_move", e);
    }

    // After someone finishes, if only one player remains with a live hand, start reveal timer
    checkForRevealTimer(roomId);
  });

  socket.on("declare_no_solution", ({ roomId, playerId }) => {
// Prevent declaring no-solution if ANY timer (no-solution or reveal) is active
try {
  const noSolutionPublic = rooms.getNoSolutionTimerPublic
    ? rooms.getNoSolutionTimerPublic(roomId)
    : null;
  if (noSolutionPublic) {
    return; // ignore declare_no_solution while any no-solution timer is active
  }
  
  const revealPublic = rooms.getRevealTimerPublic
    ? rooms.getRevealTimerPublic(roomId)
    : null;
  if (revealPublic) {
    return; // ignore declare_no_solution while any reveal timer is active
  }
} catch (e) {
  console.error("error checking timers before declare_no_solution", e);
}

    rooms.startNoSolutionTimer(roomId, playerId, (result) => {
      io.to(roomId).emit("no_solution_timer", result.broadcast);
      if (result.awardedTo) {
        io.to(roomId).emit("score_update", {
          scores: rooms.getScores(roomId),
          awardedTo: result.awardedTo,
          // NEW: points given because the no-solution timer expired
          reason: "no_solution_timeout",
        });

        // After awarding due to no-solution expiry, restore other players' hands
        try {
          const room = rooms.getRoom(roomId);
          if (room) {
            const originId =
              result.broadcast && result.broadcast.originPlayerId;
            for (const p of room.players.values()) {
              if (p.playerId === originId) continue;
              const state = rooms.getStateForRoom(roomId, p.playerId);
              io.to(p.socketId).emit("state_sync", state);
            }
          }
        } catch (e) {
          console.error(
            "error emitting state_sync after no_solution award",
            e
          );
        }
      }
      io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));

      // after a no-solution resolution, check if everyone is waiting
      try {
        scheduleNewRoundIfAllWaiting(roomId);
      } catch (e) {
        console.error(
          "error scheduling next round after no_solution",
          e
        );
      }

      // Check if only one player remains unfinished -> start reveal timer
      checkForRevealTimer(roomId);
    });

    io.to(roomId).emit(
      "no_solution_timer",
      rooms.getNoSolutionTimerPublic(roomId)
    );
  });

  socket.on("skip_vote", ({ roomId, playerId, originPlayerId }) => {
    // Check if this is a no-solution or reveal timer
    const isNoSolution = rooms.getNoSolutionTimerPublic(roomId) !== null;
    const isReveal = rooms.getRevealTimerPublic(roomId) !== null;

    if (isNoSolution) {
      const done = rooms.registerSkipVote(roomId, playerId, originPlayerId);
      io.to(roomId).emit(
        "no_solution_timer",
        rooms.getNoSolutionTimerPublic(roomId)
      );
      if (done) {
        const result = rooms.finishNoSolutionBySkip(roomId, originPlayerId);
        io.to(roomId).emit("score_update", {
          scores: rooms.getScores(roomId),
          awardedTo: result.awardedTo,
          // NEW: points given because everyone voted to skip (no-solution accepted)
          reason: "no_solution_skip",
        });
        io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));

        // After awarding due to skip completion, restore other players' hands
        try {
          const room = rooms.getRoom(roomId);
          if (room) {
            for (const p of room.players.values()) {
              if (p.playerId === originPlayerId) continue;
              const state = rooms.getStateForRoom(roomId, p.playerId);
              io.to(p.socketId).emit("state_sync", state);
            }
          }
        } catch (e) {
          console.error(
            "error emitting state_sync after skip finish",
            e
          );
        }

        io.to(roomId).emit("no_solution_timer", result.broadcast);

        // after skip-resolution, check if everyone is waiting
        try {
          scheduleNewRoundIfAllWaiting(roomId);
        } catch (e) {
          console.error(
            "error scheduling next round after skip_vote",
            e
          );
        }

        // Check if only one player remains unfinished -> start reveal timer
        checkForRevealTimer(roomId);
      }
    } else if (isReveal) {
      const done = rooms.registerRevealSkipVote(roomId, playerId, originPlayerId);
      io.to(roomId).emit(
        "reveal_timer",
        rooms.getRevealTimerPublic(roomId)
      );
      if (done) {
        // Everyone voted to skip the reveal - mark origin as finished and start new round
        rooms.cancelReveal(roomId);
        rooms.markPlayerRoundFinished(roomId, originPlayerId);
        
        io.to(roomId).emit("reveal_timer", {
          originPlayerId,
          expired: true,
          skipped: true,
        });
        io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));

        // Start a new round with no points given
        startNewRoundForRoom(roomId);
      }
    }
  });

  // Removed give_up_reveal - now using skip voting for reveal timers instead

  socket.on("request_reshuffle", ({ roomId }) => {
    // Manual reshuffle request uses same pipeline as an auto next round.
    startNewRoundForRoom(roomId);
  });

  socket.on("deal_loaded", ({ roomId }) => {
    const room = rooms.getRoom(roomId);
    if (!room || !room.pendingDeal) return;
    room.pendingDealLoaded = room.pendingDealLoaded || new Set();
    room.pendingDealLoaded.add(socket.id);

    io.to(roomId).emit("pending_status", {
      loadedCount: room.pendingDealLoaded.size,
      total: room.players.size,
    });

    if (room.pendingDealLoaded.size === room.players.size) {
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

    try {
      for (const [roomId, room] of rooms.rooms) {
        if (room.pendingDeal) {
          const loaded = room.pendingDealLoaded
            ? room.pendingDealLoaded.size
            : 0;
          if (loaded === room.players.size) {
            if (room.pendingDealTimeout) {
              clearTimeout(room.pendingDealTimeout);
              room.pendingDealTimeout = null;
            }
            io.to(roomId).emit("deal_riddle", room.pendingDeal);
            room.pendingDeal = null;
            room.pendingDealLoaded = null;
            io.to(roomId).emit(
              "lobby_update",
              rooms.getRoomPublic(roomId)
            );
          } else {
            io.to(roomId).emit("pending_status", {
              loadedCount: loaded,
              total: room.players.size,
            });
          }
        }
      }
    } catch (e) {
      console.error("error handling pending after disconnect", e);
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Socket.IO server listening on port ${PORT}`);
});

app.get("/", (req, res) => {
  res.send("Cartculus multiplayer server is running.");
});
