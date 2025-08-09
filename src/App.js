import React, { useState, useEffect, useRef } from "react";
import Card from "./components/Card";
import { generateCardsAndTarget, operate } from "./gameLogic";
import confetti from "canvas-confetti";
import "bootstrap/dist/css/bootstrap.min.css";
import "./styles.css";

// Declare Audio objects globally.
let undoSound;
let operatorSound;
let successSound;
let reshuffleSound;
let cardRevealSound;
let discardHandSound;

const TOTAL_CARD_SLOTS = 4;
const MERGE_ANIMATION_DURATION = 700; // ms

export default function App() {
  const [cards, setCards] = useState([]);
  const [target, setTarget] = useState(null);
  const [selected, setSelected] = useState([]);
  const [selectedOperator, setSelectedOperator] = useState(null);
  const [originalCards, setOriginalCards] = useState([]);
  const [history, setHistory] = useState([]);
  const [autoReshuffle, setAutoReshuffle] = useState(true);
  const [userInteracted, setUserInteracted] = useState(false);
  const [soundsOn, setSoundsOn] = useState(true);
  const [gameStarted, setGameStarted] = useState(false);

  // Solution sharing/replay state
  const [solutionMoves, setSolutionMoves] = useState([]);
  const [hasWonCurrentRound, setHasWonCurrentRound] = useState(false);
  const [replayPendingMoves, setReplayPendingMoves] = useState(null);
  const [isReplaying, setIsReplaying] = useState(false);
  const [frozenSolution, setFrozenSolution] = useState(null);

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
  const isReplayingRef = useRef(isReplaying);
  const flyingCardInfoRef = useRef(flyingCardInfo);
  const mergeResolveRef = useRef(null);
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
  const currentMode = isSharedSolution ? "solution" : isSharedRiddle ? "riddle" : "casual";
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);
  useEffect(() => {
    isReplayingRef.current = isReplaying;
  }, [isReplaying]);
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
    setIsReplaying(true);
    // Ensure any initial animations are done
    await waitForMergeToFinish();
    for (let i = 0; i < moves.length; i++) {
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
      // Execute and await this merge to finish before continuing
      // eslint-disable-next-line no-await-in-loop
      await performOperationAndWait([cardA.id, cardB.id], step.op);
    }
    setIsReplaying(false);
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
    performOperation([aId, bId], op);
    await Promise.race([waitPromise, timeoutPromise]);
    // Small buffer to settle
    await new Promise((r) => setTimeout(r, 50));
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

  const playSound = (audio) => {
    if (userInteracted && audio && soundsOn) {
      audio.currentTime = 0;
      audio.play().catch((e) => console.error("Error playing sound:", e));
    }
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const startNewRound = async (
    playInitialDiscardSound = true,
    presetCards = null,
    presetTarget = null
  ) => {
    if (isReshuffling || flyingCardInfo) return;

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
    playSound(reshuffleSound);
    await sleep(
      800 +
        (newGeneratedCards.length > 0 ? (newGeneratedCards.length - 1) * 50 : 0)
    );

    setHandCardsFlipped(true);
    await sleep(600);

    setTargetCardFlipped(true);
    playSound(cardRevealSound);
    await sleep(600);

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
    if (gameStarted && userInteracted) {
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
          }
        }
        startNewRound(false, parsedCards, parsedTarget);
      } else {
        startNewRound(true);
      }
    }
  }, [gameStarted, userInteracted]);

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
        if (autoReshuffle && !isReplayingRef.current) {
          setTimeout(() => startNewRound(true), 2000);
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
    if (isReplaying) return;

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
    if (isReplaying) return;
    if (isReshuffling || newCardsAnimatingIn || !gameStarted || flyingCardInfo)
      return;

    setSelectedOperator((prevOp) => (prevOp === op ? null : op));
  };

  const performOperation = ([aId, bId], operator) => {
    if (isReshuffling || newCardsAnimatingIn || !gameStarted || flyingCardInfo)
      return;

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
      // If in replay mode, prefer the computed updatedCards (based on sourceCards)
      return isReplayingRef.current ? updatedCards : updatedCards;
    });
    playSound(operatorSound);
    // Clear interactive selection only when user is playing
    if (!isReplayingRef.current) {
      setSelected([]);
      setSelectedOperator(null);
    }

    // --- NEW LOGIC FOR WIN CONDITION CHECK DURING MERGE ---
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
      // Trigger confetti and sound immediately for a win
      confetti();
      playSound(successSound);
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

    setTimeout(() => {
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
    if (
      isReshuffling ||
      newCardsAnimatingIn ||
      !gameStarted ||
      flyingCardInfo ||
      history.length === 0 ||
      isReplaying
    )
      return;
    playSound(undoSound);
    const prev = history[history.length - 1];
    setCards(prev);
    setHistory(history.slice(0, -1));
    setSelected([]);
    setSelectedOperator(null);
    setSolutionMoves((prev) => (prev.length ? prev.slice(0, -1) : prev));
  };

  const handleReset = () => {
    if (
      isReshuffling ||
      newCardsAnimatingIn ||
      !gameStarted ||
      flyingCardInfo ||
      (history.length === 0 && originalCards.length === 0) ||
      isReplaying
    )
      return;
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

        <div className="form-check form-switch d-flex justify-content-center align-items-center">
          <input
            className="form-check-input"
            type="checkbox"
            id="soundsToggleMainMenu"
            checked={soundsOn}
            onChange={() => setSoundsOn(!soundsOn)}
          />
          <label className="form-check-label ms-2" htmlFor="soundsToggleMainMenu">
            Sounds
          </label>
        </div>
        <br />

        <p className="lead mb-4">
          {isSharedSolution
            ? "This solution was shared by a friend."
            : isSharedRiddle
            ? "This riddle was sent by a friend."
            : "Use all four cards to reach the target value. Good luck!"}
        </p>

        <div className="d-flex flex-column gap-3 mt-4">
          <button
            className="btn btn-primary btn-lg"
            onClick={() => setGameStarted(true)}
          >
            {isSharedSolution
              ? "Watch the solution"
              : isSharedRiddle
              ? "Take me to the riddle"
              : "Casual Mode"}
          </button>
        </div>
        <div ref={centerRef} className="screen-center-anchor d-none"></div>
      </div>
    );
  };

  if (!gameStarted) {
    return <MainMenu />;
  }

  return (
    <div className="container text-center position-relative">
      <div ref={centerRef} className="screen-center-anchor d-none"></div>

      {/* Home button - desktop/tablet: top-left */}
      <div className="position-absolute top-0 start-0 m-2 d-none d-sm-block">
        <button
          className="btn btn-primary btn-lg"
          onClick={() => {
            setIsReplaying(false);
            setReplayPendingMoves(null);
            setSelected([]);
            setSelectedOperator(null);
            setHistory([]);
            setSolutionMoves([]);
            setHasWonCurrentRound(false);
            setFlyingCardInfo(null);
            setCards([]);
            document.body.classList.remove("scrolling-disabled");
            try { window.history.replaceState(null, "", window.location.pathname); } catch {}
            setGameStarted(false);
          }}
        >
          🏠︎
        </button>
      </div>

      {/* Home button - small screens: top-center */}
      <div className="position-absolute top-0 start-50 translate-middle-x mt-2 d-block d-sm-none">
        <button
          className="btn btn-primary btn-lg"
          onClick={() => {
            setIsReplaying(false);
            setReplayPendingMoves(null);
            setSelected([]);
            setSelectedOperator(null);
            setHistory([]);
            setSolutionMoves([]);
            setHasWonCurrentRound(false);
            setFlyingCardInfo(null);
            setCards([]);
            document.body.classList.remove("scrolling-disabled");
            try { window.history.replaceState(null, "", window.location.pathname); } catch {}
            setGameStarted(false);
          }}
        >
          🏠︎
        </button>
      </div>

      <div className="position-absolute top-0 end-0 m-2">
        <div className="form-check form-switch">
          <input
            className="form-check-input"
            type="checkbox"
            id="autoReshuffleToggle"
            checked={autoReshuffle}
            onChange={() => setAutoReshuffle(!autoReshuffle)}
          />
          <label className="form-check-label" htmlFor="autoReshuffleToggle">
            Auto-reshuffle
          </label>
        </div>
        <div className="form-check form-switch mt-2">
          <input
            className="form-check-input"
            type="checkbox"
            id="soundsToggle"
            checked={soundsOn}
            onChange={() => setSoundsOn(!soundsOn)}
          />
          <label className="form-check-label" htmlFor="soundsToggle">
            Sounds
          </label>
        </div>
      </div>

      <h1 className="text-start text-sm-center">
        CartCulus
      </h1>
      <h5 className="text-start text-sm-center">
        {currentMode === "solution"
          ? "Solution Replay"
          : currentMode === "riddle"
          ? "Riddle"
          : "Casual Mode"}
      </h5>

      {gameStarted && (
        <>
          {/* <div className="target my-4">
            <div className="target-border-bs">
              <span className="target-text-bs">TARGET</span>
              <Card
                value={currentRoundTarget}
                isAbstract={currentRoundTarget < 1 || currentRoundTarget > 13}
                isTarget={true}
                isFlipped={!targetCardFlipped}
              />
            </div>
          </div> */}
          <div className="d-flex flex-sm-row justify-content-center align-items-center my-4 gap-3 controls-target-wrapper">

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
              style={{ left: "calc(50% + 130px)" }}
            >
              <button
                className="img-button"
                onClick={handleUndo}
                disabled={
                  isReshuffling ||
                  newCardsAnimatingIn ||
                  !gameStarted ||
                  history.length === 0
                }
              >
                <img src="./images/undo-button.png" alt="Undo" />
              </button>

              <button
                className="img-button"
                onClick={handleReset}
                disabled={
                  isReshuffling ||
                  newCardsAnimatingIn ||
                  !gameStarted ||
                  history.length === 0
                }
              >
                <img src="./images/reset-button.png" alt="Reset" />
              </button>

              <button
                className="img-button"
                onClick={() => startNewRound(true)}
                disabled={
                  isReshuffling || newCardsAnimatingIn || !gameStarted || isReplaying
                }
              >
                <img src="./images/reshuffle-button.png" alt="Reshuffle" />
              </button>

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
                <img src="./images/share-button.png" alt="Share Riddle" />
              </button>

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
                />
              </button>
            </div>

          </div>

          {/* End of new addition */}

          <div className="container">
            <div className="row justify-content-center gx-3 gy-3 position-relative">
              {(isReshuffling || newCardsAnimatingIn
                ? cardsToRender
                : cards
              ).map((card, index) => {
                const shouldAnimateOut =
                  isReshuffling &&
                  !newCardsAnimatingIn &&
                  !card.isPlaceholder &&
                  !card.invisible;
                const shouldAnimateIn =
                  newCardsAnimatingIn && !card.isPlaceholder;
                const isNewlyMerged = card.isNewlyMerged;

                return (
                  <div
                    key={card.id}
                    className={`col-6 col-sm-auto d-flex justify-content-center reshuffle-card-container
                      ${shouldAnimateOut ? "card-animating-out" : ""}
                      ${shouldAnimateIn ? "card-animating-in" : ""}
                      ${
                        shouldAnimateIn && card.isFlipped
                          ? "initial-offscreen-hidden"
                          : ""
                      }
                      ${
                        isNewlyMerged
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
                      // onClick={
                      //   !isReshuffling && !newCardsAnimatingIn && !card.isPlaceholder && !card.invisible && !flyingCardInfo ? () => handleCardClick(card.id) : undefined
                      // }
                      onClick={
                        !isReshuffling &&
                        !newCardsAnimatingIn &&
                        !card.isPlaceholder &&
                        !card.invisible &&
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
              })}

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
            className={`operator-button ${
              selectedOperator === op ? "selected-operator" : ""
            }`}
            onClick={() => handleOperatorSelect(op)}
            disabled={
              isReshuffling ||
              newCardsAnimatingIn ||
              !gameStarted ||
              flyingCardInfo
            }
          >
            <img src={src} alt={op} className="operator-img" />
          </button>
        ))}
      </div>

      {/* <div className="controls d-flex justify-content-center gap-2">
        <button
          className="btn btn-info"
          onClick={handleUndo}
          disabled={
            isReshuffling ||
            newCardsAnimatingIn ||
            !gameStarted ||
            history.length === 0
          }
        >
          Undo
        </button>
        <button
          className="btn btn-warning"
          onClick={handleReset}
          disabled={
            isReshuffling ||
            newCardsAnimatingIn ||
            !gameStarted ||
            history.length === 0
          }
        >
          Reset
        </button>
        <button
          className="btn btn-success"
          onClick={() => startNewRound(true)}
          disabled={isReshuffling || newCardsAnimatingIn || !gameStarted}
        >
          Reshuffle
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => {
            const baseUrl = `${window.location.origin}${window.location.pathname}`;
            const values = originalCards.map((c) => c.value);
            const url = `${baseUrl}?cards=${values.join(",")}&target=${target}`;
            navigator
              .share({
                title: "Check out this CartCulus riddle!",
                url: url,
              })
              .catch((err) => {
                console.error("Error sharing:", err);
              });
          }}
          disabled={originalCards.length < 4 || target == null}
        >
          Share Riddle
        </button>
      </div> */}
    </div>
  );
}
