import React, { useState, useEffect } from 'react';
import Card from './components/Card';
import { generateCardsAndTarget, operate } from './gameLogic';
import confetti from 'canvas-confetti';
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles.css';

export default function App() {
  const [cards, setCards] = useState([]);
  const [target, setTarget] = useState(null);
  const [selected, setSelected] = useState([]);
  const [selectedOperator, setSelectedOperator] = useState(null);
  const [originalCards, setOriginalCards] = useState([]);
  const [history, setHistory] = useState([]);
  const [autoReshuffle, setAutoReshuffle] = useState(true); // 👈 Auto-reshuffle toggle

  const startNewRound = () => {
    const { cards: newCards, target: newTarget } = generateCardsAndTarget();
    setCards(newCards);
    setOriginalCards(newCards);
    setTarget(newTarget);
    setSelected([]);
    setSelectedOperator(null);
    setHistory([]);
  };

  useEffect(() => {
    startNewRound();
  }, []);

  useEffect(() => {
    const visibleCards = cards.filter((card) => !card.invisible);
    if (visibleCards.length === 1 && visibleCards[0].value === target) {
      confetti();
      if (autoReshuffle) {
        setTimeout(() => startNewRound(), 2000);
      }
    }
  }, [cards, target, autoReshuffle]);


  const handleCardClick = (id) => {
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
    const newOp = selectedOperator === op ? null : op;
    setSelectedOperator(newOp);
    if (selected.length === 2 && newOp) {
      performOperation(selected, newOp);
    }
  };

  const performOperation = ([aId, bId], operator) => {
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
      if (c.id === bId) return { ...c, invisible: true };
      return c;
    });

    setCards(newCards);
    setSelected([]);
    setSelectedOperator(null);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setCards(prev);
    setHistory(history.slice(0, -1));
    setSelected([]);
    setSelectedOperator(null);
  };

  const handleReset = () => {
    setCards(originalCards);
    setHistory([]); // Clear history so Undo doesn't go beyond the reset state
    setSelected([]);
    setSelectedOperator(null);
  };

  return (
    <div className="container text-center position-relative">
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
      </div>

      <h1 className="text-start text-sm-center">CartCulus
        <h5 className="text-start text-sm-center">Practice Mode</h5>
        </h1>
      
      <div className="target my-4">
        <div class="target-border-bs">
          <span class="target-text-bs">TARGET</span>
            <Card value={target} isAbstract={target < 1 || target > 13} />
        </div>
      </div>

      <div className="container">
        <div className="row justify-content-center gx-3 gy-3">
          {cards.map((card) => (
            <div
              key={card.id}
              className="col-6 col-sm-auto d-flex justify-content-center"
            >
              <Card
                value={card.value}
                selected={selected.includes(card.id)}
                onClick={
                  !card.invisible ? () => handleCardClick(card.id) : undefined
                }
                isAbstract={card.isAbstract}
                invisible={card.invisible}
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
          >
            <img src={src} alt={op} className="operator-img" />
          </button>
        ))}
      </div>

      <div className="controls">
        <button onClick={handleUndo}>Undo</button>
        {/* Modified Reset button handler */}
        <button onClick={handleReset}>Reset</button>
        <button onClick={startNewRound}>Reshuffle</button>
      </div>
    </div>
  );
}