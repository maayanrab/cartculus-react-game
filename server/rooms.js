function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

class Rooms {
  constructor() {
    this.rooms = new Map();
  }

  _ensureRoom(id) {
    if (!this.rooms.has(id)) {
      this.rooms.set(id, {
        players: new Map(),
        scores: {},
        noSolution: null,
        reveal: null,
        deal: null,
        name: null,
        host: null,
        pendingDeal: null,
        pendingDealLoaded: null,
        pendingDealTimeout: null,
        autoNextRoundTimeout: null, // NEW: used by server to avoid double-scheduling
        // Replays state for current round
        roundReplays: [],
        roundReplaysBroadcasted: false,
        replayAcks: null,
        replaysWaitTimeout: null,
      });
    }
    return this.rooms.get(id);
  }

  addPlayer(roomId, socketId, playerName, roomName = null) {
    const room = this._ensureRoom(roomId);
    const playerId = socketId;
    const gameInProgress = room.deal && room.deal.target;

    room.players.set(socketId, {
      playerId,
      name: playerName,
      socketId,
      finishedStatus: gameInProgress ? "waiting" : "none",
      roundFinished: gameInProgress,
      solvedCount: 0,
      isActiveInRound: !gameInProgress, // Active only if no game in progress
    });

    room.scores[playerId] = room.scores[playerId] || 0;

    if (!room.host) room.host = socketId;
    if (roomName) room.name = roomName;

    return { playerId, name: playerName };
  }

  removePlayer(roomId, socketId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.players.delete(socketId);

    if (room.host === socketId) {
      const it = room.players.keys().next();
      room.host = it.done ? null : it.value;
    }

    if (room.players.size === 0) {
      this.rooms.delete(roomId);
    }
  }

  removePlayerBySocket(socketId) {
    for (const [roomId, room] of this.rooms) {
      if (room.players.has(socketId)) {
        room.players.delete(socketId);

        if (room.host === socketId) {
          const it = room.players.keys().next();
          room.host = it.done ? null : it.value;
        }

        if (room.players.size === 0) {
          this.rooms.delete(roomId);
        }
      }
    }
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  getRoomPublic(roomId) {
    const room = this.rooms.get(roomId);
    if (!room)
      return { players: [], scores: {}, hostId: null, roomName: null, finishedCount: 0, activeCount: 0 };

    const players = Array.from(room.players.values()).map((p) => ({
      playerId: p.playerId,
      name: p.name,
      finished: p.finishedStatus !== "none",
    }));

    // Count active players (those who got cards this round)
    const activePlayers = Array.from(room.players.values()).filter(p => p.isActiveInRound);
    const activeCount = activePlayers.length;
    const finishedCount = activePlayers.filter(p => p.roundFinished).length;

    return {
      players,
      scores: room.scores || {},
      hostId: room.host,
      roomName: room.name,
      finishedCount,
      activeCount,
    };
  }

  broadcastAllLobby(io) {
    for (const [roomId] of this.rooms) {
      io.to(roomId).emit("lobby_update", this.getRoomPublic(roomId));
    }
  }

  generateDeck() {
    const deck = [];
    for (let v = 1; v <= 13; v++) {
      for (let c = 0; c < 4; c++) deck.push(v);
    }
    return shuffle(deck);
  }

  startGame(roomId) {
    const room = this._ensureRoom(roomId);

    // Reset per-round flags & per-round solve counters
    for (const p of room.players.values()) {
      p.finishedStatus = "none";
      p.roundFinished = false;
      p.solvedCount = 0;
      p.isActiveInRound = true; // All players become active at round start
    }

    const deck = this.generateDeck();
    const targetIndex = Math.floor(Math.random() * deck.length);
    const target = deck.splice(targetIndex, 1)[0];

    const perPlayerHands = {};
    const players = Array.from(room.players.values());

    for (const p of players) {
      const hand = [];
      for (let i = 0; i < 4; i++) {
        hand.push({ id: `${Date.now()}-${Math.random()}`, value: deck.pop() });
      }
      perPlayerHands[p.playerId] = hand;
    }

    room.deal = { perPlayerHands, target, seed: null };
    // Reset round replays state for the new round
    room.roundReplays = [];
    room.roundReplaysBroadcasted = false;
    room.replayAcks = null;
    if (room.replaysWaitTimeout) {
      clearTimeout(room.replaysWaitTimeout);
      room.replaysWaitTimeout = null;
    }
    return { publicDeal: { target, perPlayerHands } };
  }

  reshuffle(roomId) {
    return this.startGame(roomId);
  }

  getStateForRoom(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return {};
    const myHand = room.deal?.perPlayerHands?.[playerId] || [];
    return {
      cards: myHand,
      target: room.deal?.target || null,
      scores: room.scores || {},
    };
  }

  getScores(roomId) {
    const room = this.rooms.get(roomId);
    return room ? room.scores : {};
  }

  // Per-round reward ordering
  // First scoring event in the round: 10 points
  // 2nd: 7, 3rd: 5, 4th: 3, and 1 point after that
  getNextPoints(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return 1;

    const totalSolves = Array.from(room.players.values()).reduce(
      (sum, p) => sum + (p.solvedCount || 0),
      0
    );

    const pointsByOrder = [10, 7, 5, 3];
    return pointsByOrder[totalSolves] || 1;
  }

  // Award points to a player for finishing in this round.
  // Uses getNextPoints() so that later finishes get fewer points.
  playerFinished(roomId, playerId, isNoSolutionChallenge = false) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const player =
      Array.from(room.players.values()).find((p) => p.playerId === playerId) ||
      null;
    if (!player) return null;

    // Prevent double-award if player already closed their round (except for challenge solvers)
    if (!isNoSolutionChallenge && player.roundFinished) return null;

    const pts = this.getNextPoints(roomId);
    room.scores[playerId] = (room.scores[playerId] || 0) + pts;

    player.solvedCount = (player.solvedCount || 0) + 1;
    
    // When solving a challenge (no-solution or reveal), only award points.
    // The solver stays active and does NOT get marked as finished.
    // When solving own cards, mark as finished normally.
    if (!isNoSolutionChallenge) {
      player.finishedStatus = "solved";
      this.markPlayerRoundFinished(roomId, playerId);
    }

    return playerId;
  }

  markPlayerWaiting(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const player =
      Array.from(room.players.values()).find((p) => p.playerId === playerId) ||
      null;
    if (!player) return;

    player.finishedStatus = "waiting";
  }

  markPlayerRoundFinished(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const player =
      Array.from(room.players.values()).find((p) => p.playerId === playerId) ||
      null;
    if (!player) return;

    player.roundFinished = true;
    player.finishedStatus = "waiting";
    
    // Log when player enters waiting state
    console.log(`${player.name || playerId} has finished (waiting for other players)`);
  }

  // NEW: helper used by the server to know when to deal a new round.
  // Returns true only if there is at least one active player && every ACTIVE player is in "waiting" state.
  // Mid-round joiners (isActiveInRound=false) are ignored.
  areAllPlayersWaiting(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const activePlayers = Array.from(room.players.values()).filter(p => p.isActiveInRound);
    if (activePlayers.length === 0) return false;

    return activePlayers.every((p) => p.finishedStatus === "waiting");
  }

  startNoSolutionTimer(roomId, originPlayerId, cb) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    if (room.noSolution && room.noSolution.originPlayerId === originPlayerId)
      return;
    if (room.noSolution && room.noSolution.timeoutId) {
      clearTimeout(room.noSolution.timeoutId);
    }

    const duration = 45 * 1000;
    const expiresAt = Date.now() + duration;
    const votes = new Set();

    const originHand =
      (room.deal &&
        room.deal.perPlayerHands &&
        room.deal.perPlayerHands[originPlayerId]) ||
      [];

    room.noSolution = { originPlayerId, expiresAt, votes, timeoutId: null };

    // Origin player is now waiting for verdict
    this.markPlayerWaiting(roomId, originPlayerId);

    room.noSolution.timeoutId = setTimeout(() => {
      const pts = this.getNextPoints(roomId);
      room.scores[originPlayerId] =
        (room.scores[originPlayerId] || 0) + pts;

      const origin = room.players.get(originPlayerId);
      if (origin) {
        origin.solvedCount = (origin.solvedCount || 0) + 1;
        origin.finishedStatus = "solved";
      }

      this.markPlayerRoundFinished(roomId, originPlayerId);

      room.noSolution = null;

      cb({
        awardedTo: originPlayerId,
        broadcast: {
          originPlayerId,
          expired: true,
          originHand,
          type: "no_solution",
          points: pts,
        },
      });
      // Record a replay entry for no-solution timeout award
      try {
        room.roundReplays = room.roundReplays || [];
        room.roundReplays.push({
          type: "no_solution",
          originPlayerId,
          originHand,
          method: "timeout",
          ts: Date.now(),
        });
      } catch {}
    }, duration);

    cb({
      awardedTo: null,
      broadcast: {
        originPlayerId,
        expiresAt,
        originHand,
        type: "no_solution",
      },
    });
  }

  getNoSolutionTimerPublic(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.noSolution) return null;

    const originHand =
      (room.deal &&
        room.deal.perPlayerHands &&
        room.deal.perPlayerHands[room.noSolution.originPlayerId]) ||
      [];

    return {
      originPlayerId: room.noSolution.originPlayerId,
      expiresAt: room.noSolution.expiresAt,
      votes: Array.from(room.noSolution.votes),
      originHand,
      type: "no_solution",
    };
  }

  registerSkipVote(roomId, playerId, originPlayerId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.noSolution) return false;

    room.noSolution.votes.add(playerId);

    const otherPlayers = Array.from(room.players.values()).filter(
      (p) => p.playerId !== originPlayerId
    );

    return otherPlayers.every((p) =>
      room.noSolution.votes.has(p.playerId)
    );
  }

  finishNoSolutionBySkip(roomId, originPlayerId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.noSolution) return null;

    if (room.noSolution.timeoutId) {
      clearTimeout(room.noSolution.timeoutId);
    }

    const pts = this.getNextPoints(roomId);
    room.scores[originPlayerId] =
      (room.scores[originPlayerId] || 0) + pts;

    const origin = room.players.get(originPlayerId);
    if (origin) {
      origin.solvedCount = (origin.solvedCount || 0) + 1;
      origin.finishedStatus = "solved";
    }

    this.markPlayerRoundFinished(roomId, originPlayerId);

    const originHand =
      (room.deal &&
        room.deal.perPlayerHands &&
        room.deal.perPlayerHands[originPlayerId]) ||
      [];

    room.noSolution = null;

    const result = {
      awardedTo: originPlayerId,
      broadcast: {
        originPlayerId,
        skipped: true,
        originHand,
        type: "no_solution",
        points: pts,
      },
    };
    // Record a replay entry for accepted no-solution by skip
    try {
      room.roundReplays = room.roundReplays || [];
      room.roundReplays.push({
        type: "no_solution",
        originPlayerId,
        originHand,
        method: "skip",
        ts: Date.now(),
      });
    } catch {}
    return result;
  }

  // Reveal timer – controls a 45s window where the last player can still solve.
  // No points are given automatically on expiry.
  startRevealTimer(roomId, originPlayerId, cb) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // Prevent duplicate timers per origin player
    if (room.reveal && room.reveal.originPlayerId === originPlayerId) return;
    if (room.reveal && room.reveal.timeoutId) {
      clearTimeout(room.reveal.timeoutId);
    }

    const duration = 45 * 1000;
    const expiresAt = Date.now() + duration;
    const votes = new Set();

    const originHand =
      (room.deal &&
        room.deal.perPlayerHands &&
        room.deal.perPlayerHands[originPlayerId]) ||
      [];

    room.reveal = { originPlayerId, expiresAt, votes, timeoutId: null };

    // After the reveal window ends, no one gets points automatically.
    // The server will start a fresh round when it sees this "expired" event.
    room.reveal.timeoutId = setTimeout(() => {
      room.reveal = null;

      cb({
        awardedTo: null,
        broadcast: {
          originPlayerId,
          expired: true,
          originHand,
          type: "reveal_timeout",
        },
      });
    }, duration);

    // Initial callback so clients can show the countdown.
    cb({
      awardedTo: null,
      broadcast: {
        originPlayerId,
        expiresAt,
        originHand,
        type: "reveal",
      },
    });
  }

  getRevealTimerPublic(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.reveal) return null;

    const originHand =
      (room.deal &&
        room.deal.perPlayerHands &&
        room.deal.perPlayerHands[room.reveal.originPlayerId]) ||
      [];

    return {
      originPlayerId: room.reveal.originPlayerId,
      expiresAt: room.reveal.expiresAt,
      votes: Array.from(room.reveal.votes),
      originHand,
      type: "reveal",
    };
  }

  registerRevealSkipVote(roomId, playerId, originPlayerId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.reveal) return false;

    room.reveal.votes.add(playerId);

    // Require ALL ACTIVE players (including the origin) to vote to skip.
    // Active players are those who received hands at round start (isActiveInRound).
    const activePlayers = Array.from(room.players.values()).filter(
      (p) => p.isActiveInRound
    );
    const requiredIds = activePlayers.map(p => p.playerId);
    const done = requiredIds.every((pid) => room.reveal.votes.has(pid));
    try {
      console.log("[VOTE] reveal skip", {
        roomId,
        originPlayerId,
        votes: Array.from(room.reveal.votes),
        required: requiredIds,
        done,
      });
    } catch {}
    return done;
  }

  cancelNoSolution(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.noSolution) return;
    if (room.noSolution.timeoutId) clearTimeout(room.noSolution.timeoutId);
    room.noSolution = null;
  }

  cancelReveal(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.reveal) return;
    if (room.reveal.timeoutId) clearTimeout(room.reveal.timeoutId);
    room.reveal = null;
  }

  listRooms() {
    return Array.from(this.rooms.entries()).map(([roomId, room]) => ({
      roomId,
      playerCount: room ? room.players.size : 0,
      roomName: room ? room.name : null,
      hostId: room ? room.host : null,
    }));
  }
}

module.exports = Rooms;
