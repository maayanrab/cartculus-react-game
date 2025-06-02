import React from 'react';

export default function Card({ value, onClick, selected, isAbstract, invisible, isFlipped = false, isTarget = false }) {
  const formattedValue =
    typeof value === 'number' ? parseFloat(value.toFixed(3)) : value;

  const frontImagePath = isAbstract
    ? './images/cardabstract.png'
    : `./images/card${value}.png`;

  const backImagePath = './images/card_back.png';

  const cardStyle = {
    cursor: isTarget ? 'default' : 'pointer', // Default cursor unless it's a target card
  };

  // The 'target-card-wrapper' class is applied if it's the target card
  // The 'invisible-card' class controls visibility for cards removed from play
  // The 'is-flipped' class controls the flip state of the inner element
  return (
    <div
      className={`card ${selected ? 'selected' : ''} ${invisible ? 'invisible-card' : ''} ${isTarget ? 'target-card-wrapper' : ''}`}
      onClick={onClick}
      style={cardStyle}
    >
      {/* The card-inner div is the flippable element.
          isFlipped prop from App.js determines its rotation. */}
      <div className={`card-inner ${isFlipped ? 'is-flipped' : ''}`}>
        {/* Front of the card */}
        <div className="card-face card-front">
          <img src={frontImagePath} alt={value} />
          {isAbstract && <span className="card-label">{formattedValue}</span>}
        </div>

        {/* Back of the card */}
        <div className="card-face card-back">
          <img src={backImagePath} alt="Card Back" />
        </div>
      </div>
    </div>
  );
}