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
        if (!gameStarted) {
          setGameStarted(true);
        }

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

  const startNewRound = async (playInitialDiscardSound = true, presetCards = null, presetTarget = null) => {
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
    const cardsParam = params.get('cards');
    const targetParam = params.get('target');

    if (cardsParam && targetParam) {
      const parsedCards = cardsParam.split(',').map(Number);
      const parsedTarget = Number(targetParam);
      startNewRound(false, parsedCards, parsedTarget);
    } else {
      startNewRound(true);
    }
  }
}, [gameStarted, userInteracted]);


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
        // confetti();
        // playSound(successSound);
        if (autoReshuffle) {
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
  ]);

  // This effect will run whenever `selected` or `selectedOperator` changes.
  // It ensures `performOperation` is called as soon as conditions are met.
  useEffect(() => {
    if (selected.length === 2 && selectedOperator) {
      performOperation(selected, selectedOperator);
    }
  }, [selected, selectedOperator]); // Depend on selected and selectedOperator

  const handleCardClick = (id) => {
    if (!gameStarted) return; // Keep this basic game state check

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
    if (isReshuffling || newCardsAnimatingIn || !gameStarted || flyingCardInfo)
      return;

    setSelectedOperator((prevOp) => (prevOp === op ? null : op));
  };

  const performOperation = ([aId, bId], operator) => {
    if (isReshuffling || newCardsAnimatingIn || !gameStarted || flyingCardInfo)
      return;

    const cardA_Obj = cards.find((c) => c.id === aId);
    const cardB_Obj = cards.find((c) => c.id === bId);
    if (!cardA_Obj || !cardB_Obj) return;

    const result = operate(cardA_Obj.value, cardB_Obj.value, operator);
    if (result == null) return;

    setHistory((prev) => [...prev, cards.map((c) => ({ ...c }))]);

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

    const updatedCards = cards.map((c) => {
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

    setCards(updatedCards);
    playSound(operatorSound);
    setSelected([]);
    setSelectedOperator(null);

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
    }
    // --- END NEW LOGIC ---

    setTimeout(() => {
      setFlyingCardInfo(null);
      setCards((currentCards) =>
        currentCards.map((c) =>
          c.id === newCardResultId ? { ...c, isNewlyMerged: false } : c
        )
      );
    }, MERGE_ANIMATION_DURATION);
  };

  const handleUndo = () => {
    if (
      isReshuffling ||
      newCardsAnimatingIn ||
      !gameStarted ||
      flyingCardInfo ||
      history.length === 0
    )
      return;
    playSound(undoSound);
    const prev = history[history.length - 1];
    setCards(prev);
    setHistory(history.slice(0, -1));
    setSelected([]);
    setSelectedOperator(null);
  };

  const handleReset = () => {
    if (
      isReshuffling ||
      newCardsAnimatingIn ||
      !gameStarted ||
      flyingCardInfo ||
      (history.length === 0 && originalCards.length === 0)
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
  };

  if (!userInteracted) {
    return (
      <div
        className="container text-center position-relative d-flex flex-column justify-content-center align-items-center"
        style={{ minHeight: "100vh" }}
      >
        <h1 className="mb-4">
          CartCulus<h5 className="text-center">Casual Mode</h5>
        </h1>
        <p className="lead">
          Use all four cards to reach the target value. Press anywhere to start.
          Good luck!
        </p>
        <div ref={centerRef} className="screen-center-anchor d-none"></div>
      </div>
    );
  }

  return (
    <div className="container text-center position-relative">
      <div ref={centerRef} className="screen-center-anchor d-none"></div>

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
        CartCulus<h5 className="text-start text-sm-center">Casual Mode</h5>
      </h1>

      {gameStarted && (
        <>
          <div className="target my-4">
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

      <div className="controls d-flex justify-content-center gap-2">
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
            const values = originalCards.map(c => c.value); // use initial round state
            const url = `${window.location.origin}?cards=${values.join(',')}&target=${target}`;
            navigator.clipboard.writeText(url).then(() => alert('Link copied to clipboard!'));
          }}
          disabled={originalCards.length < 4 || target == null}
        >
          Share This Riddle
        </button>
      </div>
    </div>
  );
}
