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
  const [gameStarted, setGameStarted] = useState(false); // New state to control game start

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
    // IMPORTANT CHANGE: Filter to only include currently visible cards for exit animation
    const visibleCardsForExit = cards.filter(card => !card.invisible);

    const cardPositions = new Map();
    visibleCardsForExit.forEach(card => { // Use visibleCardsForExit
      const ref = cardRefs.current[card.id];
      if (ref) {
        const rect = ref.getBoundingClientRect();
        cardPositions.set(card.id, {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        });
      }
    });

    setCardsToRender(visibleCardsForExit.map(card => ({ // Use visibleCardsForExit
      ...card,
      dynamicOutStyle: getCardExitStyle(cardPositions.get(card.id), centerRef.current),
      isTarget: false,
      invisible: false // Ensure they are visible FOR THE ANIMATION even if they were hidden before
    })));
    
    // Only wait for exit animation if there were cards to exit
    if (visibleCardsForExit.length > 0) { // Check length of visible cards
        await sleep(700); 
    }


    // --- Generate New Cards and Prepare for Entry ---
    const { cards: newGeneratedCards, target: newTarget } = generateCardsAndTarget();

    setTarget(newTarget); 
    setCurrentRoundTarget(newTarget); 

    const preparedNewCardsForAnimation = newGeneratedCards.map(card => ({
      ...card,
      isFlipped: true, 
    }));

    cardRefs.current = {};
    setCardsToRender(preparedNewCardsForAnimation);
    setCards([]); // Clear game logic cards; will be set after animation

    await new Promise(resolve => requestAnimationFrame(() => resolve()));
    
    setNewCardsAnimatingIn(true);
    await sleep(400); 
    playSound(reshuffleSound); // This should now play as userInteracted is true

    await sleep(800 + (newGeneratedCards.length - 1) * 50); 

    // --- Final Flips ---
    setHandCardsFlipped(true); 
    await sleep(600); 

    setTargetCardFlipped(true); 
    playSound(targetRevealSound); // This should also play
    await sleep(600); 

    setCards(newGeneratedCards.map(card => ({ ...card, isFlipped: false })));
    // playSound(targetRevealSound); // This was a duplicate, targetReveal is played just before this
    playSound(targetRevealSound); // This should also play
    setOriginalCards(newGeneratedCards); 
    setSelected([]);
    setSelectedOperator(null);
    setHistory([]); // Ensure history is cleared on new round

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
    const dy = (window.innerHeight + screenRect.height / 2) - cardCenter.y;
    const factor = 1.5;
    return {
      '--card-exit-x': `${dx * factor}px`,
      '--card-exit-y': `${dy * factor}px`,
    };
  };

  // Helper to calculate dynamic entry translation for cards (now primarily for the CSS class)
  const getCardEntryStyle = (targetCardElement, screenCenterElement) => {
    if (!targetCardElement || !screenCenterElement) return {};
    const targetRect = targetCardElement.getBoundingClientRect();
    const screenWidth = window.innerWidth;
    const rowCenter = screenWidth / 2;
    const entryDx = rowCenter - (targetRect.left + targetRect.width / 2);
    return {
      '--card-enter-x': `${-targetRect.left + entryDx + (screenWidth / 2 - rowCenter)}px`,
    };
  };

  // Effect for initial game setup on component mount (runs only once game is started by interaction)
  useEffect(() => {
    if (gameStarted && userInteracted) { // Check both flags
      startNewRound(true); // Start with all sounds enabled for the first round
    }
  }, [gameStarted, userInteracted]); // Depend on gameStarted and userInteracted

  // Effect for winning condition and auto-reshuffle
  useEffect(() => {
    if (!isReshuffling && !newCardsAnimatingIn && gameStarted) { // Ensure game has started
      const visibleCards = cards.filter((card) => !card.invisible);
      if (visibleCards.length === 1 && visibleCards[0].value === target && target !== null) { // ensure target isn't null
        confetti();
        playSound(successSound);
        if (autoReshuffle) {
          setTimeout(() => startNewRound(true), 2000);
        }
      }
    }
  }, [cards, target, autoReshuffle, userInteracted, soundsOn, isReshuffling, newCardsAnimatingIn, gameStarted]); // Added gameStarted


  const handleCardClick = (id) => {
    if (isReshuffling || newCardsAnimatingIn || !gameStarted) return; // Prevent interaction if game not started

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

    setHistory((prev) => [...prev, cards]);

    const newCard = {
      id: Date.now(),
      value: result,
      isAbstract: result < 1 || result > 13 || parseInt(result) !== result,
    };

    const newCards = cards.map((c) => {
      if (c.id === aId) return newCard;
      if (c.id === bId) return { ...c, invisible: true }; 
      return c;
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
    setCards(prev);
    setHistory(history.slice(0, -1));
    setSelected([]);
    setSelectedOperator(null);
  };

  const handleReset = () => {
    if (isReshuffling || newCardsAnimatingIn || !gameStarted) return; // Prevent interaction if game not started
    if (history.length === 0) return; // Prevent reset if no moves were made
    playSound(undoSound); // Or a dedicated reset sound
    setCards(originalCards);
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
        <p className="lead">Click anywhere to start the playing.</p>
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
              {(isReshuffling || newCardsAnimatingIn ? cardsToRender : cards).map((card, index) => (
                <div
                  key={card.id}
                  className={`col-6 col-sm-auto d-flex justify-content-center reshuffle-card-container
                    ${isReshuffling && !newCardsAnimatingIn ? 'card-animating-out' : ''}
                    ${newCardsAnimatingIn ? 'card-animating-in' : ''}
                    ${(isReshuffling && card.isFlipped) || (newCardsAnimatingIn && card.isFlipped) ? 'initial-offscreen-hidden' : ''}
                  `}
                  style={{
                    ...card.dynamicOutStyle,
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
                    invisible={card.invisible}
                    isFlipped={!isReshuffling && !newCardsAnimatingIn ? !handCardsFlipped : card.isFlipped}
                  />
                </div>
              ))}
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
        <button className="btn btn-warning" onClick={handleReset} disabled={isReshuffling || newCardsAnimatingIn || !gameStarted || history.length === 0}>Reset</button>
        <button className="btn btn-success" onClick={() => startNewRound(true)} disabled={isReshuffling || newCardsAnimatingIn || !gameStarted}>Reshuffle</button>
      </div>
    </div>
  );
}