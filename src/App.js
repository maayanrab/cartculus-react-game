import React, { useState, useEffect, useRef } from 'react';
import Card from './components/Card';
import { generateCardsAndTarget, operate } from './gameLogic';
import confetti from 'canvas-confetti';
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles.css';

// Declare Audio objects globally. They will be initialized and preloaded after first user interaction.
let undoSound;
let operatorSound;
let successSound;
let reshuffleSound;
let targetRevealSound;
let discardHandSound;

export default function App() {
  const [cards, setCards] = useState([]);
  const [target, setTarget] = useState(null);
  const [selected, setSelected] = useState([]);
  const [selectedOperator, setSelectedOperator] = useState(null);
  const [originalCards, setOriginalCards] = useState([]);
  const [history, setHistory] = useState([]);
  const [autoReshuffle, setAutoReshuffle] = useState(true);
  const [userInteracted, setUserInteracted] = useState(false); // State to track user interaction
  const [soundsOn, setSoundsOn] = useState(true); // Sounds are on by default

  // Animation states
  const [isReshuffling, setIsReshuffling] = useState(false);
  const [newCardsAnimatingIn, setNewCardsAnimatingIn] = useState(false);
  const [cardsToRender, setCardsToRender] = useState([]); // Cards to render during reshuffle
  const [handCardsFlipped, setHandCardsFlipped] = useState(false); // Controls the final flip of hand cards
  const [targetCardFlipped, setTargetCardFlipped] = useState(false); // Controls the target card flip
  const [currentRoundTarget, setCurrentRoundTarget] = useState(null); // Holds target for current round display for the target card

  // Refs to get card positions for dynamic animation paths
  const cardRefs = useRef({});
  const centerRef = useRef(null); // Ref for the center of the screen

  // Effect to initialize Audio objects and set userInteracted flag
  useEffect(() => {
    const handleInitialInteraction = () => {
      if (!userInteracted) {
        // Initialize Audio objects
        undoSound = new Audio('./sounds/undo.wav');
        operatorSound = new Audio('./sounds/operator.wav');
        successSound = new Audio('./sounds/success.wav');
        reshuffleSound = new Audio('./sounds/reshuffle.wav');
        targetRevealSound = new Audio('./sounds/target_reveal.wav');
        discardHandSound = new Audio('./sounds/discard_hand.wav');

        // Explicitly load the audio files to reduce playback delay
        undoSound.load();
        operatorSound.load();
        successSound.load();
        reshuffleSound.load();
        targetRevealSound.load();
        discardHandSound.load();

        setUserInteracted(true);
        document.removeEventListener('click', handleInitialInteraction);
        document.removeEventListener('keydown', handleInitialInteraction);
      }
    };

    document.addEventListener('click', handleInitialInteraction);
    document.addEventListener('keydown', handleInitialInteraction);

    return () => {
      document.removeEventListener('click', handleInitialInteraction);
      document.removeEventListener('keydown', handleInitialInteraction);
    };
  }, [userInteracted]);

  // Helper function to play sounds
  const playSound = (audio) => {
    if (userInteracted && audio && soundsOn) {
      audio.currentTime = 0;
      audio.play().catch(e => console.error("Error playing sound:", e));
    }
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Function to start a new round, with an optional flag to play reshuffle sound
  const startNewRound = async (playdiscardHandSound = true) => {
    if (isReshuffling) return; // Prevent double-triggering

    if (playdiscardHandSound) {
      playSound(discardHandSound);
    }

    setIsReshuffling(true); // Signal that reshuffle animation is starting
    setNewCardsAnimatingIn(false); // Ensure this is false before exit animation
    setHandCardsFlipped(false); // Ensure new hand cards start unflipped (showing back)
    setTargetCardFlipped(false); // Ensure target card starts unflipped (showing back for the animation)

    document.body.classList.add('scrolling-disabled');

    // --- Cards Exit Animation ---
    // Calculate positions for exiting cards
    const cardPositions = new Map();
    cards.forEach(card => {
      const ref = cardRefs.current[card.id];
      if (ref) {
        const rect = ref.getBoundingClientRect();
        cardPositions.set(card.id, {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        });
      }
    });

    // Render old cards with exit styles. They remain visible during this phase.
    // Ensure they are not marked as invisible from previous game logic.
    setCardsToRender(cards.map(card => ({
      ...card,
      dynamicOutStyle: getCardExitStyle(cardPositions.get(card.id), centerRef.current),
      isTarget: false, // Ensure old target doesn't act as target during exit
      invisible: false // Ensure they are visible for the animation
    })));

    await sleep(700); // Wait for cards to fly out

    // --- Generate New Cards and Prepare for Entry ---
    const { cards: newGeneratedCards, target: newTarget } = generateCardsAndTarget();

    // Set the new target value immediately, but keep the target card visually flipped to its back initially
    setTarget(newTarget); // Update the main target state
    setCurrentRoundTarget(newTarget); // Update currentRoundTarget for display (the value that the target card shows)

    // Prepare new cards for animation. They start with isFlipped: true (showing back) and the 'initial-offscreen-hidden' class
    const preparedNewCardsForAnimation = newGeneratedCards.map(card => ({
      ...card,
      isFlipped: true, // Initially flipped to show back
      // The entry style is now handled by the 'initial-offscreen-hidden' class
      // We don't need dynamicInStyle here, as the CSS class will apply the initial transform
    }));

    // Reset cardRefs for incoming cards. This is important to ensure correct rect calculations later.
    cardRefs.current = {};

    // First, set cardsToRender with the new cards and their initial off-screen state.
    // This will cause React to render them, applying the 'initial-offscreen-hidden' class.
    setCardsToRender(preparedNewCardsForAnimation);
    setCards([]); // Clear game logic cards, they will be set at the end

    // Wait for React to render the elements and for the browser to apply initial transforms (initial-offscreen-hidden styles)
    // This `requestAnimationFrame` is CRUCIAL to prevent stuttering. It ensures the DOM is updated
    // with the initial positions/opacity BEFORE we trigger the animation.
    await new Promise(resolve => requestAnimationFrame(() => resolve()));
    // await sleep(50); // Removed: requestAnimationFrame should be sufficient

    // Now, trigger the animation for new cards.
    // This removes the 'initial-offscreen-hidden' class and adds 'card-animating-in'.
    // The CSS transition then takes over.
    setNewCardsAnimatingIn(true);
    await sleep(400); // Wait for cards to flyin
    playSound(reshuffleSound);

    // Wait for all new cards to be in their final positions
    await sleep(800 + (newGeneratedCards.length - 1) * 50); // Adjust based on animation duration + max stagger delay

    // --- Final Flips ---
    // Flip all hand cards at once
    setHandCardsFlipped(true); // This will trigger the flip animation for hand cards
    await sleep(600); // Wait for the hand cards to flip

    // Flip the target card (which now holds the *new* target value)
    setTargetCardFlipped(true); // This will trigger the flip animation for the target card
    playSound(targetRevealSound);
    await sleep(600); // Wait for the target card to flip

    // After all flips, update the main 'cards' state for normal game flow
    // They should now be isFlipped: false for normal play (showing front).
    setCards(newGeneratedCards.map(card => ({ ...card, isFlipped: false })));
    playSound(targetRevealSound);
    setOriginalCards(newGeneratedCards); // Save for reset
    setSelected([]);
    setSelectedOperator(null);
    setHistory([]);

    // Reset animation states
    setIsReshuffling(false);
    setNewCardsAnimatingIn(false);

    document.body.classList.remove('scrolling-disabled');

  };

  // Helper to calculate dynamic exit translation for cards
  const getCardExitStyle = (cardCenter, screenCenterElement) => {
    if (!cardCenter || !screenCenterElement) return {};

    const screenRect = screenCenterElement.getBoundingClientRect();
    const screenX = screenRect.left + screenRect.width / 2;
    const screenY = screenRect.top + screenRect.height / 2;

    const dx = screenX - cardCenter.x;
    const dy = (window.innerHeight + screenRect.height / 2) - cardCenter.y; // Aiming towards bottom center of screen

    const factor = 1.5; // Adjust factor as needed for desired trajectory
    return {
      '--card-exit-x': `${dx * factor}px`,
      '--card-exit-y': `${dy * factor}px`,
    };
  };

  // Helper to calculate dynamic entry translation for cards (now primarily for the CSS class)
  // This function is less critical now as the CSS class will handle the initial positioning.
  // However, keeping it for `--card-enter-x` if you want a subtle horizontal alignment.
  const getCardEntryStyle = (targetCardElement, screenCenterElement) => {
    // This function's role is diminished by 'initial-offscreen-hidden'
    // It's still used to calculate the starting X position if needed for specific entry point.
    if (!targetCardElement || !screenCenterElement) return {};

    const targetRect = targetCardElement.getBoundingClientRect();
    const screenWidth = window.innerWidth;
    const rowCenter = screenWidth / 2;
    const entryDx = rowCenter - (targetRect.left + targetRect.width / 2);

    return {
      '--card-enter-x': `${-targetRect.left + entryDx + (screenWidth / 2 - rowCenter)}px`,
      // '--card-enter-y' will be set by the initial-offscreen-hidden class in CSS.
    };
  };


  // Effect for initial game setup on component mount (runs only once)
  useEffect(() => {
    startNewRound(false); // Start without reshuffle sound on initial load
  }, []);

  // Effect for winning condition and auto-reshuffle
  useEffect(() => {
    if (!isReshuffling && !newCardsAnimatingIn) { // Check when no animations are active
      const visibleCards = cards.filter((card) => !card.invisible);
      if (visibleCards.length === 1 && visibleCards[0].value === target) {
        confetti();
        playSound(successSound);
        if (autoReshuffle) {
          setTimeout(() => startNewRound(true), 2000);
        }
      }
    }
  }, [cards, target, autoReshuffle, userInteracted, soundsOn, isReshuffling, newCardsAnimatingIn]);


  const handleCardClick = (id) => {
    if (isReshuffling || newCardsAnimatingIn) return; // Prevent interaction during animation

    if (selected.includes(id)) {
      setSelected(selected.filter((sid) => sid !== id));
    } else if (selected.length < 2) {
      const newSelected = [...selected, id];
      setSelected(newSelected);
      if (newSelected.length === 2 && selectedOperator) {
        performOperation(newSelected, selectedOperator);
      }
    }
  };

  const handleOperatorSelect = (op) => {
    if (isReshuffling || newCardsAnimatingIn) return; // Prevent interaction during animation

    const newOp = selectedOperator === op ? null : op;
    setSelectedOperator(newOp);
    if (selected.length === 2 && newOp) {
      performOperation(selected, newOp);
    }
  };

  const performOperation = ([aId, bId], operator) => {
    if (isReshuffling || newCardsAnimatingIn) return; // Prevent interaction during animation

    const a = cards.find((c) => c.id === aId);
    const b = cards.find((c) => c.id === bId);
    const result = operate(a.value, b.value, operator);
    if (result == null) return;

    setHistory((prev) => [...prev, cards]);

    const newCard = {
      id: Date.now(),
      value: result,
      isAbstract: result < 1 || result > 13 || parseInt(result) !== result,
    };

    const newCards = cards.map((c) => {
      if (c.id === aId) return newCard;
      if (c.id === bId) return { ...c, invisible: true }; // Keep invisible here for game logic (removed from play)
      return c;
    });

    setCards(newCards);
    setSelected([]);
    setSelectedOperator(null);
    playSound(operatorSound);
  };

  const handleUndo = () => {
    if (isReshuffling || newCardsAnimatingIn) return; // Prevent interaction during animation
    if (history.length === 0) return;
    playSound(undoSound);
    const prev = history[history.length - 1];
    setCards(prev);
    setHistory(history.slice(0, -1));
    setSelected([]);
    setSelectedOperator(null);
  };

  const handleReset = () => {
    if (isReshuffling || newCardsAnimatingIn) return; // Prevent interaction during animation
    playSound(undoSound);
    setCards(originalCards);
    setHistory([]);
    setSelected([]);
    setSelectedOperator(null);
  };

  return (
    <div className="container text-center position-relative">
      {/* Target for center positioning calculations (hidden) */}
      <div ref={centerRef} className="screen-center-anchor d-none"></div>

      {/* Toggle top right */}
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
        {/* Sounds Toggle */}
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

      <h1 className="text-start text-sm-center">CartCulus
        <h5 className="text-start text-sm-center">Practice Mode</h5>
      </h1>

      <div className="target my-4">
        <div className="target-border-bs">
          <span className="target-text-bs">TARGET</span>
          {/* Target card will always render with the new target value but its flip state is controlled by targetCardFlipped */}
          <Card value={currentRoundTarget} isAbstract={currentRoundTarget < 1 || currentRoundTarget > 13} isTarget={true} isFlipped={!targetCardFlipped} />
        </div>
      </div>

      <div className="container">
        <div className="row justify-content-center gx-3 gy-3">
          {/* Render cards based on animation state */}
          {(isReshuffling || newCardsAnimatingIn ? cardsToRender : cards).map((card, index) => (
            <div
              key={card.id}
              className={`col-6 col-sm-auto d-flex justify-content-center reshuffle-card-container
                ${isReshuffling && !newCardsAnimatingIn ? 'card-animating-out' : ''}
                ${newCardsAnimatingIn ? 'card-animating-in' : ''}
                ${(isReshuffling && card.isFlipped) || (newCardsAnimatingIn && card.isFlipped) ? 'initial-offscreen-hidden' : ''}
              `}
              style={{
                ...card.dynamicOutStyle, // Apply dynamic exit style
                // Removed dynamicInStyle here, 'initial-offscreen-hidden' handles initial entry positioning
                // but we keep it if you still want to calculate and pass `--card-enter-x` for horizontal adjustments
                '--card-animation-delay': newCardsAnimatingIn ? `${index * 0.05}s` : '0s'
              }}
              ref={el => cardRefs.current[card.id] = el}
            >
              <Card
                value={card.value}
                selected={selected.includes(card.id)}
                onClick={
                  !isReshuffling && !newCardsAnimatingIn ? () => handleCardClick(card.id) : undefined
                }
                isAbstract={card.isAbstract}
                invisible={card.invisible} // Keep this if 'invisible' prop is used for cards removed from play
                // Control isFlipped: during animation, use card's own isFlipped state. After, use handCardsFlipped.
                // The `initial-offscreen-hidden` class already implies `isFlipped: true` for initial state.
                isFlipped={!isReshuffling && !newCardsAnimatingIn ? !handCardsFlipped : card.isFlipped}
              />
            </div>
          ))}
        </div>
      </div>

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
              selectedOperator === op ? 'selected-operator' : ''
            }`}
            onClick={() => handleOperatorSelect(op)}
            disabled={isReshuffling || newCardsAnimatingIn}
          >
            <img src={src} alt={op} className="operator-img" />
          </button>
        ))}
      </div>

      <div className="controls d-flex justify-content-center gap-2">
        <button className="btn btn-info" onClick={handleUndo} disabled={isReshuffling || newCardsAnimatingIn}>Undo</button>
        <button className="btn btn-warning" onClick={handleReset} disabled={isReshuffling || newCardsAnimatingIn}>Reset</button>
        <button className="btn btn-success" onClick={() => startNewRound(true)} disabled={isReshuffling || newCardsAnimatingIn}>Reshuffle</button>
      </div>
    </div>
  );
}