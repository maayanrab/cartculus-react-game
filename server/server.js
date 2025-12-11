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
  
  // Cancel any active timers (no-solution or reveal)
  rooms.cancelNoSolution(roomId);
  rooms.cancelReveal(roomId);
  
  // Clear timer UI for all clients
  io.to(roomId).emit("no_solution_timer", null);

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

    // Defensive: if not all clients load within 10s, force-advance
    r.pendingDealTimeout = setTimeout(() => {
      const rr = rooms.getRoom(roomId);
      if (rr && rr.pendingDeal) {
        io.to(roomId).emit("deal_riddle", rr.pendingDeal);
        io.to(roomId).emit("pending_status", {
          loadedCount: 0,
          total: 0,
        });
        rr.pendingDeal = null;
        rr.pendingDealLoaded = null;
        rr.pendingDealTimeout = null;
        io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
      }
    }, 10000);

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

    // If we have round replays to show and haven't broadcasted them yet,
    // do the replays phase before starting the next round.
    const hasReplays = Array.isArray(r.roundReplays) && r.roundReplays.length > 0;
    if (hasReplays && !r.roundReplaysBroadcasted) {
      try {
        r.roundReplaysBroadcasted = true;
        r.replayAcks = new Set();
        
        // Generate consolidated replays (one per active player)
        const consolidatedReplays = rooms.generateRoundReplays(roomId);
        
        // Build a stable snapshot of player names to avoid client race conditions
        const idToName = {};
        for (const p of r.players.values()) {
          idToName[p.playerId] = p.name || null;
        }
        
        // Enrich with headers
        const enriched = consolidatedReplays.map(item => {
          const playerName = idToName[item.playerId] || "Player";
          let header = `${playerName}'s hand`;
          
          if (item.solverInfo) {
            const solverName = idToName[item.solverInfo.solverId] || "Player";
            if (item.solverInfo.challengeContext) {
              header = `${playerName}'s hand solved by ${solverName}`;
            } else {
              header = `${solverName}'s hand`;
            }
          }
          
          return { ...item, header };
        });
        
        // Emit to room with enriched headers and names
        io.to(roomId).emit("round_replays", { items: enriched });
        // Fallback timeout in case clients don't ack
        r.replaysWaitTimeout = setTimeout(() => {
          const rr = rooms.getRoom(roomId);
          if (!rr) return;
          rr.replaysWaitTimeout = null;
          startNewRoundForRoom(roomId);
        }, 20000);
      } catch (e) {
        console.error("error broadcasting round_replays", e);
        startNewRoundForRoom(roomId);
      }
      return;
    }

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

    // Do not start reveal timers during the replays phase
    if (room.roundReplaysBroadcasted) {
      return;
    }

    // If a reveal is already active, do not start another
    if (room.reveal) {
      console.log("[TIMER] reveal already active; skipping start", { roomId, originPlayerId: room.reveal.originPlayerId });
      return;
    }

    // Only check active players (not mid-round joiners)
    const unfinished = Array.from(room.players.values()).filter(
      (p) => p.isActiveInRound && !p.roundFinished
    );

    if (unfinished.length === 1) {
      const remainingId = unfinished[0].playerId;
      console.log("[TIMER] starting reveal", { roomId, originPlayerId: remainingId });

      // When reveal timer expires with no solver, start new round with no points
      rooms.startRevealTimer(roomId, remainingId, (result) => {
        console.log("[EMIT] reveal_timer", { roomId, broadcast: result.broadcast });
        io.to(roomId).emit("reveal_timer", result.broadcast);
        if (result.awardedTo) {
          console.log("[EMIT] score_update (reveal)", { roomId, awardedTo: result.awardedTo });
          io.to(roomId).emit("score_update", {
            scores: rooms.getScores(roomId),
            awardedTo: result.awardedTo,
          });
        }
        console.log("[EMIT] lobby_update (during reveal)", { roomId });
        io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));

        // If the reveal window expired and no one solved, deal a new round (no points).
        if (!result.awardedTo && result.broadcast && result.broadcast.expired) {
          try {
            // FIX: mark last player as finished when reveal times out
            console.log("[TIMER] reveal expired, marking finished", { roomId, originPlayerId: result.broadcast.originPlayerId });
            rooms.markPlayerRoundFinished(roomId, result.broadcast.originPlayerId);

            // Now everyone should be in "waiting", so the auto-next-round
            // logic based on waiting-state will also be consistent with logs.
            console.log("[ROUND] scheduling after reveal timeout (with replays gate)", { roomId });
            scheduleNewRoundIfAllWaiting(roomId);
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
    try {
      const safeSummary = Array.isArray(list)
        ? list.map((r) => ({
            id: r && (r.roomId || r.id || r.roomName),
            name: r && (r.roomName || r.name || ""),
            players: r && r.players ? (Array.isArray(r.players) ? r.players.length : r.players.size || 0) : 0,
          }))
        : [];
      console.log("[EVENT] list_rooms", { requester: socket.id, roomsCount: Array.isArray(list) ? list.length : 0, rooms: safeSummary });
    } catch (e) {
      console.log("[EVENT] list_rooms", { requester: socket.id, roomsCount: Array.isArray(list) ? list.length : 0 });
    }
    socket.emit("rooms_list", list);
  });

  socket.on("join_room", ({ roomId, playerName, roomName }) => {
    rooms.addPlayer(roomId, socket.id, playerName, roomName);
    socket.join(roomId);
    io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
    io.emit("rooms_list", rooms.listRooms());
    console.log("[EVENT] join_room", { roomId, playerName, roomName, socketId: socket.id });

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
        console.log("[EMIT] deal_pending (join)", { to: socket.id, roomId, handCount: hand.length, target: room.pendingDeal.target });
      } else {
        const state = rooms.getStateForRoom(roomId, socket.id);
        if (
          state &&
          ((Array.isArray(state.cards) && state.cards.length > 0) ||
            state.target)
        ) {
          console.log("[EMIT] state_sync (join snapshot)", { to: socket.id, roomId, hasCards: Array.isArray(state.cards) ? state.cards.length : 0, target: state.target });
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
          // Clear the pending status for clients to stop showing "Waiting for others to load..."
          io.to(roomId).emit("pending_status", {
            loadedCount: 0,
            total: 0,
          });
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
    console.log("[EVENT] play_move", { roomId, playerId, move });
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
    console.log("[STATE] playerFinished", { roomId, playerId, awarded, isNoSolutionChallenge, isRevealChallenge });

    // Record a replay entry for a solution if provided
    try {
      if (room && move && move.type === "win" && move.solution && move.solution.c && move.solution.t && Array.isArray(move.solution.m)) {
        room.roundReplays = room.roundReplays || [];
        room.roundReplays.push({
          type: "solution",
          solverId: playerId,
          solution: move.solution,
          // If the solver solved during a challenge, include context
          challengeContext: isNoSolutionChallenge ? "no_solution" : (isRevealChallenge ? "reveal" : null),
          originPlayerId: isNoSolutionChallenge && room.noSolution ? room.noSolution.originPlayerId : (isRevealChallenge && room.reveal ? room.reveal.originPlayerId : null),
          ts: Date.now(),
        });
      }
    } catch (e) {
      console.error("error recording solution replay", e);
    }

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
          console.log("[EMIT] no_solution_timer (solved no-solution)", { roomId, originId, resolvedBy: playerId });

          // Solver is now marked as finished by playerFinished(), no need to restore their hand
        } else if (room.noSolution.originPlayerId === playerId) {
          // Origin player found a solution after declaring no-solution
          // Cancel the no-solution timer and notify all players
          rooms.cancelNoSolution(roomId);
          io.to(roomId).emit("no_solution_timer", {
            originPlayerId: playerId,
            skipped: false,
            resolvedBy: playerId,
          });
          console.log("[EMIT] no_solution_timer (origin solved)", { roomId, originId: playerId });
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
          console.log("[EMIT] reveal_timer (solved reveal)", { roomId, originId, resolvedBy: playerId });
        } else if (room.reveal.originPlayerId === playerId) {
          // Origin player solved their own cards during reveal timer
          // Cancel the reveal timer and notify all players
          rooms.cancelReveal(roomId);
          io.to(roomId).emit("reveal_timer", {
            originPlayerId: playerId,
            skipped: false,
            resolvedBy: playerId,
          });
          console.log("[EMIT] reveal_timer (origin solved)", { roomId, originId: playerId });
        }
      }
    } catch (e) {
      console.error("error handling timers on play_move", e);
    }

    if (awarded) {
      console.log("[EMIT] score_update", { roomId, awardedTo: awarded, reason: isNoSolutionChallenge ? "no_solution_challenge" : isRevealChallenge ? "reveal_challenge" : "win" });
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
    // Avoid starting reveal during replays phase
    checkForRevealTimer(roomId);
  });

  socket.on("declare_no_solution", ({ roomId, playerId }) => {
    console.log("[EVENT] declare_no_solution", { roomId, playerId });
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
      console.log("[EMIT] no_solution_timer (start)", { roomId, broadcast: result.broadcast });
      io.to(roomId).emit("no_solution_timer", result.broadcast);
      if (result.awardedTo) {
        // Start reveal for remaining unfinished player BEFORE emitting score_update,
        // so clients lock into reveal view and don't clear cards due to win handling.
        try {
          checkForRevealTimer(roomId);
        } catch (e) {
          console.error("error starting reveal before score_update", e);
        }
        console.log("[EMIT] score_update (no-solution timeout)", { roomId, awardedTo: result.awardedTo });
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
              console.log("[EMIT] state_sync (restore after no-solution)", { to: p.socketId, playerId: p.playerId, hasCards: Array.isArray(state.cards) ? state.cards.length : 0 });
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
      console.log("[EMIT] lobby_update (after no-solution)", { roomId });
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
      // This is kept for cases where awardedTo is null (timer started) and not yet resolved.
      checkForRevealTimer(roomId);
    });

    io.to(roomId).emit(
      "no_solution_timer",
      rooms.getNoSolutionTimerPublic(roomId)
    );
  });

  socket.on("skip_vote", ({ roomId, playerId, originPlayerId }) => {
    console.log("[EVENT] skip_vote", { roomId, playerId, originPlayerId });
    // Check if this is a no-solution or reveal timer
    const isNoSolution = rooms.getNoSolutionTimerPublic(roomId) !== null;
    const isReveal = rooms.getRevealTimerPublic(roomId) !== null;

    if (isNoSolution) {
      const done = rooms.registerSkipVote(roomId, playerId, originPlayerId);
      console.log("[EMIT] no_solution_timer (vote)", rooms.getNoSolutionTimerPublic(roomId));
      io.to(roomId).emit(
        "no_solution_timer",
        rooms.getNoSolutionTimerPublic(roomId)
      );
      if (done) {
        const result = rooms.finishNoSolutionBySkip(roomId, originPlayerId);
        console.log("[EMIT] score_update (no-solution skip)", { roomId, awardedTo: result.awardedTo });
        io.to(roomId).emit("score_update", {
          scores: rooms.getScores(roomId),
          awardedTo: result.awardedTo,
          // NEW: points given because everyone voted to skip (no-solution accepted)
          reason: "no_solution_skip",
        });
        console.log("[EMIT] lobby_update (after skip)", { roomId });
        io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));

        // Broadcast that skip is complete
        console.log("[EMIT] no_solution_timer (skipComplete)", result.broadcast);
        io.to(roomId).emit("no_solution_timer", {
          ...result.broadcast,
          skipComplete: true,
        });

        // IMPORTANT: After no-solution is accepted by skip, non-origin players
        // must immediately get their own hands back. Previously we forgot to
        // restore them on this path, causing them to keep seeing the origin
        // player's cards.
        try {
          const room = rooms.getRoom(roomId);
          if (room) {
            for (const p of room.players.values()) {
              if (p.playerId === originPlayerId) continue; // origin waits
              const state = rooms.getStateForRoom(roomId, p.playerId);
              io.to(p.socketId).emit("state_sync", state);
            }
          }
        } catch (e) {
          console.error("error restoring hands after no_solution skip", e);
        }

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
      console.log("[EMIT] reveal_timer (vote)", rooms.getRevealTimerPublic(roomId));
      io.to(roomId).emit(
        "reveal_timer",
        rooms.getRevealTimerPublic(roomId)
      );
      if (done) {
        // Everyone voted to skip the reveal - mark origin as finished and start new round
        const room = rooms.getRoom(roomId);
        const originHand =
          (room &&
            room.deal &&
            room.deal.perPlayerHands &&
            room.deal.perPlayerHands[originPlayerId]) ||
          [];
        
        // Record a replay entry for reveal skip (unsolved revealed hand)
        try {
          if (room) {
            room.roundReplays = room.roundReplays || [];
            room.roundReplays.push({
              type: "no_solution",
              originPlayerId,
              originHand,
              method: "reveal",
              ts: Date.now(),
            });
          }
        } catch {}

        rooms.cancelReveal(roomId);
        rooms.markPlayerRoundFinished(roomId, originPlayerId);
        
        console.log("[EMIT] reveal_timer (skipped)", { roomId, originPlayerId });
        io.to(roomId).emit("reveal_timer", {
          originPlayerId,
          expired: true,
          skipped: true,
        });
        
        // Restore cards for non-origin players before starting new round
        try {
          if (room) {
            for (const p of room.players.values()) {
              if (p.playerId === originPlayerId) continue;
              const state = rooms.getStateForRoom(roomId, p.playerId);
              io.to(p.socketId).emit("state_sync", state);
            }
          }
        } catch (e) {
          console.error("error restoring hands after reveal skip", e);
        }
        
        console.log("[EMIT] lobby_update (after reveal skip)", { roomId });
        io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));

        // Schedule next round via waiting-state gate to respect replays phase
        scheduleNewRoundIfAllWaiting(roomId);
      }
    }
  });

  socket.on("request_reshuffle", ({ roomId }) => {
    // Manual reshuffle request uses same pipeline as an auto next round.
    startNewRoundForRoom(roomId);
  });

  socket.on("client_replays_complete", ({ roomId, playerId }) => {
    try {
      const room = rooms.getRoom(roomId);
      if (!room) return;
      if (!room.roundReplaysBroadcasted) return;
      room.replayAcks = room.replayAcks || new Set();
      room.replayAcks.add(playerId);
      const total = room.players.size;
      const acked = room.replayAcks.size;
      console.log("[EVENT] client_replays_complete", { roomId, playerId, acked, total });
      
      // If this is the first person to finish, start an 8s timer to force-advance
      // so they don't wait forever if others are slow/stuck.
      if (acked === 1 && total > 1) {
        if (room.replaysForceAdvanceTimeout) {
          clearTimeout(room.replaysForceAdvanceTimeout);
        }
        room.replaysForceAdvanceTimeout = setTimeout(() => {
          const rr = rooms.getRoom(roomId);
          if (!rr) return;
          // If we haven't already advanced (e.g. by everyone finishing), do it now
          if (rr.roundReplaysBroadcasted) {
            console.log("[TIMER] replays force advance (8s elapsed since first finish)", { roomId });
            if (rr.replaysWaitTimeout) {
              clearTimeout(rr.replaysWaitTimeout);
              rr.replaysWaitTimeout = null;
            }
            rr.replaysForceAdvanceTimeout = null;
            startNewRoundForRoom(roomId);
          }
        }, 8000);
      }

      if (acked >= total) {
        if (room.replaysWaitTimeout) {
          clearTimeout(room.replaysWaitTimeout);
          room.replaysWaitTimeout = null;
        }
        if (room.replaysForceAdvanceTimeout) {
          clearTimeout(room.replaysForceAdvanceTimeout);
          room.replaysForceAdvanceTimeout = null;
        }
        startNewRoundForRoom(roomId);
      }
    } catch (e) {
      console.error("error handling client_replays_complete", e);
    }
  });

  socket.on("deal_loaded", ({ roomId }) => {
    console.log("[EVENT] deal_loaded", { roomId, socketId: socket.id });
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
      console.log("[EMIT] deal_riddle (all loaded)", { roomId });
      io.to(roomId).emit("deal_riddle", room.pendingDeal);
      // Clear the pending status for clients to stop showing "Waiting for others to load..."
      io.to(roomId).emit("pending_status", {
        loadedCount: 0,
        total: 0,
      });
      room.pendingDeal = null;
      room.pendingDealLoaded = null;
      console.log("[EMIT] lobby_update (after deal_riddle)", { roomId });
      io.to(roomId).emit("lobby_update", rooms.getRoomPublic(roomId));
    }
  });

  socket.on("disconnect", () => {
    rooms.removePlayerBySocket(socket.id);
    io.emit("rooms_list", rooms.listRooms());
    rooms.broadcastAllLobby(io);
    console.log("[SOCKET] disconnected", { socketId: socket.id });

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
            console.log("[EMIT] deal_riddle (post disconnect all loaded)", { roomId });
            io.to(roomId).emit("deal_riddle", room.pendingDeal);
            // Clear the pending status for clients to stop showing "Waiting for others to load..."
            io.to(roomId).emit("pending_status", {
              loadedCount: 0,
              total: 0,
            });
            room.pendingDeal = null;
            room.pendingDealLoaded = null;
            console.log("[EMIT] lobby_update (post disconnect)", { roomId });
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
