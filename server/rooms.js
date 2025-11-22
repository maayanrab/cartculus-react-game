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
        deal: null,
        name: null,
        host: null,
      });
    }
    return this.rooms.get(id);
  }

  addPlayer(roomId, socketId, playerName, roomName = null) {
    const room = this._ensureRoom(roomId);
    const playerId = socketId;
    // finishedStatus: 'none' | 'solved' | 'waiting' (for backward compatibility)
    // roundFinished: true when player has finished their round (can't play anymore)
    // solvedCount: number of times player has solved in this round
    // If a game is already in progress, new players should be marked as roundFinished
    // (they can't participate in the current round)
    const gameInProgress = room.deal && room.deal.target;
    room.players.set(socketId, { playerId, name: playerName, socketId, finishedStatus: gameInProgress ? 'waiting' : 'none', roundFinished: gameInProgress, solvedCount: 0 });
    room.scores[playerId] = room.scores[playerId] || 0;
    // assign host and room name if first creator
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
    // If room is empty after removal, delete it entirely
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
    if (!room) return { players: [], scores: {}, hostId: null, roomName: null };
    const players = Array.from(room.players.values()).map((p) => ({ playerId: p.playerId, name: p.name, finished: p.finishedStatus !== 'none' }));
    return { players, scores: room.scores || {}, hostId: room.host, roomName: room.name };
  }

  broadcastAllLobby(io) {
    for (const [roomId] of this.rooms) {
      io.to(roomId).emit("lobby_update", this.getRoomPublic(roomId));
    }
  }

  generateDeck() {
    const deck = [];
    for (let v = 1; v <= 13; v++) for (let c = 0; c < 4; c++) deck.push(v);
    return shuffle(deck);
  }

  startGame(roomId) {
    const room = this._ensureRoom(roomId);
    for (const p of room.players.values()) {
      p.finishedStatus = 'none';
      p.roundFinished = false;
      p.solvedCount = 0;
    }
    const deck = this.generateDeck();
    // Choose a single shared target from the deck so all players get the same target
    const targetIndex = Math.floor(Math.random() * deck.length);
    const target = deck.splice(targetIndex, 1)[0];

    const perPlayerHands = {};
    const players = Array.from(room.players.values());
    for (const p of players) {
      const hand = [];
      for (let i = 0; i < 4; i++) hand.push({ id: `${Date.now()}-${Math.random()}`, value: deck.pop() });
      perPlayerHands[p.playerId] = hand;
    }

    room.deal = { perPlayerHands, target, seed: null };
    return { publicDeal: { target, perPlayerHands } };
  }

  reshuffle(roomId) { return this.startGame(roomId); }

  getStateForRoom(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return {};
    const myHand = room.deal?.perPlayerHands?.[playerId] || [];
    return { cards: myHand, target: room.deal?.target || null, scores: room.scores || {} };
  }

  playerFinished(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const player = Array.from(room.players.values()).find((p) => p.playerId === playerId) || null;
    if (!player || player.roundFinished) return null; // Can't solve if round is finished
    
    // Count how many total solves have happened across all players (for points order)
    const totalSolves = Array.from(room.players.values()).reduce((sum, p) => sum + (p.solvedCount || 0), 0);
    const pointsByOrder = [10, 7, 4, 1];
    const pts = pointsByOrder[totalSolves] || 1;
    room.scores[playerId] = (room.scores[playerId] || 0) + pts;
    
    // Increment solve count for this player
    player.solvedCount = (player.solvedCount || 0) + 1;
    player.finishedStatus = 'solved'; // For backward compatibility
    
    // Mark player as round-finished - they wait until everyone else finishes
    // They don't get their original hand back, they're done for this round
    this.markPlayerRoundFinished(roomId, playerId);
    
    return playerId;
  }

  markPlayerWaiting(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = Array.from(room.players.values()).find((p) => p.playerId === playerId) || null;
    if (!player) return;
    player.finishedStatus = 'waiting';
    // Don't mark roundFinished yet - they're waiting for no-solution to resolve
  }

  markPlayerRoundFinished(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = Array.from(room.players.values()).find((p) => p.playerId === playerId) || null;
    if (!player) return;
    player.roundFinished = true;
    player.finishedStatus = 'waiting'; // For backward compatibility
  }

  getScores(roomId) {
    const room = this.rooms.get(roomId);
    return room ? room.scores : {};
  }

  startNoSolutionTimer(roomId, originPlayerId, cb) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (room.noSolution && room.noSolution.originPlayerId === originPlayerId) return;
    if (room.noSolution && room.noSolution.timeoutId) clearTimeout(room.noSolution.timeoutId);
    const duration = 30 * 1000;
    const expiresAt = Date.now() + duration;
    const votes = new Set();
    // include origin player's hand in the broadcast so others can try solving it
    const originHand = (room.deal && room.deal.perPlayerHands && room.deal.perPlayerHands[originPlayerId]) || [];
    room.noSolution = { originPlayerId, expiresAt, votes, timeoutId: null };
    // Mark the origin as waiting (they no longer have active cards)
    this.markPlayerWaiting(roomId, originPlayerId);
    room.noSolution.timeoutId = setTimeout(() => {
      const awardedTo = originPlayerId;
      room.scores[originPlayerId] = (room.scores[originPlayerId] || 0) + 10;
      // Mark origin as round-finished (they wait without cards)
      this.markPlayerRoundFinished(roomId, originPlayerId);
      room.noSolution = null;
      cb({ awardedTo, broadcast: { originPlayerId, expired: true, originHand, type: 'no_solution' } });
    }, duration);
    cb({ awardedTo: null, broadcast: { originPlayerId, expiresAt, originHand, type: 'no_solution' } });
  }

  getNoSolutionTimerPublic(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.noSolution) return null;
    const originHand = (room.deal && room.deal.perPlayerHands && room.deal.perPlayerHands[room.noSolution.originPlayerId]) || [];
    return { originPlayerId: room.noSolution.originPlayerId, expiresAt: room.noSolution.expiresAt, votes: Array.from(room.noSolution.votes), originHand, type: 'no_solution' };
  }

  registerSkipVote(roomId, playerId, originPlayerId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.noSolution) return false;
    room.noSolution.votes.add(playerId);
    const otherPlayers = Array.from(room.players.values()).filter((p) => p.playerId !== originPlayerId);
    const allVoted = otherPlayers.every((p) => room.noSolution.votes.has(p.playerId));
    return allVoted;
  }

  finishNoSolutionBySkip(roomId, originPlayerId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.noSolution) return null;
    if (room.noSolution.timeoutId) clearTimeout(room.noSolution.timeoutId);
    const awardedTo = originPlayerId;
    room.scores[originPlayerId] = (room.scores[originPlayerId] || 0) + 10;
    // Mark origin as round-finished (they wait without cards)
    this.markPlayerRoundFinished(roomId, originPlayerId);
    const originHand = (room.deal && room.deal.perPlayerHands && room.deal.perPlayerHands[originPlayerId]) || [];
    const broadcast = { originPlayerId, skipped: true, originHand, type: 'no_solution' };
    room.noSolution = null;
    return { awardedTo, broadcast };
  }

  startRevealTimer(roomId, originPlayerId, cb) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (room.reveal && room.reveal.originPlayerId === originPlayerId) return;
    if (room.reveal && room.reveal.timeoutId) clearTimeout(room.reveal.timeoutId);
    const duration = 30 * 1000;
    const expiresAt = Date.now() + duration;
    const originHand = (room.deal && room.deal.perPlayerHands && room.deal.perPlayerHands[originPlayerId]) || [];
    room.reveal = { originPlayerId, expiresAt, timeoutId: null };
    room.reveal.timeoutId = setTimeout(() => {
      // if nobody solved during reveal, award to origin and mark as round-finished
      const awardedTo = originPlayerId;
      room.scores[originPlayerId] = (room.scores[originPlayerId] || 0) + 10;
      this.markPlayerRoundFinished(roomId, originPlayerId);
      room.reveal = null;
      cb({ awardedTo, broadcast: { originPlayerId, expired: true, originHand, type: 'reveal' } });
    }, duration);
    cb({ awardedTo: null, broadcast: { originPlayerId, expiresAt, originHand, type: 'reveal' } });
  }

  getRevealTimerPublic(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.reveal) return null;
    const originHand = (room.deal && room.deal.perPlayerHands && room.deal.perPlayerHands[room.reveal.originPlayerId]) || [];
    return { originPlayerId: room.reveal.originPlayerId, expiresAt: room.reveal.expiresAt, originHand, type: 'reveal' };
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
