import React, { useState, useEffect, useRef } from "react";
import Card from "./components/Card";
import { generateCardsAndTarget, operate } from "./gameLogic";
import confetti from "canvas-confetti";
import "bootstrap/dist/css/bootstrap.min.css";
import "./styles.css";
import * as socket from "./multiplayer/socket";
import Lobby from "./components/Lobby";
import PlayerList from "./components/PlayerList";
import NoSolutionTimer from "./components/NoSolutionTimer";

// Declare Audio objects globally.
let undoSound;
let operatorSound;
let successSound;
let reshuffleSound;
let cardRevealSound;
let discardHandSound;

const TOTAL_CARD_SLOTS = 4;
const MERGE_ANIMATION_DURATION = 300; // ms — shortened to match CSS fly animation

export default function App() {
  const [cards, setCards] = useState([]);
  const [target, setTarget] = useState(null);
  const [selected, setSelected] = useState([]);
  const [selectedOperator, setSelectedOperator] = useState(null);
  const [originalCards, setOriginalCards] = useState([]);
  const [history, setHistory] = useState([]);
  const [autoReshuffle, setAutoReshuffle] = useState(true); // Auto-reshuffle toggle
  const [userInteracted, setUserInteracted] = useState(false);
  const [soundsOn, setSoundsOn] = useState(true);
  const [gameStarted, setGameStarted] = useState(false);

  // Solution sharing/replay state
  const [solutionMoves, setSolutionMoves] = useState([]);
  const [hasWonCurrentRound, setHasWonCurrentRound] = useState(false);
  const [replayPendingMoves, setReplayPendingMoves] = useState(null);
  const [isReplaying, setIsReplaying] = useState(false);
  const [frozenSolution, setFrozenSolution] = useState(null);
  // Round replays (multiplayer post-round)
  const [roundReplaysQueue, setRoundReplaysQueue] = useState(null);
  const [isPlayingRoundReplays, setIsPlayingRoundReplays] = useState(false);
  const [replaysBanner, setReplaysBanner] = useState("");
  const replaysRoundTargetRef = useRef(null);
  const currentReplayHeaderRef = useRef("");
  const roundReplaysSessionIdRef = useRef(0);
  const roundReplaysDoneRef = useRef(false);

  // Multiplayer state
  const [multiplayerRoom, setMultiplayerRoom] = useState(null);
  const [playerName, setPlayerName] = useState(null);
  const [players, setPlayers] = useState([]);
  const [hostId, setHostId] = useState(null);
  const [scores, setScores] = useState({});
  const [finishedCount, setFinishedCount] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [noSolutionTimer, setNoSolutionTimer] = useState(null);
  const [showMultiplayer, setShowMultiplayer] = useState(false);
  const [waitingForOthers, setWaitingForOthers] = useState(false);
  const [pendingLoadedCount, setPendingLoadedCount] = useState(0);
  const [pendingTotalCount, setPendingTotalCount] = useState(0);
  const [waitingForOthersAfterWin, setWaitingForOthersAfterWin] = useState(false);
  const [viewingReveal, setViewingReveal] = useState(false);
  const viewingRevealRef = useRef(false);
  const revealLockRef = useRef(false);
  const clearCardsIfAllowedRef = useRef(() => {});

  // Animation states
  const [isReshuffling, setIsReshuffling] = useState(false);
  const [newCardsAnimatingIn, setNewCardsAnimatingIn] = useState(false);
  const [cardsToRender, setCardsToRender] = useState([]);
  const [handCardsFlipped, setHandCardsFlipped] = useState(false);
  const [targetCardFlipped, setTargetCardFlipped] = useState(false);
  const [currentRoundTarget, setCurrentRoundTarget] = useState(null);
  const [flyingCardInfo, setFlyingCardInfo] = useState(null); // For merge animation

  const cardRefs = useRef({});
  const centerRef = useRef(null);
  const cardsRef = useRef(cards);
  const originalCardsRef = useRef(originalCards);
  const isReplayingRef = useRef(isReplaying);
  const flyingCardInfoRef = useRef(flyingCardInfo);
  const mergeResolveRef = useRef(null);
  const mergeTimeoutRef = useRef(null); // <--- new: to cancel merge finish
  const reshuffleAbortRef = useRef(false); // <--- new: to abort reshuffle sequence
  const replayInitialCardsRef = useRef(null);
  const replayInitialTargetRef = useRef(null);
  const replaySessionIdRef = useRef(0);
  const tempHandBackupRef = useRef(null);
  const roundStartHandRef = useRef(null); // Snapshot of hand at round start
  const [originNoSolutionActive, setOriginNoSolutionActive] = useState(false); // Origin-only no-solution viewing state
  const pendingDealRef = useRef(null);
  const pendingRiddleRef = useRef(null);
  const waitingForOthersAfterWinRef = useRef(waitingForOthersAfterWin);
  const timerClearTimeoutRef = useRef(null); // Track timeout for clearing timer
  const noSolutionTimerRef = useRef(noSolutionTimer); // Track latest timer in closures
  const lastRevealHandRef = useRef(null); // Keep latest revealed origin hand for safety rehydrate
  const lastRevealOriginRef = useRef(null); // Track origin playerId for reveal HUD
    const lastRevealExpiresAtRef = useRef(null); // Track reveal expiry for countdown HUD
  const selectedRef = useRef(selected);
  const selectedOperatorRef = useRef(selectedOperator);
  const historyRef = useRef(history);
  const isSharedRiddle = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const hasCards = !!params.get("cards");
      const hasTarget = !!params.get("target");
      const hasSolution = !!params.get("solution");
      return hasCards && hasTarget && !hasSolution;
    } catch {
      return false;
    }
  })();
  const isSharedSolution = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return !!params.get("solution");
    } catch {
      return false;
    }
  })();
  const mySocketId = socket.getSocketId();
  const showingOriginHand = Boolean(
    noSolutionTimer &&
    mySocketId &&
    noSolutionTimer.originPlayerId &&
    mySocketId !== noSolutionTimer.originPlayerId &&
    Array.isArray(noSolutionTimer.originHand)
  );
  // Reveal-aware flag to keep the "Player's cards" frame visible during reveal
  const showingRevealHand = Boolean(
    viewingRevealRef.current &&
    mySocketId &&
    (
      (
        noSolutionTimer &&
        noSolutionTimer.originPlayerId &&
        mySocketId !== noSolutionTimer.originPlayerId &&
        Array.isArray(noSolutionTimer.originHand) &&
        noSolutionTimer.originHand.length > 0
      ) || (
        lastRevealOriginRef.current &&
        mySocketId !== lastRevealOriginRef.current &&
        Array.isArray(lastRevealHandRef.current) &&
        lastRevealHandRef.current.length > 0
      )
    )
  );
  const currentMode = isSharedSolution ? "solution" : isSharedRiddle ? "riddle" : "casual";
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);
  useEffect(() => {
    originalCardsRef.current = originalCards;
  }, [originalCards]);
  useEffect(() => {
    isReplayingRef.current = isReplaying;
  }, [isReplaying]);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    selectedOperatorRef.current = selectedOperator;
  }, [selectedOperator]);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  useEffect(() => {
    waitingForOthersAfterWinRef.current = waitingForOthersAfterWin;
    // If we've just cleared the waiting state, process any pending queued deals
    if (!waitingForOthersAfterWin && pendingDealRef.current) {
      try {
        const d = pendingDealRef.current;
        pendingDealRef.current = null;
        processDealPending(d);
      } catch (e) {
        console.error('error processing queued deal_pending', e);
      }
    }
    if (!waitingForOthersAfterWin && pendingRiddleRef.current) {
      try {
        const r = pendingRiddleRef.current;
        pendingRiddleRef.current = null;
        processDealRiddle(r);
      } catch (e) {
        console.error('error processing queued deal_riddle', e);
      }
    }
  }, [waitingForOthersAfterWin]);
  useEffect(() => {
    viewingRevealRef.current = viewingReveal;
  }, [viewingReveal]);
  useEffect(() => {
    noSolutionTimerRef.current = noSolutionTimer;
  }, [noSolutionTimer]);

  // In Solution Replay mode, force Auto-reshuffle OFF and keep it disabled
  useEffect(() => {
    if (currentMode === "solution" && autoReshuffle) {
      setAutoReshuffle(false);
    }
  }, [currentMode, autoReshuffle]);

  // While reveal is active, never show "waiting" UI that could hide cards
  useEffect(() => {
    if (viewingRevealRef.current && waitingForOthersAfterWin) {
      console.log("[CLIENT] reveal guard: forcing not-waiting during active reveal");
      setWaitingForOthersAfterWin(false);
    }
  }, [waitingForOthersAfterWin, viewingReveal]);

  // Safety: while viewing reveal, ensure cards remain visible. Use cached originHand if timer cleared.
  useEffect(() => {
    try {
      if (!viewingRevealRef.current) return;
      const timer = noSolutionTimer;
      const originHand = (timer && timer.type === "reveal" && !timer.expired && !timer.skipped && Array.isArray(timer.originHand) && timer.originHand.length > 0)
        ? timer.originHand
        : (Array.isArray(lastRevealHandRef.current) && lastRevealHandRef.current.length > 0 ? lastRevealHandRef.current : null);
      if (!originHand) return;

      const visibleCount = (cardsRef.current || []).filter(c => !c.invisible && !c.isPlaceholder).length;
      const shouldRehydrate = (!cardsRef.current || cardsRef.current.length === 0 || visibleCount === 0);
      if (!shouldRehydrate) return;
      const incoming = originHand.map((c) => ({
        id: c.id,
        value: c.value,
        isPlaceholder: false,
        invisible: false,
      }));
      console.log("[CLIENT] reveal safety rehydrate", { count: incoming.length });
      setCards(incoming);
      setOriginalCards(originHand);
      setWaitingForOthersAfterWin(false);
    } catch (e) {
      // ignore
    }
  }, [viewingReveal, noSolutionTimer, cards]);

  // Detect any card disappearance during reveal to help diagnose stray clears
  useEffect(() => {
    if (!viewingRevealRef.current) return;
    const visibleCount = (cardsRef.current || []).filter(c => !c.invisible && !c.isPlaceholder).length;
    if (!cardsRef.current || cardsRef.current.length === 0 || visibleCount === 0) {
      console.warn("[CLIENT] reveal guard: cards hidden/empty during reveal", { len: (cardsRef.current || []).length, visibleCount });
    }
  }, [cards, viewingReveal]);

  // Centralized cards clear function guarded by reveal/viewing flags
  clearCardsIfAllowedRef.current = () => {
    if (revealLockRef.current || viewingRevealRef.current) return;
    setCards([]);
    setOriginalCards([]);
  };
  useEffect(() => {
    flyingCardInfoRef.current = flyingCardInfo;
  }, [flyingCardInfo]);

  // Helpers for solution encode/decode
  const encodeSolution = (cardsValues, theTarget, moves) => {
    try {
      const payload = { v: 1, c: cardsValues, t: theTarget, m: moves };
      return encodeURIComponent(btoa(JSON.stringify(payload)));
    } catch (e) {
      console.error("Failed encoding solution:", e);
      return null;
    }
  };
  const decodeSolution = (encoded) => {
    try {
      const json = atob(decodeURIComponent(encoded));
      const obj = JSON.parse(json);
      if (!obj || obj.v !== 1 || !Array.isArray(obj.c) || !Array.isArray(obj.m)) {
        return null;
      }
      return obj;
    } catch (e) {
      console.error("Failed decoding solution:", e);
      return null;
    }
  };
  const buildShareSolutionUrl = () => {
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const shareData = frozenSolution
      ? frozenSolution
      : { c: originalCards.map((c) => c.value), t: target, m: solutionMoves };
    const encoded = encodeSolution(shareData.c, shareData.t, shareData.m);
    if (!encoded) return null;
    return `${baseUrl}?cards=${shareData.c.join(",")}&target=${shareData.t}&solution=${encoded}`;
  };
  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      alert("Link copied to clipboard");
    } catch (e) {
      console.error("Clipboard copy failed:", e);
    }
  };
  const replaySolution = async (moves) => {
    if (!Array.isArray(moves) || moves.length === 0) return;
    const sessionId = ++replaySessionIdRef.current;
    setIsReplaying(true);
    // Ensure any initial animations are done
    await waitForMergeToFinish();
    if (sessionId !== replaySessionIdRef.current) {
      setIsReplaying(false);
      return;
    }
    for (let i = 0; i < moves.length; i++) {
      if (sessionId !== replaySessionIdRef.current) {
        setIsReplaying(false);
        return;
      }
      const step = moves[i];
      // Prefer slot-based addressing for deterministic replays
      let cardA;
      let cardB;
      if (typeof step.aSlot === "number" && typeof step.bSlot === "number") {
        cardA = cardsRef.current[step.aSlot];
        cardB = cardsRef.current[step.bSlot];
      }
      if (!cardA || !cardB || cardA.invisible || cardB.invisible) {
        // Backward compatibility: visible-index based
        const visible = (cardsRef.current || []).filter(
          (c) => !c.invisible && !c.isPlaceholder
        );
        let candidateA = typeof step.aIndex === "number" ? visible[step.aIndex] : undefined;
        let candidateB = typeof step.bIndex === "number" ? visible[step.bIndex] : undefined;
        // If we have operand values recorded, try to refine selection
        if ((!candidateA || step.aValue !== undefined) && visible.length) {
          const matchesA = visible.filter((c) => c.value === step.aValue);
          if (matchesA.length === 1) candidateA = matchesA[0];
        }
        if ((!candidateB || step.bValue !== undefined) && visible.length) {
          const matchesB = visible.filter((c) => c.value === step.bValue);
          // Avoid picking the same instance if equal values
          if (matchesB.length === 1) candidateB = matchesB[0];
          else if (matchesB.length > 1 && candidateA) {
            candidateB = matchesB.find((c) => c.id !== candidateA.id) || matchesB[0];
          }
        }
        cardA = candidateA;
        cardB = candidateB;
        if (!cardA || !cardB) {
          console.warn("Replay step candidates not found", step, visible);
          break;
        }
      }
      // Step-by-step highlighting with pauses
      // eslint-disable-next-line no-await-in-loop
      await highlightStep(cardA.id, step.op, cardB.id);
      // Execute and await this merge to finish before continuing
      // eslint-disable-next-line no-await-in-loop
      await performOperationAndWait([cardA.id, cardB.id], step.op);
      // Clear highlights briefly between steps
      setSelected([]);
      setSelectedOperator(null);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 150));
    }
    setIsReplaying(false);
    // After finishing, loop replay after a longer pause
    if (
      sessionId === replaySessionIdRef.current &&
      replayInitialCardsRef.current &&
      replayInitialTargetRef.current
    ) {
      await new Promise((r) => setTimeout(r, 3000));
      if (sessionId !== replaySessionIdRef.current) return;
      setReplayPendingMoves(moves);
      startNewRound(false, replayInitialCardsRef.current, replayInitialTargetRef.current);
    }
  };

  // Replay pacing configuration
  const REPLAY_DELAY_FIRST_CARD = 500;     // pause after highlighting first card
  const REPLAY_DELAY_OPERATOR = 500;       // pause after selecting operator
  const REPLAY_DELAY_SECOND_CARD = 350;    // pause after highlighting second card
  const REPLAY_DELAY_BEFORE_MERGE = 200;   // tiny pause before cards merge
  const REPLAY_POST_MERGE_BUFFER = 500;    // small buffer after merge settles
  const REPLAY_PRE_ITEM_DELAY = 120;       // short pause before starting each replay item

  const highlightStep = async (aId, op, bId) => {
    setSelected([aId]);
    await new Promise((r) => setTimeout(r, REPLAY_DELAY_FIRST_CARD));
    setSelectedOperator(op);
    await new Promise((r) => setTimeout(r, REPLAY_DELAY_OPERATOR));
    setSelected([aId, bId]);
    await new Promise((r) => setTimeout(r, REPLAY_DELAY_SECOND_CARD));
  };

  const performOperationAndWait = async ([aId, bId], op) => {
    // Ensure DOM nodes are present for animation measurements
    await waitForCardRefs(aId, bId);
    let resolved = false;
    const waitPromise = new Promise((resolve) => {
      mergeResolveRef.current = () => {
        if (!resolved) {
          resolved = true;
          mergeResolveRef.current = null;
          resolve();
        }
      };
    });
    // Safety timeout to avoid hanging forever
    const timeoutPromise = new Promise((resolve) =>
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          mergeResolveRef.current = null;
          resolve();
        }
      }, MERGE_ANIMATION_DURATION + 400)
    );
    // Tiny pause before triggering the actual merge to improve clarity
    await new Promise((r) => setTimeout(r, REPLAY_DELAY_BEFORE_MERGE));
    performOperation([aId, bId], op);
    await Promise.race([waitPromise, timeoutPromise]);
    // Small buffer to settle
    await new Promise((r) => setTimeout(r, REPLAY_POST_MERGE_BUFFER));
  };

  const waitForMergeToFinish = async () => {
    // Wait until flyingCardInfo is cleared, then a small buffer for state to settle
    const maxWaitMs = 5000;
    const pollIntervalMs = 30;
    let waited = 0;
    while (flyingCardInfoRef.current && waited < maxWaitMs) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      waited += pollIntervalMs;
    }
    // small buffer
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 100));
  };

  const waitForCardRefs = async (aId, bId) => {
    const maxWaitMs = 1000;
    const pollIntervalMs = 20;
    let waited = 0;
    while (
      (!cardRefs.current[aId] || !cardRefs.current[bId]) &&
      waited < maxWaitMs
    ) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      waited += pollIntervalMs;
    }
  };

  useEffect(() => {
    const handleInitialInteraction = () => {
      if (!userInteracted) {
        undoSound = new Audio("./sounds/undo.wav");
        operatorSound = new Audio("./sounds/operator.wav");
        successSound = new Audio("./sounds/success.wav");
        reshuffleSound = new Audio("./sounds/reshuffle.wav");
        cardRevealSound = new Audio("./sounds/card_reveal.wav");
        discardHandSound = new Audio("./sounds/discard_hand.wav");

        const soundsToLoad = [
          undoSound,
          operatorSound,
          successSound,
          reshuffleSound,
          cardRevealSound,
          discardHandSound,
        ];
        soundsToLoad.forEach((sound) => {
          if (sound) {
            sound.load();
            sound.onerror = () =>
              console.error(`Error loading sound: ${sound.src}`);
          }
        });

        setUserInteracted(true);
        // Do not auto-start the game here; only unlock audio.

        document.removeEventListener("click", handleInitialInteraction);
        document.removeEventListener("keydown", handleInitialInteraction);
      }
    };

    if (!userInteracted) {
      document.addEventListener("click", handleInitialInteraction);
      document.addEventListener("keydown", handleInitialInteraction);
    }

    return () => {
      document.removeEventListener("click", handleInitialInteraction);
      document.removeEventListener("keydown", handleInitialInteraction);
    };
  }, [userInteracted, gameStarted]);

  // Multiplayer socket handlers
  useEffect(() => {
    socket.connect();
    socket.on("lobby_update", (data) => {
      setPlayers(data.players || []);
      setScores(data.scores || {});
      setHostId(data.hostId || null);
      setFinishedCount(data.finishedCount || 0);
      setActiveCount(data.activeCount || 0);
    });

    // helper: process an incoming reveal (deal_riddle)
    const processDealRiddle = (data) => {
      // reveal moment: stop waiting UI
      setWaitingForOthers(false);
      setWaitingForOthersAfterWin(false);
      // Reset replays done flag for the new round
      roundReplaysDoneRef.current = false;
      // Clear any temp backups from previous timers/replays to avoid skipping restores
      tempHandBackupRef.current = null;
      const myId = socket.getSocketId();
      const myHand = (data.perPlayerHands && data.perPlayerHands[myId]) || [];
      // Play the entry animation for incoming multiplayer deal so clients
      // experience the same visual reshuffle/flip as local players.
      (async () => {
        try {
          await playIncomingDeal(myHand, data.target);
        } catch (e) {
          console.error("playIncomingDeal failed", e);
          // Fallback to immediate set if animation fails
          const finalCards = myHand.map((c) => ({ id: c.id, value: c.value, isPlaceholder: false, invisible: false }));
          setCards(finalCards);
          // Preserve the original card ids for multiplayer so Reset can rebuild correct ids
          setOriginalCards(myHand);
          setTarget(data.target);
          setCurrentRoundTarget(data.target);
          setGameStarted(true);
        }
      })();
    };

    socket.on("deal_riddle", (data) => {
      // If this client is currently waiting for others after finishing, queue the reveal
      if (waitingForOthersAfterWinRef.current) {
        pendingRiddleRef.current = data;
        return;
      }
      // Only process deal_riddle if we're not actively playing with cards
      // This should only happen at round start, not when someone else solves
      // If we have cards and are not in a reshuffle animation, this is likely a spurious event
      const hasActiveCards = cards.length > 0 && cards.some(c => !c.invisible && !c.isPlaceholder);
      if (hasActiveCards && !isReshuffling && !newCardsAnimatingIn && gameStarted && !waitingForOthers) {
        console.warn("Received deal_riddle while actively playing - ignoring to prevent interrupting gameplay");
        return;
      }
        // Any new riddle indicates a fresh round: clear lingering reveal state
        setViewingReveal(false);
        viewingRevealRef.current = false;
        revealLockRef.current = false;
        lastRevealHandRef.current = null;
        lastRevealOriginRef.current = null;
        lastRevealExpiresAtRef.current = null;
        if (timerClearTimeoutRef.current) { try { clearTimeout(timerClearTimeoutRef.current); } catch {} timerClearTimeoutRef.current = null; }
        setNoSolutionTimer(null);
        processDealRiddle(data);
    });

    // helper: process a pending deal
    const processDealPending = (data) => {
      try {
        // New round starting: clear any lingering reveal state/UI
        setViewingReveal(false);
        viewingRevealRef.current = false;
        revealLockRef.current = false;
        lastRevealHandRef.current = null;
        lastRevealOriginRef.current = null;
        lastRevealExpiresAtRef.current = null;
        if (timerClearTimeoutRef.current) { try { clearTimeout(timerClearTimeoutRef.current); } catch {} timerClearTimeoutRef.current = null; }
        setNoSolutionTimer(null);
        // Reset replays done flag for the incoming round
        roundReplaysDoneRef.current = false;
        // Clear temp backups so state_sync can restore hands normally
        tempHandBackupRef.current = null;
        const myHand = data.hand || [];
        // Load cards into state but keep them face-down (handCardsFlipped false, targetCardFlipped false)
        const finalCards = myHand.map((c) => ({ id: c.id, value: c.value, isPlaceholder: false, invisible: false }));
        setCards(finalCards);
        // Preserve full card objects for reset/undo
        setOriginalCards(myHand);
        // Snapshot round-start hand for potential origin no-solution display
        roundStartHandRef.current = myHand ? myHand.map((c) => ({ ...c })) : [];
        if (data.target !== undefined) {
          setTarget(data.target);
          setCurrentRoundTarget(data.target);
        }
        // Ensure visual state starts upside-down
        setHandCardsFlipped(false);
        setTargetCardFlipped(false);
        setGameStarted(true);
        // Show waiting UI until server reveals
        setWaitingForOthers(true);
        setWaitingForOthersAfterWin(false);
        setPendingLoadedCount(0);
        setPendingTotalCount((prev) => prev);
        // Clear any leftover timer state from previous round
        setNoSolutionTimer(null);
        tempHandBackupRef.current = null;
        // Ack to server that this client has loaded the pending deal
        try { socket.emitDealLoaded(data.roomId || multiplayerRoom); } catch (e) { }
      } catch (e) {
        console.error("error handling deal_pending", e);
      }
    };

    // When server sends a pending deal, load the cards face-down and ack when ready.
    socket.on("deal_pending", (data) => {
      processDealPending(data);
    });

    socket.on("state_sync", (state) => {
      console.log("[CLIENT] state_sync", {
        hasCards: state && Array.isArray(state.cards) ? state.cards.length : null,
        target: state && state.target,
        scores: state && state.scores,
        viewingReveal: viewingRevealRef.current,
        revealLock: revealLockRef.current,
      });
      const myId = socket.getSocketId();

      // If we had a backup from a no-solution challenge and this player was already
      // waiting before that challenge, they should remain waiting and not get a new
      // active hand restored.
      const backup = tempHandBackupRef.current;
      if (
        backup &&
        backup.wasWaiting &&
        state &&
        state.cards &&
        state.cards.length > 0
      ) {
        // Keep waiting; don't restore a new active hand
        setWaitingForOthersAfterWin(true);
        return;
      }

      if (state && state.cards && state.cards.length > 0) {
        console.log("[CLIENT] state_sync: clearing lingering reveal for new round");
        setViewingReveal(false);
        viewingRevealRef.current = false;
        revealLockRef.current = false;
        lastRevealHandRef.current = null;
        lastRevealOriginRef.current = null;
        lastRevealExpiresAtRef.current = null;
        setNoSolutionTimer(null);

        // Restore my own original hand (used after no-solution expires / skip ends,
        // or when I solved someone else's no-solution challenge and should get my
        // original cards back).
        const finalCards = state.cards.map((c) => ({
          id: c.id,
          value: c.value,
          isPlaceholder: false,
          invisible: false,
        }));

        setCards(finalCards);
        setOriginalCards(state.cards || []);

        if (state.target) {
          setTarget(state.target);
          setCurrentRoundTarget(state.target);
        }

        if (state.scores) setScores(state.scores);

        setGameStarted(true);
        // If we're getting a restored hand, we're actively playing again
        setWaitingForOthersAfterWin(false);
        setHasWonCurrentRound(false);
        setHistory([]);
        setSolutionMoves([]);
        setSelected([]);
        setSelectedOperator(null);
      } else {
        // State without cards but with meta-data (scores/target)
        if (state && state.target) {
          setTarget(state.target);
          setCurrentRoundTarget(state.target);
        }
        if (state && state.scores) setScores(state.scores);

        if (state && state.cards && state.cards.length === 0) {
          console.log("[CLIENT] state_sync empty cards", { viewingReveal: viewingRevealRef.current, revealLock: revealLockRef.current });
          if (revealLockRef.current) {
            return;
          }
          setCards([]);
          setOriginalCards([]);
        }
      }
    });

    // no_solution updates handled below (includes restore logic)
    // When receiving a no-solution/reveal update, set the timer
    socket.on("reveal_timer", (payload) => {
      console.log("[CLIENT] reveal_timer", payload);
      // Cancel any pending timeout that would clear the timer
      if (timerClearTimeoutRef.current) {
        clearTimeout(timerClearTimeoutRef.current);
        timerClearTimeoutRef.current = null;
      }
      setNoSolutionTimer(payload);
      
      try {
        const myId = socket.getSocketId();
        const originId = payload && payload.originPlayerId;
        const isOrigin = myId && originId && myId === originId;
        
        // Track reveal viewing state for finished players to prevent premature hiding
        if (payload && payload.type === "reveal" && !payload.expired && !payload.skipped) {
          // Ensure origin-only disabled state is off during reveal
          setOriginNoSolutionActive(false);
          setViewingReveal(true);
          revealLockRef.current = true;
          if (Array.isArray(payload.originHand) && payload.originHand.length > 0) {
            lastRevealHandRef.current = payload.originHand;
          }
          if (payload && payload.originPlayerId) {
            lastRevealOriginRef.current = payload.originPlayerId;
                if (payload && payload.expiresAt) {
                  lastRevealExpiresAtRef.current = payload.expiresAt;
                }
          }
          
          // Non-origin players should immediately see the origin's revealed cards,
          // even if they were in a "waiting" state after finishing earlier.
          if (!isOrigin && Array.isArray(payload.originHand) && payload.originHand.length > 0) {
            // Backup current state if not already backed up
            if (!tempHandBackupRef.current) {
              tempHandBackupRef.current = {
                cards: cardsRef.current,
                original: originalCardsRef.current,
                wasWaiting: waitingForOthersAfterWinRef.current,
                history: historyRef.current,
              };
            }
            const incoming = payload.originHand.map((c) => ({ 
              id: c.id, 
              value: c.value, 
              isPlaceholder: false, 
              invisible: false 
            }));
            setCards(incoming);
            setOriginalCards(payload.originHand);
            setGameStarted(true);
            // Clear waiting state so revealed cards are visible
            setWaitingForOthersAfterWin(false);
            setHistory([]);
            setSelected([]);
            setSelectedOperator(null);
            console.log("[CLIENT] reveal swap to origin hand", { cardsCount: incoming.length });
          }
        }
        
        // If this reveal timer is finished (expired/skipped), clear it after delay
        if (payload && (payload.expired || payload.skipped)) {
          setViewingReveal(false);
          setOriginNoSolutionActive(false);
          revealLockRef.current = false;
          timerClearTimeoutRef.current = setTimeout(() => {
            const current = noSolutionTimerRef.current;
            if (current && current.type === "reveal" && !current.expired && !current.skipped) {
              // A new reveal is active; do not clear the timer UI
              return;
            }
            setNoSolutionTimer(null);
            timerClearTimeoutRef.current = null;
          }, 1200);
        }
      } catch (e) {
        console.error("error handling reveal_timer", e);
      }
    });

    // Ensure that when the no-solution is resolved (skipped/expired/resolvedBy)
    // we handle restoration. The server will send state_sync to non-origin players.
    socket.on("no_solution_timer", (payload) => {
      console.log("[CLIENT] no_solution_timer", payload);
      // Cancel any pending timeout that would clear the timer
      if (timerClearTimeoutRef.current) {
        clearTimeout(timerClearTimeoutRef.current);
        timerClearTimeoutRef.current = null;
      }
      
      setNoSolutionTimer(payload);
      try {
        if (!payload) return;
        const myId = socket.getSocketId();
        const isOrigin = myId && payload.originPlayerId === myId;
        const finished = payload.expired || (payload.skipped && !payload.skipComplete) || payload.resolvedBy;
        
        // If this is the START of a no-solution timer and I'm the origin
        if (isOrigin && !finished && !payload.skipComplete) {
          // Origin should see their own starting-round cards, disabled/grayed
          setOriginNoSolutionActive(true);
          // Reset to round-start snapshot so user sees initial hand state
          const snapshot = Array.isArray(roundStartHandRef.current) ? roundStartHandRef.current : [];
          const finalCards = snapshot.map((c) => ({ id: c.id, value: c.value, isPlaceholder: false, invisible: false }));
          setCards(finalCards);
          setOriginalCards(snapshot);
          setHistory([]);
          setSelected([]);
          setSelectedOperator(null);
          setGameStarted(true);
          // Still indicate waiting for verdict in HUD, but do not show generic waiting overlay
          setWaitingForOthersAfterWin(false);
          tempHandBackupRef.current = null;
        }
        
        if (finished) {
          // Origin player waits without cards - server won't send state_sync to them
          if (isOrigin) {
            // End origin-only viewing state
            setOriginNoSolutionActive(false);
            // Keep waiting message if not transitioning into reveal
            if (!viewingRevealRef.current) {
              setWaitingForOthersAfterWin(true);
              // Optionally hide cards now
              clearCardsIfAllowedRef.current();
            }
            tempHandBackupRef.current = null;
          }
          // Non-origin players will get state_sync from server to restore their original hands
          // Clear timer shortly after to allow UX to show final state
          timerClearTimeoutRef.current = setTimeout(() => {
            const current = noSolutionTimerRef.current;
            if (current && current.type === "reveal" && !current.expired && !current.skipped) {
              // A reveal is active; do not clear timer state/UI
              return;
            }
            setNoSolutionTimer(null);
            timerClearTimeoutRef.current = null;
          }, 1200);
        }
      } catch (e) {
        console.error('error handling no_solution_timer restore', e);
      }
    });
    socket.on("score_update", (payload) => {
      console.log("[CLIENT] score_update", payload);
      const scoresPayload = (payload && payload.scores) || {};
      setScores(scoresPayload);
      try {
        const awardedTo = payload && payload.awardedTo;
        const myId = socket.getSocketId();
        const reason = payload && payload.reason; // NEW

        if (awardedTo && myId && awardedTo === myId) {
          // If I solved someone else's no-solution challenge, I should
          // get the points but KEEP playing with my original cards.
          if (reason === "no_solution_challenge") {
            try { confetti(); } catch { }
            try { playSound(successSound); } catch { }
            // IMPORTANT: do NOT clear cards or set Waiting-for-others here
            return;
          }

          // If this was a timeout/skip award, avoid clearing cards immediately;
          // rely on reveal/no-solution handlers to manage visibility.
          const isOwnWin = reason === "win";
          const timer = noSolutionTimer;
          const isWatchingOthersTimerNow = !!(
            timer &&
            timer.originPlayerId &&
            myId !== timer.originPlayerId &&
            (timer.type === "reveal" || timer.type === "no_solution")
          );

          // All other reasons (normal win, my no-solution was accepted, etc.)
          // mean I'm done for this round and should wait for others.
          try { confetti(); } catch { }
          try { playSound(successSound); } catch { }
          setHasWonCurrentRound(true);
          if (isOwnWin && !isWatchingOthersTimerNow) {
            // To avoid race with reveal_timer arriving slightly later, defer
            // the transition to waiting and re-check if a timer became active.
            setTimeout(() => {
              const t = noSolutionTimer;
              const isWatchingOthersTimerLater = !!(
                t &&
                t.originPlayerId &&
                myId !== t.originPlayerId &&
                (t.type === "reveal" || t.type === "no_solution") &&
                !t.expired && !t.skipped
              );
              if (!isWatchingOthersTimerLater && !revealLockRef.current && !viewingRevealRef.current) {
                console.log("[CLIENT] score_update: clearing cards after win", { viewingReveal: viewingRevealRef.current, revealLock: revealLockRef.current });
                clearCardsIfAllowedRef.current();
                setWaitingForOthersAfterWin(true);
              } else {
                setWaitingForOthersAfterWin(false);
              }
            }, 250);
          } else {
            // Maintain the ability to view the origin's cards during the active timer
            if (!viewingRevealRef.current) {
              setWaitingForOthersAfterWin(false);
            }
          }
        }
      } catch (e) {
        console.error("handling score_update", e);
      }
    });


    socket.on("pending_status", (payload) => {
      try {
        if (!payload) return;
        // Suppress waiting overlay during replays phase
        if (isPlayingRoundReplays) return;
        setPendingLoadedCount(payload.loadedCount || 0);
        setPendingTotalCount(payload.total || 0);
        setWaitingForOthers((payload.loadedCount || 0) < (payload.total || 0));
      } catch (e) {
        console.error("error handling pending_status", e);
      }
    });

    // Round replays broadcast from server (multiplayer post-round)
    socket.on("round_replays", (data) => {
      try {
        if (!data || !Array.isArray(data.items) || data.items.length === 0) return;
        // Ignore duplicate broadcasts if we're already playing or have completed this round's replays
        if (isPlayingRoundReplays || roundReplaysDoneRef.current) {
          console.log("[CLIENT] round_replays ignored (already playing/done)");
          return;
        }
        // Items already enriched with names/headers by server
        setRoundReplaysQueue(data.items);
        // Start a new replays session; used to prevent accidental re-entry
        roundReplaysSessionIdRef.current += 1;
        playRoundReplaysSequentially(data.items, roundReplaysSessionIdRef.current);
      } catch (e) {
        console.error("error handling round_replays", e);
      }
    });

    return () => {
      try { socket.disconnect(); } catch (e) { }
    };
  }, []);

  // When a no-solution or reveal timer starts, non-origin players temporarily
  // get the origin player's hand to attempt solving. Restore when timer ends.
  useEffect(() => {
    if (!noSolutionTimer) {
      // restore if we had a temporary hand (only for non-origin players)
      if (tempHandBackupRef.current) {
        const currentId = socket.getSocketId();
        // Only restore if we're not the origin player (origin waits without cards)
        // The server will send state_sync to non-origin players to restore their hands
        // So we only restore from backup if state_sync hasn't arrived yet
        if (currentId) {
          setCards(tempHandBackupRef.current.cards || []);
          setOriginalCards(tempHandBackupRef.current.original || []);
          // Restore the player's undo history so they can continue where they left off
          setHistory(tempHandBackupRef.current.history || []);
          // Clear selection when returning to own cards
          setSelected([]);
          setSelectedOperator(null);
        }
        tempHandBackupRef.current = null;
      }
      return;
    }
    // If the timer payload indicates the timer finished (expired/skipped/resolved), handle restoration
    if (noSolutionTimer.expired || noSolutionTimer.skipped || noSolutionTimer.resolvedBy) {
      const currentId = socket.getSocketId();
      const originId = noSolutionTimer.originPlayerId;
      const isOrigin = currentId && originId && currentId === originId;

      if (isOrigin) {
        // Origin player: end no-solution active view
        setOriginNoSolutionActive(false);
        setWaitingForOthersAfterWin(true);
        tempHandBackupRef.current = null;
      } else {
        // Non-origin players: restore their original hands.
        // Use the backup we saved when we first swapped to the origin's cards.
        const backup = tempHandBackupRef.current;
        if (backup) {
          setCards(backup.cards || []);
          setOriginalCards(backup.original || []);
          // Restore the player's undo history so they can continue where they left off
          setHistory(backup.history || []);
          // Clear selection when returning to own cards
          setSelected([]);
          setSelectedOperator(null);
          // If this player was already in a waiting state before the no-solution
          // challenge, return them to that waiting state (no active cards).
          if (backup.wasWaiting && !viewingRevealRef.current) {
            clearCardsIfAllowedRef.current();
            setWaitingForOthersAfterWin(true);
          }
          tempHandBackupRef.current = null;
        }
      }
      // clear the timer UI after handling
      setTimeout(() => setNoSolutionTimer(null), 2000);
      return;
    }
    const currentId = socket.getSocketId();
    const originId = noSolutionTimer.originPlayerId;
    // only swap hands for players who are NOT the origin
    if (currentId && originId && currentId !== originId && Array.isArray(noSolutionTimer.originHand)) {
      // backup current hand so we can restore later (even if empty, for players who finished)
      if (!tempHandBackupRef.current) {
        tempHandBackupRef.current = {
          cards,
          original: originalCards,
          wasWaiting: waitingForOthersAfterWinRef.current,
          history: historyRef.current, // Save the player's undo history
        };
      }
      const incoming = noSolutionTimer.originHand.map((c) => ({ id: c.id, value: c.value, isPlaceholder: false, invisible: false }));
      setCards(incoming);
      // Preserve full card objects so Reset/Undo and id-based selection work correctly
      setOriginalCards(noSolutionTimer.originHand);
      setGameStarted(true);
      // Clear waiting state so player can see and interact with the origin's cards
      setWaitingForOthersAfterWin(false);
      // Clear history/undo stack so players can't undo and modify the origin's cards
      setHistory([]);
      // Clear selection state so previous card/operator selections don't interfere
      setSelected([]);
      setSelectedOperator(null);
    }
  }, [noSolutionTimer]);

  const handleJoined = ({ roomId, playerName }) => {
    setMultiplayerRoom(roomId);
    setPlayerName(playerName);
    // Keep multiplayer screen active so user sees the room details page
    setShowMultiplayer(true);
  };

  const handleGoHome = () => {
    // Always hide multiplayer UI and return to main menu
    setShowMultiplayer(false);
    // If currently in a room, leave it
    if (multiplayerRoom) {
      try { socket.leaveRoom(multiplayerRoom); } catch (e) { }
      setMultiplayerRoom(null);
      setPlayers([]);
      setScores({});
      setHostId(null);
      setPlayerName(null);
    }
    
    // Clear all multiplayer-related states
    setWaitingForOthersAfterWin(false);
    setWaitingForOthers(false);
    setPendingLoadedCount(0);
    setPendingTotalCount(0);
    setNoSolutionTimer(null);
    setFinishedCount(0);
    setActiveCount(0);
    tempHandBackupRef.current = null;
    pendingDealRef.current = null;
    pendingRiddleRef.current = null;
    
    // Clear timer timeout if any
    if (timerClearTimeoutRef.current) {
      clearTimeout(timerClearTimeoutRef.current);
      timerClearTimeoutRef.current = null;
    }
    
    // Clear game state
    setIsReplaying(false);
    replaySessionIdRef.current += 1; // cancel any queued replay loops
    setReplayPendingMoves(null);
    setSelected([]);
    setSelectedOperator(null);
    setHistory([]);
    setSolutionMoves([]);
    setHasWonCurrentRound(false);
    setFlyingCardInfo(null);
    setCards([]);
    setOriginalCards([]);
    setTarget(null);
    setCurrentRoundTarget(null);
    setFrozenSolution(null);
    
    document.body.classList.remove("scrolling-disabled");
    try { window.history.replaceState(null, "", window.location.pathname); } catch { }
    setGameStarted(false);
  };

  const playSound = (audio) => {
    // If the sound object exists and sounds are enabled, play it.
    // We don't rely on the React `userInteracted` state here, because the first
    // multiplayer deal can arrive before that state update is visible in this closure.
    if (!audio || !soundsOn) return;
    try {
      audio.currentTime = 0;
      audio.play().catch((e) => console.error("Error playing sound:", e));
    } catch (e) {
      console.error("Error playing sound:", e);
    }
  };


  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const startNewRound = async (
    playInitialDiscardSound = true,
    presetCards = null,
    presetTarget = null
  ) => {
    // If we're in multiplayer, request the server to reshuffle/deal so
    // all players receive the same shared target and hands.
    if (multiplayerRoom) {
      try {
        socket.requestReshuffle(multiplayerRoom);
      } catch (e) {
        console.error("requestReshuffle failed", e);
      }
      return;
    }
    // Allow starting reshuffle even if state thinks it's already reshuffling,
    // but do not start a reshuffle in the middle of a merge visual.
    if (flyingCardInfo) return;

    // reset abort flag for this reshuffle
    reshuffleAbortRef.current = false;

    if (playInitialDiscardSound) {
      playSound(discardHandSound);
    }

    setIsReshuffling(true);
    setNewCardsAnimatingIn(false);
    setHandCardsFlipped(false);
    setTargetCardFlipped(false);
    document.body.classList.add("scrolling-disabled");

    const currentlyVisibleCards = cards.filter(
      (card) => !card.invisible && !card.isPlaceholder
    );
    const cardPositions = new Map();
    currentlyVisibleCards.forEach((card) => {
      const ref = cardRefs.current[card.id];
      if (ref) {
        const rect = ref.getBoundingClientRect();
        cardPositions.set(card.id, {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        });
      }
    });

    setCardsToRender(
      cards.map((card) => ({
        ...card,
        dynamicOutStyle:
          !card.invisible && !card.isPlaceholder
            ? getCardExitStyle(cardPositions.get(card.id), centerRef.current)
            : {},
        isTarget: false,
        invisible: card.isPlaceholder ? true : card.invisible,
      }))
    );

    if (currentlyVisibleCards.length > 0) {
      await sleep(700);
      if (reshuffleAbortRef.current) {
        setIsReshuffling(false);
        document.body.classList.remove("scrolling-disabled");
        return;
      }
    }

    const { cards: newGeneratedCards, target: newTarget } =
      generateCardsAndTarget(presetCards, presetTarget);
    setTarget(newTarget);
    setCurrentRoundTarget(newTarget);

    const preparedNewCardsForAnimation = Array.from({
      length: TOTAL_CARD_SLOTS,
    }).map((_, index) => {
      const newCard = newGeneratedCards[index];
      if (newCard) {
        return {
          ...newCard,
          isFlipped: true,
          isPlaceholder: false,
          invisible: false,
        };
      } else {
        return {
          id: `placeholder-entry-${Date.now()}-${index}`,
          value: null,
          isAbstract: false,
          isFlipped: false,
          isPlaceholder: true,
          invisible: true,
        };
      }
    });

    cardRefs.current = {};
    setCards([]);

    await new Promise((resolve) =>
      requestAnimationFrame(() => {
        setCardsToRender(preparedNewCardsForAnimation);
        setNewCardsAnimatingIn(true);
        resolve();
      })
    );

    await sleep(400);
    if (reshuffleAbortRef.current) {
      setIsReshuffling(false);
      setNewCardsAnimatingIn(false);
      document.body.classList.remove("scrolling-disabled");
      return;
    }
    playSound(reshuffleSound);
    await sleep(
      800 +
      (newGeneratedCards.length > 0 ? (newGeneratedCards.length - 1) * 50 : 0)
    );
    if (reshuffleAbortRef.current) {
      setIsReshuffling(false);
      setNewCardsAnimatingIn(false);
      document.body.classList.remove("scrolling-disabled");
      return;
    }

    setHandCardsFlipped(true);
    await sleep(600);
    if (reshuffleAbortRef.current) {
      setIsReshuffling(false);
      setNewCardsAnimatingIn(false);
      document.body.classList.remove("scrolling-disabled");
      return;
    }

    setTargetCardFlipped(true);
    playSound(cardRevealSound);
    await sleep(600);
    if (reshuffleAbortRef.current) {
      setIsReshuffling(false);
      setNewCardsAnimatingIn(false);
      document.body.classList.remove("scrolling-disabled");
      return;
    }

    const finalCardsState = Array.from({ length: TOTAL_CARD_SLOTS }).map(
      (_, index) => {
        const generatedCard = newGeneratedCards[index];
        if (generatedCard) {
          return {
            ...generatedCard,
            isFlipped: false,
            invisible: false,
            isPlaceholder: false,
          };
        } else {
          return {
            id: `placeholder-final-${Date.now()}-${index}`,
            value: null,
            isAbstract: false,
            isFlipped: false,
            isPlaceholder: true,
            invisible: true,
          };
        }
      }
    );

    setCards(finalCardsState);
    setOriginalCards(newGeneratedCards);
    playSound(cardRevealSound);
    setSelected([]);
    setSelectedOperator(null);
    setHistory([]);
    setSolutionMoves([]);
    setHasWonCurrentRound(false);
    setFrozenSolution(null);
    setIsReshuffling(false);
    setNewCardsAnimatingIn(false);
    document.body.classList.remove("scrolling-disabled");
  };

  // Play the same entry animation sequence for incoming multiplayer deals
  const playIncomingDeal = async (handCards, theTarget) => {
    // handCards: array of { id, value }
    // Reset any existing visual state
    reshuffleAbortRef.current = false;
    setIsReshuffling(true);
    setNewCardsAnimatingIn(false);
    setHandCardsFlipped(false);
    setTargetCardFlipped(false);
    document.body.classList.add("scrolling-disabled");

    const preparedNewCardsForAnimation = Array.from({ length: TOTAL_CARD_SLOTS }).map((_, index) => {
      const newCard = handCards[index];
      if (newCard) {
        return {
          ...newCard,
          isFlipped: true,
          isPlaceholder: false,
          invisible: false,
        };
      }
      return {
        id: `placeholder-entry-${Date.now()}-${index}`,
        value: null,
        isAbstract: false,
        isFlipped: false,
        isPlaceholder: true,
        invisible: true,
      };
    });

    cardRefs.current = {};
    setCards([]);

    await new Promise((resolve) => requestAnimationFrame(() => {
      setCardsToRender(preparedNewCardsForAnimation);
      setNewCardsAnimatingIn(true);
      resolve();
    }));

    await sleep(400);
    if (reshuffleAbortRef.current) {
      setIsReshuffling(false);
      setNewCardsAnimatingIn(false);
      document.body.classList.remove("scrolling-disabled");
      return;
    }
    playSound(reshuffleSound);
    await sleep(800 + (handCards.length > 0 ? (handCards.length - 1) * 50 : 0));
    if (reshuffleAbortRef.current) {
      setIsReshuffling(false);
      setNewCardsAnimatingIn(false);
      document.body.classList.remove("scrolling-disabled");
      return;
    }

    setHandCardsFlipped(true);
    await sleep(600);
    if (reshuffleAbortRef.current) {
      setIsReshuffling(false);
      setNewCardsAnimatingIn(false);
      document.body.classList.remove("scrolling-disabled");
      return;
    }

    setTargetCardFlipped(true);
    playSound(cardRevealSound);
    await sleep(600);
    if (reshuffleAbortRef.current) {
      setIsReshuffling(false);
      setNewCardsAnimatingIn(false);
      document.body.classList.remove("scrolling-disabled");
      return;
    }

    const finalCardsState = Array.from({ length: TOTAL_CARD_SLOTS }).map((_, index) => {
      const generatedCard = handCards[index];
      if (generatedCard) {
        return {
          ...generatedCard,
          isFlipped: false,
          invisible: false,
          isPlaceholder: false,
        };
      }
      return {
        id: `placeholder-final-${Date.now()}-${index}`,
        value: null,
        isAbstract: false,
        isFlipped: false,
        isPlaceholder: true,
        invisible: true,
      };
    });

    setCards(finalCardsState);
    // Keep full card info (including id) for multiplayer incoming deals
    setOriginalCards(handCards);
    setTarget(theTarget);
    setCurrentRoundTarget(theTarget);
    playSound(cardRevealSound);
    setSelected([]);
    setSelectedOperator(null);
    setHistory([]);
    setSolutionMoves([]);
    setHasWonCurrentRound(false);
    setIsReshuffling(false);
    setNewCardsAnimatingIn(false);
    document.body.classList.remove("scrolling-disabled");
    setGameStarted(true);
  };

  // Helper: wait until entry animations complete and target is visible
  const waitForEntryAnimationsToFinish = async () => {
    const maxWaitMs = 5000;
    const poll = 30;
    let waited = 0;
    while ((isReshuffling || newCardsAnimatingIn || !targetCardFlipped) && waited < maxWaitMs) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, poll));
      waited += poll;
    }
    // settle (shortened)
    await new Promise((r) => setTimeout(r, 50));
  };

  // Helper: ensure a replay item has fully finished (no animations/merges running)
  const waitForReplayIdle = async () => {
    const maxWaitMs = 8000;
    const poll = 30;
    let waited = 0;
    // Wait until no replay is active, no merges flying, no entry animations
    while (
      (isReplayingRef.current || flyingCardInfoRef.current || isReshuffling || newCardsAnimatingIn) &&
      waited < maxWaitMs
    ) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, poll));
      waited += poll;
    }
    // settle a touch more
    await new Promise((r) => setTimeout(r, 100));
  };

  // --- Round replays helpers (multiplayer) ---
  const playSolutionShowcase = async (solution) => {
    try {
      if (!solution || !Array.isArray(solution.c) || !Array.isArray(solution.m)) return;
      // Full showcase: load starting 4-card hand, then replay all moves to reach target
      const hand = solution.c.map((v, i) => ({ id: `replay-${Date.now()}-${i}-${Math.random()}`, value: v }));
      const t = (solution && solution.t != null) ? solution.t : replaysRoundTargetRef.current;
      await playIncomingDeal(hand, t);
      await waitForEntryAnimationsToFinish();
      setReplaysBanner("");
      await replaySolution(solution.m);
      await new Promise((r) => setTimeout(r, 800));
    } catch (e) {
      console.error("playSolutionShowcase failed", e);
    }
  };

  const playNoSolutionShowcase = async (entry) => {
    try {
      // Always lock and show the round target
      const tRaw = replaysRoundTargetRef.current || currentRoundTarget || target;
      const t = (typeof tRaw === "number" && Number.isFinite(tRaw)) ? tRaw : Number(tRaw);
      // If target couldn't be resolved to a finite number, skip showing target but proceed with message
      const hand = Array.isArray(entry.originHand)
        ? entry.originHand.map((c, i) => ({ id: c.id || `nos-${Date.now()}-${i}`, value: c.value }))
        : [];

      // Show the origin player's four cards if available, with standard entry animation
      if (hand.length > 0) {
        if (Number.isFinite(t)) {
          await playIncomingDeal(hand, t);
        } else {
          // Show hand even if target is missing; target will be set below if possible
          await playIncomingDeal(hand, currentRoundTarget || target);
        }
        await waitForEntryAnimationsToFinish();
        // Ensure the locked target is visible during the showcase
        if (Number.isFinite(t)) {
          setTarget(t);
          setCurrentRoundTarget(t);
        }
        setTargetCardFlipped(true);
      } else {
        // Even if origin hand is missing, ensure target is visible and board is cleared
        if (Number.isFinite(t)) {
          setTarget(t);
          setCurrentRoundTarget(t);
        }
        setCards([]);
        setOriginalCards([]);
        setTargetCardFlipped(true);
        await new Promise((r) => setTimeout(r, 200));
      }
      setReplaysBanner("No solution was found");
      await new Promise((r) => setTimeout(r, 1800));
    } catch (e) {
      console.error("playNoSolutionShowcase failed", e);
    }
  };

  const clearShowcaseBoard = async () => {
    setCards([]);
    setOriginalCards([]);
    setSelected([]);
    setSelectedOperator(null);
    setHistory([]);
    await new Promise((r) => setTimeout(r, 200));
  };

  const playRoundReplaysSequentially = async (items, sessionId) => {
    if (!Array.isArray(items)) return;
    setIsPlayingRoundReplays(true);
    setWaitingForOthers(false);
    setWaitingForOthersAfterWin(false);
    // Ensure no reveal guard UI interferes while showcasing
    setViewingReveal(false);
    revealLockRef.current = false;
    // Lock round target for consistent display across all items
    replaysRoundTargetRef.current = currentRoundTarget || target;
    // Prevent any previous replay loop from triggering during showcases
    replayInitialCardsRef.current = null;
    replayInitialTargetRef.current = null;
    setReplayPendingMoves(null);
    let ackEmitted = false;
    try {
      for (const item of items) {
        // If a newer session has started, abort this sequence
        if (sessionId !== roundReplaysSessionIdRef.current) break;
        try {
          if (item.type === "solution" && item.solution) {
            // Prefer precomputed header if available to avoid race conditions
            const header = item.header || "";
            setReplaysBanner(header);
            currentReplayHeaderRef.current = header;
            await new Promise((r) => setTimeout(r, REPLAY_PRE_ITEM_DELAY));
            await playSolutionShowcase(item.solution);
            await waitForReplayIdle();
          } else if (item.type === "no_solution") {
            const header = item.header || "";
            setReplaysBanner(header);
            currentReplayHeaderRef.current = header;
            await new Promise((r) => setTimeout(r, REPLAY_PRE_ITEM_DELAY));
            await playNoSolutionShowcase(item);
            await waitForReplayIdle();
          }
        } catch (e) {
          console.error("error during round replay item", e);
        }
        await clearShowcaseBoard();
      }
    } finally {
      setReplaysBanner("");
      currentReplayHeaderRef.current = "";
      setIsPlayingRoundReplays(false);
      // Mark replays as complete for this round to avoid duplicate runs
      roundReplaysDoneRef.current = true;
      // Ack to server that this client finished watching replays (defensive)
      try {
        const myId = socket.getSocketId();
        if (multiplayerRoom && myId) {
          socket.emitReplaysComplete(multiplayerRoom, myId);
          ackEmitted = true;
        }
      } catch (e) {
        console.error("emitReplaysComplete failed", e);
      }
      // After ack, clear any reveal caches and show waiting UI until next deal arrives
      viewingRevealRef.current = false;
      setViewingReveal(false);
      lastRevealHandRef.current = null;
      lastRevealOriginRef.current = null;
      lastRevealExpiresAtRef.current = null;
      setNoSolutionTimer(null);
      setWaitingForOthers(true);
    }
  };

  const getCardExitStyle = (cardCenter, screenCenterElement) => {
    if (!cardCenter || !screenCenterElement) return {};
    const screenRect = screenCenterElement.getBoundingClientRect();
    const screenX = screenRect.left + screenRect.width / 2;
    const targetY = window.innerHeight + 200;
    const dx = screenX - cardCenter.x;
    const dy = targetY - cardCenter.y;
    const factor = 1.0;
    return {
      "--card-exit-x": `${dx * factor}px`,
      "--card-exit-y": `${dy * factor}px`,
    };
  };

  useEffect(() => {
    // Only auto-start a local round when not in a multiplayer room
    if (gameStarted && userInteracted && !multiplayerRoom) {
      const params = new URLSearchParams(window.location.search);
      const cardsParam = params.get("cards");
      const targetParam = params.get("target");
      const solutionParam = params.get("solution");

      if (cardsParam && targetParam) {
        const parsedCards = cardsParam.split(",").map(Number);
        const parsedTarget = Number(targetParam);
        // If a solution is provided, queue it for replay after the round starts
        if (solutionParam) {
          const decoded = decodeSolution(solutionParam);
          if (decoded && Array.isArray(decoded.m)) {
            setAutoReshuffle(false);
            setReplayPendingMoves(decoded.m);
            replayInitialCardsRef.current = parsedCards;
            replayInitialTargetRef.current = parsedTarget;
          }
        }
        startNewRound(false, parsedCards, parsedTarget);
      } else {
        startNewRound(true);
      }
    }
  }, [gameStarted, userInteracted, multiplayerRoom]);

  // Start replay once the new round finishes animating in
  useEffect(() => {
    if (
      replayPendingMoves &&
      !isReshuffling &&
      !newCardsAnimatingIn &&
      targetCardFlipped &&
      !isReplaying
    ) {
      // Kick off replay
      const moves = replayPendingMoves;
      setReplayPendingMoves(null);
      replaySolution(moves);
    }
  }, [replayPendingMoves, isReshuffling, newCardsAnimatingIn, targetCardFlipped, isReplaying]);

  useEffect(() => {
    // Do not trigger live win-handling during solution or round replays
    if (isReplaying || isPlayingRoundReplays) {
      return;
    }
    if (
      !isReshuffling &&
      !newCardsAnimatingIn &&
      gameStarted &&
      !flyingCardInfo
    ) {
      const visibleCards = cards.filter(
        (card) => !card.invisible && !card.isPlaceholder
      );
      if (
        visibleCards.length === 1 &&
        visibleCards[0].value === target &&
        target !== null
      ) {
        setHasWonCurrentRound(true);
        // Freeze share payload once per round
        setFrozenSolution((prev) =>
          prev || {
            c: originalCards.map((c) => c.value),
            t: target,
            m: solutionMoves.slice(),
          }
        );
        // If playing multiplayer, notify server that this player finished
        if (multiplayerRoom) {
          try {
            const myId = socket.getSocketId();
            const solutionPayload = (frozenSolution && frozenSolution.c && frozenSolution.t && Array.isArray(frozenSolution.m))
              ? frozenSolution
              : { c: originalCards.map((c) => c.value), t: target, m: solutionMoves.slice() };
            socket.emitPlayMove(multiplayerRoom, myId, { type: "win", solution: solutionPayload });
          } catch (e) {
            console.error("emit play_move failed", e);
          }
        }
        if (autoReshuffle && !isReplayingRef.current) {
          setTimeout(() => {
            // In multiplayer we no longer trigger a reshuffle locally when a single player finishes.
            // The server will start the next round only after all players have finished.
            if (!multiplayerRoom) {
              startNewRound(true);
            }
          }, 2000);
        }
      }
    }
  }, [
    cards,
    target,
    autoReshuffle,
    userInteracted,
    soundsOn,
    isReshuffling,
    newCardsAnimatingIn,
    gameStarted,
    flyingCardInfo,
    originalCards,
    solutionMoves,
  ]);

  // This effect will run whenever `selected` or `selectedOperator` changes.
  // It ensures `performOperation` is called as soon as conditions are met.
  useEffect(() => {
    if (isReplaying) return;
    if (selected.length === 2 && selectedOperator) {
      performOperation(selected, selectedOperator);
    }
  }, [selected, selectedOperator, isReplaying]); // Depend on selected and selectedOperator

  const handleCardClick = (id) => {
    if (!gameStarted) return; // Keep this basic game state check
    if (isReplaying || isPlayingRoundReplays) return;

    const clickedCard = cards.find((c) => c.id === id);
    if (!clickedCard || clickedCard.isPlaceholder || clickedCard.invisible)
      return;

    setSelected((prevSelected) => {
      if (prevSelected.includes(id)) {
        return prevSelected.filter((sid) => sid !== id);
      } else if (prevSelected.length < 2) {
        return [...prevSelected, id];
      }
      return prevSelected;
    });
  };

  const handleOperatorSelect = (op) => {
    if (isReplaying || isPlayingRoundReplays) return;
    // Disable operators for origin during active no-solution (only for origin)
    {
      const myId = socket.getSocketId();
      const originId = (noSolutionTimer && noSolutionTimer.originPlayerId) || null;
      if (originNoSolutionActive && myId && originId && myId === originId) return;
    }
    if (isReshuffling || newCardsAnimatingIn || !gameStarted || flyingCardInfo)
      return;

    setSelectedOperator((prevOp) => (prevOp === op ? null : op));
  };

  const performOperation = ([aId, bId], operator) => {
    // allow operations even if isReshuffling/newCardsAnimatingIn are set in some race cases,
    // but still disallow when a merge is already visually happening
    if (flyingCardInfo) return;
    // Block operations for origin during active no-solution (only for origin)
    {
      const myId = socket.getSocketId();
      const originId = (noSolutionTimer && noSolutionTimer.originPlayerId) || null;
      if (originNoSolutionActive && myId && originId && myId === originId) return;
    }

    const sourceCards = isReplayingRef.current ? cardsRef.current : cards;
    const cardA_Obj = sourceCards.find((c) => c.id === aId);
    const cardB_Obj = sourceCards.find((c) => c.id === bId);
    if (!cardA_Obj || !cardB_Obj) return;

    const result = operate(cardA_Obj.value, cardB_Obj.value, operator);
    if (result == null) return;

    // Compute fixed slots for both cards (used for recording and potential freeze)
    const aSlot = sourceCards.findIndex((c) => c.id === aId);
    const bSlot = sourceCards.findIndex((c) => c.id === bId);

    // Record the move for solution sharing using fixed slot indices
    if (!isReplayingRef.current) {
      if (aSlot !== -1 && bSlot !== -1) {
        setSolutionMoves((prev) => [
          ...prev,
          {
            aSlot,
            bSlot,
            op: operator,
            // Additional hints to resolve ambiguities on replay
            aValue: cardA_Obj.value,
            bValue: cardB_Obj.value,
          },
        ]);
      }
    }

    // During replay, do not push to history to avoid enabling undo/reset side-effects
    if (!isReplayingRef.current) {
      setHistory((prev) => [...prev, sourceCards.map((c) => ({ ...c }))]);
    }

    const newCardResultId = Date.now();

    // Prepare card B for its animation
    const cardBRef = cardRefs.current[bId];
    const cardARef = cardRefs.current[aId];

    if (cardBRef && cardARef) {
      const bRect = cardBRef.getBoundingClientRect();
      const aRect = cardARef.getBoundingClientRect();

      const targetCenterX = aRect.left + aRect.width / 2;
      const targetCenterY = aRect.top + aRect.height / 2;
      const sourceCenterX = bRect.left + bRect.width / 2;
      const sourceCenterY = bRect.top + bRect.height / 2;

      setFlyingCardInfo({
        id: bId, // Technically, this is for the visual clone
        value: cardB_Obj.value,
        isAbstract: cardB_Obj.isAbstract,
        initialLeft: bRect.left,
        initialTop: bRect.top,
        width: bRect.width,
        height: bRect.height,
        translateX: targetCenterX - sourceCenterX,
        translateY: targetCenterY - sourceCenterY,
      });
    }

    const updatedCards = sourceCards.map((c) => {
      if (c.id === aId)
        return {
          id: newCardResultId, // New card takes slot of A
          value: result,
          isAbstract: result < 1 || result > 13 || parseInt(result) !== result,
          isFlipped: false,
          invisible: false,
          isPlaceholder: false,
          isNewlyMerged: true, // Flag for "appear" animation
        };
      if (c.id === bId) return { ...c, invisible: true }; // Original card B becomes invisible in layout
      return c;
    });

    // Use functional setState to avoid race conditions with stale closures during replay
    setCards((prev) => {
      return isReplayingRef.current ? updatedCards : updatedCards;
    });
    playSound(operatorSound);
    // Clear interactive selection only when user is playing
    if (!isReplayingRef.current) {
      setSelected([]);
      setSelectedOperator(null);
    }

    // --- NEW LOGIC FOR WIN CONDITION CHECK DURING MERGE (unchanged) ---
    const newCardsStateAfterMerge = updatedCards.filter(
      (c) => c.id !== bId && !c.isPlaceholder && !c.invisible
    ); // Simulate the state after B is gone
    const potentialWinningCard = newCardsStateAfterMerge.find(
      (c) => c.id === newCardResultId
    );

    if (
      potentialWinningCard &&
      newCardsStateAfterMerge.length === 1 &&
      potentialWinningCard.value === target
    ) {
      // In SOLO mode, play confetti & sound locally.
      // In MULTIPLAYER, let the server's `score_update` drive the celebration
      // so we don't get double sounds.
      if (!multiplayerRoom) {
        confetti();
        playSound(successSound);
      }

      setHasWonCurrentRound(true);

      if (!isReplayingRef.current && aSlot !== -1 && bSlot !== -1) {
        setFrozenSolution((prev) =>
          prev || {
            c: originalCards.map((c) => c.value),
            t: target,
            m: solutionMoves.concat([
              {
                aSlot,
                bSlot,
                op: operator,
                aValue: cardA_Obj.value,
                bValue: cardB_Obj.value,
              },
            ]),
          }
        );
      }
    }

    // --- END NEW LOGIC ---

    // store timeout id so we can cancel the finishing step (undo/reset)
    if (mergeTimeoutRef.current) {
      clearTimeout(mergeTimeoutRef.current);
      mergeTimeoutRef.current = null;
    }
    mergeTimeoutRef.current = setTimeout(() => {
      mergeTimeoutRef.current = null;
      setFlyingCardInfo(null);
      setCards((currentCards) =>
        currentCards.map((c) =>
          c.id === newCardResultId ? { ...c, isNewlyMerged: false } : c
        )
      );
      // Notify any awaiting replay step that merge finished
      const resolver = mergeResolveRef.current;
      if (resolver) {
        mergeResolveRef.current = null;
        try {
          resolver();
        } catch {
          // ignore
        }
      }
    }, MERGE_ANIMATION_DURATION);
  };

  const handleUndo = () => {
    // Allow undo even while reshuffle/entry animations are running.
    if (!gameStarted || history.length === 0 || isReplaying) return;

    // If a merge is mid-flight, cancel its finishing timeout and clear the flying visual.
    if (mergeTimeoutRef.current) {
      clearTimeout(mergeTimeoutRef.current);
      mergeTimeoutRef.current = null;
    }
    if (mergeResolveRef.current) {
      try {
        mergeResolveRef.current();
      } catch { }
      mergeResolveRef.current = null;
    }

    // Abort any in-progress reshuffle sequence
    reshuffleAbortRef.current = true;
    setIsReshuffling(false);
    setNewCardsAnimatingIn(false);
    document.body.classList.remove("scrolling-disabled");

    // Clear flying card visual immediately
    setFlyingCardInfo(null);

    playSound(undoSound);
    const prev = history[history.length - 1];
    setCards(prev);
    setHistory((h) => h.slice(0, -1));
    setSelected([]);
    setSelectedOperator(null);
    setSolutionMoves((prev) => (prev.length ? prev.slice(0, -1) : prev));
  };

  const handleReset = () => {
    // Allow reset while reshuffle/entry animations run.
    if (!gameStarted || (history.length === 0 && originalCards.length === 0) || isReplaying) return;

    // Cancel pending merge finish if any
    if (mergeTimeoutRef.current) {
      clearTimeout(mergeTimeoutRef.current);
      mergeTimeoutRef.current = null;
    }
    if (mergeResolveRef.current) {
      try {
        mergeResolveRef.current();
      } catch { }
      mergeResolveRef.current = null;
    }

    // Abort any in-progress reshuffle sequence
    reshuffleAbortRef.current = true;
    setIsReshuffling(false);
    setNewCardsAnimatingIn(false);
    document.body.classList.remove("scrolling-disabled");

    // Clear flying card visual immediately
    setFlyingCardInfo(null);

    playSound(undoSound);

    const resetCardsState = Array.from({ length: TOTAL_CARD_SLOTS }).map(
      (_, index) => {
        const originalCard = originalCards[index];
        if (originalCard) {
          return {
            ...originalCard,
            isFlipped: false,
            invisible: false,
            isPlaceholder: false,
          };
        } else {
          return {
            id: `placeholder-reset-${Date.now()}-${index}`,
            value: null,
            isAbstract: false,
            isFlipped: false,
            isPlaceholder: true,
            invisible: true,
          };
        }
      }
    );

    setCards(resetCardsState);
    setHistory([]);
    setSelected([]);
    setSelectedOperator(null);
    setSolutionMoves([]);
    setHasWonCurrentRound(false);
  };

  // --- Main Menu component (restores initial interaction flow) ---
  const MainMenu = () => {
    return (
      <div
        className="container text-center position-relative d-flex flex-column justify-content-center align-items-center"
        style={{ minHeight: "100vh" }}
      >
        <h1 className="mb-4">CartCulus</h1>

        <div className="d-flex justify-content-center align-items-center">
          <button
            className="img-button toggle-btn"
            onClick={() => setSoundsOn(!soundsOn)}
            aria-label="Toggle sounds"
            title="Toggle sounds"
          >
            <img
              src={soundsOn ? "./images/sound-toggle-on.png" : "./images/sound-toggle-off.png"}
              alt={soundsOn ? "Sounds On" : "Sounds Off"}
            />
          </button>
        </div>
        <br />

        <p className="lead mb-4">
          {isSharedSolution
            ? "This solution was shared by a friend."
            : isSharedRiddle
              ? "This riddle was sent by a friend."
              : "Use all four cards to reach the target value. Good luck!"}
        </p>

        <div className="d-flex gap-3 mt-4">
          {isSharedSolution ? (
              <button
                className="btn btn-primary btn-lg"
                onClick={() => setGameStarted(true)}
              >
                Take me to the solution
              </button>
          ) : isSharedRiddle ? (
              (<button
                className="btn btn-primary btn-lg"
                onClick={() => setGameStarted(true)}
              >
                Take me to the riddle
              </button>)
          ) :
            (<div><button
                className="btn btn-primary btn-lg"
                onClick={() => {
                  // Clear any leftover multiplayer state before starting solo
                  setWaitingForOthersAfterWin(false);
                  setWaitingForOthers(false);
                  setNoSolutionTimer(null);
                  setGameStarted(true);
                  // useEffect will handle calling startNewRound when gameStarted becomes true
                }}
              >
                Solo
              </button>
              <button
                className="btn btn-outline-primary btn-lg"
                onClick={() => setShowMultiplayer(true)}
              >
                Multiplayer
              </button></div> )
          }
        </div>
        <div ref={centerRef} className="screen-center-anchor d-none"></div>
      </div>
    );
  };

  if (!gameStarted) {
    // When multiplayer mode is active, always show the Lobby view (either
    // the create/join screen or the joined-room details). This prevents the
    // main Solo menu from appearing while the player is in multiplayer mode
    // and keeps a Home button visible so the user can cancel.
    if (showMultiplayer) {
      return (
        <div className="container text-center position-relative" style={{ minHeight: '100vh', paddingTop: '2rem' }}>
          {/* Home button while in Lobby so player can cancel/return (positioned relative to the container)
              This ensures it aligns like the in-match Home button instead of being pinned to the viewport. */}
          <div className="position-absolute top-0 start-0 m-2 d-none d-sm-block">
            <button className="img-button home-btn" onClick={handleGoHome}>
              <img src="./images/home-button.png" alt="Home" title="Home" />
            </button>
          </div>
          <div className="position-absolute top-0 start-50 translate-middle-x mt-2 d-block d-sm-none">
            <button className="img-button home-btn" onClick={handleGoHome}>
              <img src="./images/home-button.png" alt="Home" title="Home" />
            </button>
          </div>

          <h1 className="text-start text-sm-center">
            CartCulus
          </h1>
          <h5 className="text-start text-sm-center">
            {currentMode === "solution"
              ? "Solution Replay"
              : currentMode === "riddle"
              ? "Riddle"
              // : multiplayerRoom ? "Multiplayer"
              : "Multiplayer Lobby"
            }
          </h5>

          {/* If not yet in a room, show the full-screen Lobby; once joined, hide the creation panel and show only the room/player list */}
          {!multiplayerRoom && <Lobby fullScreen={true} onJoined={handleJoined} />}

          {multiplayerRoom && (
            <div className="mt-3">
              <PlayerList
                players={players}
                scores={scores}
                hostId={hostId}
                currentPlayerId={socket.getSocketId()}
                roomId={multiplayerRoom}
                onStartGame={(roomId) => socket.startGame(roomId)}
                gameStarted={false}
              />
            </div>
          )}
        </div>
      );
    }

    // Default: show the main Solo/Multiplayer menu
    return <MainMenu />;
  }

  return (
    <div className="container text-center position-relative">
      <div ref={centerRef} className="screen-center-anchor d-none"></div>
      {/* Player list will be shown below the cards/buttons once the match is started */}
      {waitingForOthers && (
        <div className="alert alert-info d-flex align-items-center justify-content-center mt-2" role="status" style={{ zIndex: 1200 }}>
          <div className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></div>
          <div>
            Waiting for others to load... ({pendingLoadedCount}/{pendingTotalCount})
          </div>
        </div>
      )}
      {!isPlayingRoundReplays && (noSolutionTimer || (viewingRevealRef.current && lastRevealHandRef.current && lastRevealOriginRef.current)) && (
        <NoSolutionTimer
          timer={noSolutionTimer || {
            type: "reveal",
            originPlayerId: lastRevealOriginRef.current,
            originHand: lastRevealHandRef.current,
            expiresAt: lastRevealExpiresAtRef.current,
          }}
          onSkip={(originPlayerId) => {
            const me = socket.getSocketId();
            if (!multiplayerRoom || !me) return;

            // Use skip voting for both no-solution and reveal timers
            try {
              socket.emitSkipVote(multiplayerRoom, me, originPlayerId);
            } catch (e) {
              console.error("emitSkipVote failed", e);
            }
          }}
          currentPlayerId={socket.getSocketId()}
          originName={
            players.find(
              (p) =>
                p.playerId === (
                  (noSolutionTimer && noSolutionTimer.originPlayerId) ||
                  lastRevealOriginRef.current
                )
            )?.name
          }
        />
      )}


      {/* Home button - desktop/tablet: top-left */}
      <div className="position-absolute top-0 start-0 m-2 d-none d-sm-block">
        <button
          className="img-button home-btn"
          onClick={() => {
            // Leave multiplayer room if present, then return to main menu
            if (multiplayerRoom) {
              try { socket.leaveRoom(multiplayerRoom); } catch (e) { }
              setMultiplayerRoom(null);
              setPlayers([]);
              setScores({});
              setHostId(null);
              setPlayerName(null);
              setShowMultiplayer(false);
            }
            setIsReplaying(false);
            replaySessionIdRef.current += 1; // cancel any queued replay loops
            setReplayPendingMoves(null);
            setSelected([]);
            setSelectedOperator(null);
            setHistory([]);
            setSolutionMoves([]);
            setHasWonCurrentRound(false);
            setFlyingCardInfo(null);
            setCards([]);
            document.body.classList.remove("scrolling-disabled");
            try { window.history.replaceState(null, "", window.location.pathname); } catch { }
            setGameStarted(false);
          }}
        >
          <img src="./images/home-button.png" alt="Home" title="Home" />
        </button>
      </div>

      {/* Home button - small screens: top-center */}
      <div className="position-absolute top-0 start-50 translate-middle-x mt-2 d-block d-sm-none">
        <button
          className="img-button home-btn"
          onClick={() => {
            // Leave multiplayer room if present, then return to main menu
            if (multiplayerRoom) {
              try { socket.leaveRoom(multiplayerRoom); } catch (e) { }
              setMultiplayerRoom(null);
              setPlayers([]);
              setScores({});
              setHostId(null);
              setPlayerName(null);
              setShowMultiplayer(false);
            }
            setIsReplaying(false);
            replaySessionIdRef.current += 1; // cancel any queued replay loops
            setReplayPendingMoves(null);
            setSelected([]);
            setSelectedOperator(null);
            setHistory([]);
            setSolutionMoves([]);
            setHasWonCurrentRound(false);
            setFlyingCardInfo(null);
            setCards([]);
            document.body.classList.remove("scrolling-disabled");
            try { window.history.replaceState(null, "", window.location.pathname); } catch { }
            setGameStarted(false);
          }}
        >
          <img src="./images/home-button.png" alt="Home" title="Home" />
        </button>
      </div>

      <div className="position-absolute top-0 end-0 m-2 toggles-stack">
        {!multiplayerRoom ? (
          <button
            className="img-button toggle-btn"
            onClick={() => setAutoReshuffle(!autoReshuffle)}
            aria-label="Toggle auto-reshuffle"
            title="Toggle auto-reshuffle"
            disabled={currentMode === "solution"}
          >
            <img
              src={autoReshuffle ? "./images/reshuffle-toggle-on.png" : "./images/reshuffle-toggle-off.png"}
              alt={autoReshuffle ? "Auto-reshuffle On" : "Auto-reshuffle Off"}
            />
          </button>
        ) : null}
        <button
          className="img-button toggle-btn"
          onClick={() => setSoundsOn(!soundsOn)}
          aria-label="Toggle sounds"
          title="Toggle sounds"
        >
          <img
            src={soundsOn ? "./images/sound-toggle-on.png" : "./images/sound-toggle-off.png"}
            alt={soundsOn ? "Sounds On" : "Sounds Off"}
          />
        </button>
      </div>

      <h1 className="text-start text-sm-center">
        CartCulus
      </h1>
      <h5 className="text-start text-sm-center">
        {isPlayingRoundReplays
          ? "Round Replay"
          : currentMode === "solution"
          ? "Solution Replay"
          : currentMode === "riddle"
          ? "Riddle"
          : multiplayerRoom
          ? "Multiplayer"
          : "Solo"}
      </h5>

      {gameStarted && (
        <>
          {/* Omit top-of-page replay banner to avoid clutter; headers render inside the boxed mini-board */}
          {/* Show finished player count in multiplayer */}
          {multiplayerRoom && activeCount > 0 && !isPlayingRoundReplays && (
            <div className="text-center mt-3 mb-2">
              <span className="badge bg-secondary">Finished players: {finishedCount}/{activeCount}</span>
            </div>
          )}
          <div className="d-flex flex-sm-row justify-content-center align-items-center my-4 gap-3 controls-target-wrapper">
            <div
              className="d-flex flex-column flex-nowrap small-screen-controls position-absolute"
              style={{ left: "calc(50% - 130px)", transform: "translateX(-50%)" }}
            >
              {multiplayerRoom ? (
                <button
                  className="img-button reshuffle-btn"
                  onClick={() => {
                    // Just emit to server - don't clear cards yet
                    // The server will send no_solution_timer event if accepted,
                    // and we'll handle clearing cards in that event handler
                    try { 
                      socket.emitDeclareNoSolution(multiplayerRoom, socket.getSocketId()); 
                    } catch (e) { 
                      console.error(e); 
                    }
                  }}
                  disabled={
                    isReshuffling ||
                    newCardsAnimatingIn ||
                    !gameStarted ||
                    isReplaying ||
                    (players.find(p => p.playerId === socket.getSocketId()) || {}).finished ||
                    // Disable if ANY timer is active (no-solution or reveal)
                    (noSolutionTimer !== null)
                  }
                >
                  <img src="./images/no-solution-button.png" alt="No Solution" title="No Solution" />
                </button>
              ) : (
                <button
                  className="img-button reshuffle-btn"
                  onClick={() => startNewRound(true)}
                  disabled={
                    isReshuffling ||
                    newCardsAnimatingIn ||
                    !gameStarted ||
                    isReplaying ||
                    currentMode === "solution"
                  }
                >
                  <img src="./images/reshuffle-button.png" alt="Reshuffle" title="Reshuffle" />
                </button>
              )}
            </div>

            <div className="target">
              <div className="target-border-bs">
                <span className="target-text-bs">TARGET</span>
                <Card
                  value={currentRoundTarget}
                  isAbstract={currentRoundTarget < 1 || currentRoundTarget > 13}
                  isTarget={true}
                  isFlipped={!targetCardFlipped}
                />
              </div>
            </div>

            <div
              className="d-flex flex-column flex-nowrap small-screen-controls position-absolute"
              style={{ left: "calc(50% + 130px)", transform: "translateX(-50%)" }}
            >
              <button
                className="img-button"
                onClick={handleUndo}
                disabled={
                  isReshuffling ||
                  newCardsAnimatingIn ||
                  !gameStarted ||
                  history.length === 0 ||
                  isReplaying
                }
              >
                <img src="./images/undo-button.png" alt="Undo" title="Undo" />
              </button>

              <button
                className="img-button"
                onClick={handleReset}
                disabled={
                  isReshuffling ||
                  newCardsAnimatingIn ||
                  !gameStarted ||
                  // (history.length === 0 && originalCards.length === 0) ||
                  history.length === 0 ||
                  isReplaying
                }
              >
                <img src="./images/reset-button.png" alt="Reset" title="Reset" />
              </button>
              
              {!multiplayerRoom ? (
              <button
                className="img-button"
                onClick={() => {
                  const baseUrl = `${window.location.origin}${window.location.pathname}`;
                  const values = originalCards.map((c) => c.value);
                  const url = `${baseUrl}?cards=${values.join(
                    ","
                  )}&target=${target}`;
                  navigator
                    .share({
                      title: "Check out this CartCulus riddle!",
                      url: url,
                    })
                    .catch((err) => {
                      console.error("Error sharing:", err);
                    });
                }}
                disabled={
                  isReshuffling || newCardsAnimatingIn || !gameStarted || isReplaying
                }
              >
                <img src="./images/share-button.png" alt="Share Riddle" title="Share Riddle" />
              </button>
              ) : null}

              {!multiplayerRoom ? (
              <button
                className="img-button"
                onClick={() => {
                  const url = buildShareSolutionUrl();
                  if (!url) return;
                  if (navigator.share) {
                    navigator
                      .share({
                        title: "Watch my CartCulus solution!",
                        url,
                      })
                      .catch((err) => console.error("Error sharing:", err));
                  } else {
                    copyToClipboard(url);
                  }
                }}
                disabled={
                  !hasWonCurrentRound ||
                  solutionMoves.length === 0 ||
                  isReshuffling ||
                  newCardsAnimatingIn ||
                  !gameStarted ||
                  isReplaying
                }
              >
                <img
                  src="./images/share-solution-button.png"
                  alt="Share Solution"
                  title="Share Solution"
                />
              </button>
              ) : null}
            </div>

          </div>

          {/* End of new addition */}

          {(() => {
            const myId = socket.getSocketId();
            const originId = (noSolutionTimer && noSolutionTimer.originPlayerId) || null;
            const originActiveAndIsOrigin = originNoSolutionActive && myId && originId && myId === originId;
            // During round replays, always show the boxed mini-board with a clear header
            const shouldShowBox = (isPlayingRoundReplays && cards.length > 0) || showingOriginHand || showingRevealHand;
            // Compute replay header if in replays phase
            let replayHeader = null;
            if (isPlayingRoundReplays) {
              // Use the current banner text as the header; it is computed per item
              replayHeader = replaysBanner || "";
            }
            return (
              <div className={`${shouldShowBox ? "player-cards-highlight" : "container"} ${originActiveAndIsOrigin ? "cards-disabled" : ""}`}>
                {(shouldShowBox) && (() => {
                  const originId = (noSolutionTimer && noSolutionTimer.originPlayerId) || lastRevealOriginRef.current;
                  const originPlayer = players.find(p => p.playerId === originId);
                  // If in round replays, prefer the computed replayHeader
                  const label = isPlayingRoundReplays && (currentReplayHeaderRef.current || replayHeader)
                    ? (currentReplayHeaderRef.current || replayHeader)
                    : originPlayer && originPlayer.name
                      ? `${originPlayer.name}'s hand`
                      : "";
                  return (
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
                      {label ? (<span className="player-cards-name">{label}</span>) : null}
                    </div>
                  );
                })()}
            <div className="row justify-content-center gx-3 gy-3 position-relative">
              {waitingForOthersAfterWin && !viewingReveal && !originActiveAndIsOrigin && !isPlayingRoundReplays && (
                <div className="col-12">
                  <div className="alert alert-info mt-4">Waiting for other players...</div>
                </div>
              )}

              {(!waitingForOthersAfterWin || viewingReveal || originActiveAndIsOrigin) &&
                (isReshuffling || newCardsAnimatingIn ? cardsToRender : cards).map(
                  (card, index) => {
                    const shouldAnimateOut =
                      isReshuffling &&
                      !newCardsAnimatingIn &&
                      !card.isPlaceholder &&
                      !card.invisible;
                    const shouldAnimateIn = newCardsAnimatingIn && !card.isPlaceholder;
                    const isNewlyMerged = card.isNewlyMerged;

                    return (
                      <div
                        key={card.id}
                        className={`col-6 col-sm-auto d-flex justify-content-center reshuffle-card-container
                      ${shouldAnimateOut ? "card-animating-out" : ""}
                      ${shouldAnimateIn ? "card-animating-in" : ""}
                      ${shouldAnimateIn && card.isFlipped
                            ? "initial-offscreen-hidden"
                            : ""
                          }
                      ${isNewlyMerged
                            ? "newly-merged-card-appear-container"
                            : ""
                          }
                    `}
                        style={{
                          ...(shouldAnimateOut ? card.dynamicOutStyle : {}),
                          "--card-animation-delay": shouldAnimateIn
                            ? `${index * 0.05}s`
                            : "0s",
                        }}
                        ref={(el) => (cardRefs.current[card.id] = el)}
                      >
                        <Card
                          value={card.value}
                          selected={selected.includes(card.id)}
                          onClick={
                            !isReshuffling &&
                              !newCardsAnimatingIn &&
                              !card.isPlaceholder &&
                              !card.invisible &&
                              !originActiveAndIsOrigin &&
                              !isPlayingRoundReplays &&
                              (flyingCardInfo ? flyingCardInfo.id !== card.id : true)
                              ? () => handleCardClick(card.id)
                              : undefined
                          }
                          isAbstract={card.isAbstract}
                          invisible={card.invisible && !isNewlyMerged}
                          isPlaceholder={card.isPlaceholder}
                          isFlipped={
                            card.isPlaceholder
                              ? false
                              : newCardsAnimatingIn
                                ? card.isFlipped
                                : !isReshuffling && !newCardsAnimatingIn
                                  ? !handCardsFlipped
                                  : card.isFlipped
                          }
                        />
                      </div>
                    );
                  }
                )}

              {/* Flying card for merge animation */}
              {flyingCardInfo && (
                <div
                  style={{
                    position: "fixed",
                    left: `${flyingCardInfo.initialLeft}px`,
                    top: `${flyingCardInfo.initialTop}px`,
                    width: `${flyingCardInfo.width}px`,
                    height: `${flyingCardInfo.height}px`,
                    zIndex: 1050,
                    "--translateX": `${flyingCardInfo.translateX}px`,
                    "--translateY": `${flyingCardInfo.translateY}px`,
                  }}
                  className="flying-merge-card"
                >
                  <Card
                    value={flyingCardInfo.value}
                    isAbstract={flyingCardInfo.isAbstract}
                    isFlipped={false}
                  />
                </div>
              )}
            </div>
          </div>
            );
          })()}
        </>
      )}

      <div className="operators my-4 d-flex justify-content-center">
        {[
          { op: "+", src: "./images/addition.png" },
          { op: "-", src: "./images/subtraction.png" },
          { op: "×", src: "./images/multiplication.png" },
          { op: "÷", src: "./images/division.png" },
        ].map(({ op, src }) => (
          <button
            key={op}
            className={`operator-button ${selectedOperator === op ? "selected-operator" : ""
              }`}
            onClick={() => handleOperatorSelect(op)}
            disabled={
              isReshuffling ||
              newCardsAnimatingIn ||
              !gameStarted ||
              flyingCardInfo ||
              isPlayingRoundReplays
            }
          >
            <img src={src} alt={op} className="operator-img" title={op} />
          </button>
        ))}
      </div>

      {/* Room / Player list placed below cards and controls so it doesn't overlap game area on small screens */}
      {multiplayerRoom && (
        <div className="container mt-3 mb-4">
          <PlayerList
            players={players}
            scores={scores}
            hostId={hostId}
            currentPlayerId={socket.getSocketId()}
            roomId={multiplayerRoom}
            onStartGame={(roomId) => socket.startGame(roomId)}
            gameStarted={gameStarted}
          />
        </div>
      )}

    </div>
  );
}
