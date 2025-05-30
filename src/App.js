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
    if (cards.length === 1 && cards[0].value === target) {
      confetti();
      setTimeout(() => startNewRound(), 2000);
    }
  }, [cards]);

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

    const indexA = cards.findIndex((c) => c.id === aId);
    const indexB = cards.findIndex((c) => c.id === bId);

    // Copy current cards
    let newCards = [...cards];

    // Remove both cards
    newCards = newCards.filter((c) => c.id !== aId && c.id !== bId);

    // Insert the result where the *first selected* card was
    const insertIndex = Math.min(indexA, indexB);
    newCards.splice(insertIndex, 0, newCard);
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

  return (
    <div className="container text-center">
      <h1>CartCulus</h1>
      <div className="target my-4">
        <p>Target:</p>
        <Card value={target} isAbstract={target < 1 || target > 13} />
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
                onClick={() => handleCardClick(card.id)}
                isAbstract={card.isAbstract}
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
              selectedOperator === op ? "selected-operator" : ""
            }`}
            onClick={() => handleOperatorSelect(op)}
          >
            <img src={src} alt={op} className="operator-img" />
          </button>
        ))}
      </div>

      <div className="controls">
        <button onClick={handleUndo}>Undo</button>
        <button onClick={() => setCards(originalCards)}>Reset</button>
        <button onClick={startNewRound}>Reshuffle</button>
      </div>
    </div>
  );
}
