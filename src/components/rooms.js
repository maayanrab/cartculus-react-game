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
      });
    }
    return this.rooms.get(id);
  }

  addPlayer(roomId, socketId, playerName) {
    const room = this._ensureRoom(roomId);
    const playerId = socketId;
    room.players.set(socketId, { playerId, name: playerName, socketId, finished: false });
    room.scores[playerId] = room.scores[playerId] || 0;
    return { playerId, name: playerName };
  }

  removePlayer(roomId, socketId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.players.delete(socketId);
  }

  removePlayerBySocket(socketId) {
    for (const [roomId, room] of this.rooms) {
      if (room.players.has(socketId)) room.players.delete(socketId);
    }
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  getRoomPublic(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return { players: [], scores: {} };
    const players = Array.from(room.players.values()).map((p) => ({ playerId: p.playerId, name: p.name, finished: p.finished }));
    return { players, scores: room.scores || {} };
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
    for (const p of room.players.values()) p.finished = false;
    const deck = this.generateDeck();
    const perPlayerHands = {};
    const players = Array.from(room.players.values());
    for (const p of players) {
      const hand = [];
      for (let i = 0; i < 4; i++) {
        hand.push({ id: `${Date.now()}-${Math.random()}`, value: deck.pop() });
      }
      perPlayerHands[p.playerId] = hand;
    }
    const target = 24;
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
    if (!player || player.finished) return null;
    const alreadyFinishedCount = Array.from(room.players.values()).filter((p) => p.finished).length;
    const pointsByOrder = [10, 7, 4, 1];
    const pts = pointsByOrder[alreadyFinishedCount] || 1;
    room.scores[playerId] = (room.scores[playerId] || 0) + pts;
    if (player) player.finished = true;
    return playerId;
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
    room.noSolution = { originPlayerId, expiresAt, votes, timeoutId: null };

    room.noSolution.timeoutId = setTimeout(() => {
      const awardedTo = originPlayerId;
      room.scores[originPlayerId] = (room.scores[originPlayerId] || 0) + 10;
      room.noSolution = null;
      cb({ awardedTo, broadcast: { originPlayerId, expired: true } });
    }, duration);

    cb({ awardedTo: null, broadcast: { originPlayerId, expiresAt } });
  }

  getNoSolutionTimerPublic(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.noSolution) return null;
    return { originPlayerId: room.noSolution.originPlayerId, expiresAt: room.noSolution.expiresAt, votes: Array.from(room.noSolution.votes) };
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
    const broadcast = { originPlayerId, skipped: true };
    room.noSolution = null;
    return { awardedTo, broadcast };
  }
}

module.exports = Rooms;
