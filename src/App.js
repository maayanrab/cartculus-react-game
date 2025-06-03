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

// Define a constant for the total number of card slots
const TOTAL_CARD_SLOTS = 4; // Assuming 4 cards always

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
  const [gameStarted, setGameStarted] = useState(false); // New state to control game start

  // Animation states
  const [isReshuffling, setIsReshuffling] = useState(false);
  const [newCardsAnimatingIn, setNewCardsAnimatingIn] = useState(false);
  // cardsToRender will now be an array of objects that represent slots, not just active cards
  const [cardsToRender, setCardsToRender] = useState([]);
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
        const soundsToLoad = [undoSound, operatorSound, successSound, reshuffleSound, targetRevealSound, discardHandSound];
        soundsToLoad.forEach(sound => {
          if (sound) { // Check if sound object was created
            sound.load();
            // Optional: Log loading errors for individual sounds if needed
            sound.onerror = () => console.error(`Error loading sound: ${sound.src}`);
          }
        });

        setUserInteracted(true);
        if (!gameStarted) { // If game hasn't started via this interaction, mark it to start
            setGameStarted(true);
        }

        document.removeEventListener('click', handleInitialInteraction);
        document.removeEventListener('keydown', handleInitialInteraction);
      }
    };

    // Only add listeners if the game hasn't effectively started through interaction
    if (!userInteracted) {
        document.addEventListener('click', handleInitialInteraction);
        document.addEventListener('keydown', handleInitialInteraction);
    }

    return () => {
      document.removeEventListener('click', handleInitialInteraction);
      document.removeEventListener('keydown', handleInitialInteraction);
    };
  }, [userInteracted, gameStarted]); // Added gameStarted to dependencies

  // Helper function to play sounds
  const playSound = (audio) => {
    if (userInteracted && audio && soundsOn) {
      audio.currentTime = 0;
      audio.play().catch(e => console.error("Error playing sound:", e));
    }
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Function to start a new round, with an optional flag to play reshuffle sound
  const startNewRound = async (playInitialDiscardSound = true) => { // Renamed for clarity
    if (isReshuffling) return; // Prevent double-triggering

    if (playInitialDiscardSound) { // Use the parameter name
      playSound(discardHandSound);
    }

    setIsReshuffling(true); // Signal that reshuffle animation is starting
    setNewCardsAnimatingIn(false); // Ensure this is false before exit animation
    setHandCardsFlipped(false); // Ensure new hand cards start unflipped (showing back)
    setTargetCardFlipped(false); // Ensure target card starts unflipped (showing back for the animation)

    document.body.classList.add('scrolling-disabled');

    // --- Cards Exit Animation ---
    // Filter for actively visible cards for the exit animation
    const currentlyVisibleCards = cards.filter(card => !card.invisible && !card.isPlaceholder);
    const cardPositions = new Map();
    currentlyVisibleCards.forEach(card => {
      const ref = cardRefs.current[card.id];
      if (ref) {
        const rect = ref.getBoundingClientRect();
        cardPositions.set(card.id, {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        });
      }
    });

    // Prepare cards for rendering during the exit animation
    // Only apply dynamicOutStyle to cards that are actually flying out
    setCardsToRender(cards.map(card => ({
      ...card,
      dynamicOutStyle: (!card.invisible && !card.isPlaceholder) ? getCardExitStyle(cardPositions.get(card.id), centerRef.current) : {},
      isTarget: false,
      invisible: card.isPlaceholder ? true : card.invisible // Keep placeholders invisible
    })));

    // Only wait for exit animation if there were cards to exit
    if (currentlyVisibleCards.length > 0) {
        await sleep(700);
    }

    // --- Generate New Cards and Prepare for Entry ---
    const { cards: newGeneratedCards, target: newTarget } = generateCardsAndTarget();

    setTarget(newTarget);
    setCurrentRoundTarget(newTarget);

    // Prepare new cards for animation. Fill all TOTAL_CARD_SLOTS.
    const preparedNewCardsForAnimation = Array.from({ length: TOTAL_CARD_SLOTS }).map((_, index) => {
      const newCard = newGeneratedCards[index];
      if (newCard) {
        return {
          ...newCard,
          isFlipped: true, // Start flipped (showing back) for entry animation
          isPlaceholder: false,
          invisible: false, // Ensure visible for animation
        };
      } else {
        // Create a placeholder for any empty slots
        return {
          id: `placeholder-entry-${Date.now()}-${index}`, // Unique ID for placeholder
          value: null, // No value for placeholder
          isAbstract: false,
          isFlipped: false, // Placeholder doesn't flip
          isPlaceholder: true, // Mark as placeholder
          invisible: true // Make it visually invisible but occupies space
        };
      }
    });

    // BEFORE ANIMATION FIX:
    // cardRefs.current = {}; // Clear refs for old cards
    // setCardsToRender(preparedNewCardsForAnimation); // Set the new cards for rendering
    // setCards([]); // Clear game logic cards temporarily; will be set after animation

    // await new Promise(resolve => requestAnimationFrame(() => resolve()));

    // setNewCardsAnimatingIn(true);

    cardRefs.current = {}; // Clear refs for old cards
    setCards([]); // Clear game logic cards temporarily; will be set after animation

    // Wait one frame before setting cardsToRender and triggering animation
    await new Promise(resolve => requestAnimationFrame(() => {
      setCardsToRender(preparedNewCardsForAnimation); // Only show new cards when animation is ready
      setNewCardsAnimatingIn(true);
      resolve();
    }));



    await sleep(400);
    playSound(reshuffleSound);

    // Wait for the new cards to animate in (and their individual delays)
    await sleep(800 + (newGeneratedCards.length > 0 ? (newGeneratedCards.length - 1) * 50 : 0)); // Adjust delay based on actual cards

    // --- Final Flips ---
    setHandCardsFlipped(true); // Trigger the flip for the hand cards
    await sleep(600);

    setTargetCardFlipped(true); // Trigger the flip for the target card
    playSound(targetRevealSound);
    await sleep(600);

    // Now set the actual game state cards, ensuring invisible placeholders are maintained
    const finalCardsState = Array.from({ length: TOTAL_CARD_SLOTS }).map((_, index) => {
      const generatedCard = newGeneratedCards[index];
      if (generatedCard) {
        return { ...generatedCard, isFlipped: false, invisible: false, isPlaceholder: false }; // Ensure they are front-facing for gameplay
      } else {
        return {
          id: `placeholder-final-${Date.now()}-${index}`,
          value: null,
          isAbstract: false,
          isFlipped: false,
          isPlaceholder: true,
          invisible: true // Maintain visual invisibility for placeholders
        };
      }
    });

    setCards(finalCardsState);
    setOriginalCards(newGeneratedCards); // originalCards should only hold the actual cards (not placeholders)
    setSelected([]);
    setSelectedOperator(null);
    setHistory([]);

    setIsReshuffling(false);
    setNewCardsAnimatingIn(false);

    document.body.classList.remove('scrolling-disabled');
  };

  // Helper to calculate dynamic exit translation for cards (restored for diagonal swipe)
  const getCardExitStyle = (cardCenter, screenCenterElement) => {
    if (!cardCenter || !screenCenterElement) return {};
    const screenRect = screenCenterElement.getBoundingClientRect();
    const screenX = screenRect.left + screenRect.width / 2;
    // To make cards swipe downwards (as requested initially)
    // We can define a target point far below the center of the screen
    // For a diagonal effect, we can still use screenX as the target X, but for Y,
    // let's make it the bottom of the viewport plus some offset.
    const targetY = window.innerHeight + 200; // 200px below the bottom of the viewport

    // Calculate dx (horizontal distance to screen center)
    const dx = screenX - cardCenter.x;
    // Calculate dy (vertical distance to targetY)
    const dy = targetY - cardCenter.y;

    const factor = 1.0; // Adjust if you want them to travel further/faster
    return {
      '--card-exit-x': `${dx * factor}px`,
      '--card-exit-y': `${dy * factor}px`,
    };
  };

  // Helper to calculate dynamic entry translation for cards (now primarily for the CSS class)
  // This function is no longer actively used as entry animation is from fixed bottom-off-screen.

  // Effect for initial game setup on component mount (runs only once game is started by interaction)
  useEffect(() => {
    if (gameStarted && userInteracted) { // Check both flags
      startNewRound(true); // Start with all sounds enabled for the first round
    }
  }, [gameStarted, userInteracted]); // Depend on gameStarted and userInteracted

  // Effect for winning condition and auto-reshuffle
  useEffect(() => {
    if (!isReshuffling && !newCardsAnimatingIn && gameStarted) { // Ensure game has started
      const visibleCards = cards.filter((card) => !card.invisible && !card.isPlaceholder); // Filter out true placeholders
      if (visibleCards.length === 1 && visibleCards[0].value === target && target !== null) { // ensure target isn't null
        confetti();
        playSound(successSound);
        if (autoReshuffle) {
          setTimeout(() => startNewRound(true), 2000);
        }
      }
    }
  }, [cards, target, autoReshuffle, userInteracted, soundsOn, isReshuffling, newCardsAnimatingIn, gameStarted]);


  const handleCardClick = (id) => {
    if (isReshuffling || newCardsAnimatingIn || !gameStarted) return; // Prevent interaction if game not started

    // Find the clicked card from the current state (which includes placeholders)
    const clickedCard = cards.find(c => c.id === id);
    if (!clickedCard || clickedCard.isPlaceholder || clickedCard.invisible) return; // Cannot select placeholder or invisible card

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
    if (isReshuffling || newCardsAnimatingIn || !gameStarted) return; // Prevent interaction if game not started

    const newOp = selectedOperator === op ? null : op;
    setSelectedOperator(newOp);
    if (selected.length === 2 && newOp) {
      performOperation(selected, newOp);
    }
  };

  const performOperation = ([aId, bId], operator) => {
    if (isReshuffling || newCardsAnimatingIn || !gameStarted) return; // Prevent interaction if game not started

    const a = cards.find((c) => c.id === aId);
    const b = cards.find((c) => c.id === bId);
    if (!a || !b) return; // Ensure cards are found

    const result = operate(a.value, b.value, operator);
    if (result == null) return;

    // Store a copy of the *current* full cards array, including placeholders, for history
    setHistory((prev) => [...prev, cards.map(c => ({...c}))]); // Deep copy to prevent mutation

    const newCard = {
      id: Date.now(),
      value: result,
      isAbstract: result < 1 || result > 13 || parseInt(result) !== result,
      isFlipped: false, // Newly created card is front-facing
      invisible: false,
      isPlaceholder: false
    };

    const newCards = cards.map((c) => {
      if (c.id === aId) return newCard; // Replace card 'a' with the result
      if (c.id === bId) return { ...c, invisible: true }; // Mark card 'b' as invisible
      return c; // Keep other cards as they are (including existing placeholders)
    });

    setCards(newCards);
    setSelected([]);
    setSelectedOperator(null);
    playSound(operatorSound);
  };

  const handleUndo = () => {
    if (isReshuffling || newCardsAnimatingIn || !gameStarted) return; // Prevent interaction if game not started
    if (history.length === 0) return;
    playSound(undoSound);
    const prev = history[history.length - 1];
    setCards(prev); // Revert to the previous full state
    setHistory(history.slice(0, -1));
    setSelected([]);
    setSelectedOperator(null);
  };

  const handleReset = () => {
    if (isReshuffling || newCardsAnimatingIn || !gameStarted) return; // Prevent interaction if game not started
    if (history.length === 0 && originalCards.length === 0) return; // Prevent reset if no moves were made and no original cards

    playSound(undoSound); // Or a dedicated reset sound

    // Construct the reset state with original cards and placeholders
    const resetCardsState = Array.from({ length: TOTAL_CARD_SLOTS }).map((_, index) => {
      const originalCard = originalCards[index];
      if (originalCard) {
        return { ...originalCard, isFlipped: false, invisible: false, isPlaceholder: false };
      } else {
        // If originalCards had less than TOTAL_CARD_SLOTS, fill the rest with placeholders
        return {
          id: `placeholder-reset-${Date.now()}-${index}`,
          value: null,
          isAbstract: false,
          isFlipped: false,
          isPlaceholder: true,
          invisible: true
        };
      }
    });

    setCards(resetCardsState);
    setHistory([]);
    setSelected([]);
    setSelectedOperator(null);
  };

  // Conditional rendering for "Click to start"
  if (!userInteracted) {
    return (
      <div className="container text-center position-relative d-flex flex-column justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
        {/* You can place the title here if you want it visible before interaction */}
        <h1 className="mb-4">CartCulus
             <h5 className="text-center">Practice Mode</h5>
        </h1>
        <p className="lead">Use all four cards to reach the target value. Press anywhere to start. Good luck!</p>
        {/* Hidden centerRef for calculations if needed even before game start, though less critical now */}
        <div ref={centerRef} className="screen-center-anchor d-none"></div>
      </div>
    );
  }

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

      {/* Only render target and cards if game has started */}
      {gameStarted && (
        <>
          <div className="target my-4">
            <div className="target-border-bs">
              <span className="target-text-bs">TARGET</span>
              <Card value={currentRoundTarget} isAbstract={currentRoundTarget < 1 || currentRoundTarget > 13} isTarget={true} isFlipped={!targetCardFlipped} />
            </div>
          </div>

          <div className="container">
            <div className="row justify-content-center gx-3 gy-3">
              {/* Render either cardsToRender (during animation) or cards (normal play) */}
              {(isReshuffling || newCardsAnimatingIn ? cardsToRender : cards).map((card, index) => {
                // Determine if this specific card should animate out
                // Only animate out if reshuffling AND it's not a placeholder AND it's not already invisible
                const shouldAnimateOut = isReshuffling && !newCardsAnimatingIn && !card.isPlaceholder && !card.invisible;
                // Determine if this specific card should animate in
                // Only animate in if newCardsAnimatingIn AND it's not a placeholder
                const shouldAnimateIn = newCardsAnimatingIn && !card.isPlaceholder;

                return (
                  <div
                    key={card.id}
                    className={`col-6 col-sm-auto d-flex justify-content-center reshuffle-card-container
                      ${shouldAnimateOut ? 'card-animating-out' : ''}
                      ${shouldAnimateIn ? 'card-animating-in' : ''}
                      ${shouldAnimateIn && card.isFlipped ? 'initial-offscreen-hidden' : ''}
                    `}
                    style={{
                      // Apply dynamicOutStyle only if animating out
                      ... (shouldAnimateOut ? card.dynamicOutStyle : {}),
                      '--card-animation-delay': shouldAnimateIn ? `${index * 0.05}s` : '0s'
                    }}
                    ref={el => cardRefs.current[card.id] = el}
                  >
                    <Card
                      value={card.value}
                      selected={selected.includes(card.id)}
                      onClick={
                        // Disable click if animating, or if it's a placeholder, or if it's invisible
                        !isReshuffling && !newCardsAnimatingIn && !card.isPlaceholder && !card.invisible ? () => handleCardClick(card.id) : undefined
                      }
                      isAbstract={card.isAbstract}
                      invisible={card.invisible} // Pass the invisible prop from App.js state
                      isPlaceholder={card.isPlaceholder} // Pass the isPlaceholder prop from App.js state
                      // Control flipping:
                      // During new card animation in, use card.isFlipped (which will be true for back)
                      // When not animating, use !handCardsFlipped for the final reveal
                      // If it's a placeholder, it should not flip
                      isFlipped={card.isPlaceholder ? false : (newCardsAnimatingIn ? card.isFlipped : (!isReshuffling && !newCardsAnimatingIn ? !handCardsFlipped : card.isFlipped))}
                    />
                  </div>
                );
              })}
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
            className={`operator-button ${selectedOperator === op ? 'selected-operator' : ''
              }`}
            onClick={() => handleOperatorSelect(op)}
            disabled={isReshuffling || newCardsAnimatingIn || !gameStarted} // Disable if game not started
          >
            <img src={src} alt={op} className="operator-img" />
          </button>
        ))}
      </div>

      <div className="controls d-flex justify-content-center gap-2">
        <button className="btn btn-info" onClick={handleUndo} disabled={isReshuffling || newCardsAnimatingIn || !gameStarted || history.length === 0}>Undo</button>
        <button className="btn btn-warning" onClick={handleReset} disabled={isReshuffling || newCardsAnimatingIn || !gameStarted || (history.length === 0 && originalCards.length === 0)}>Reset</button>
        <button className="btn btn-success" onClick={() => startNewRound(true)} disabled={isReshuffling || newCardsAnimatingIn || !gameStarted}>Reshuffle</button>
      </div>
    </div>
  );
}