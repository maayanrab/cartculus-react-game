import React from 'react';

export default function Card({ value, onClick, selected, isAbstract, invisible, isFlipped = false, isTarget = false, isPlaceholder = false }) {
  const formattedValue =
    typeof value === 'number' ? parseFloat(value.toFixed(3)) : value;

  const frontImagePath = isAbstract
    ? './images/card_abstract.png'
    : `./images/card_${value}.png`;

  const backImagePath = './images/card_back.png';

  // A card is visually hidden but occupies space if it's explicitly a placeholder
  // or if the game logic marks it as invisible.
  const shouldBePlaceholder = isPlaceholder || invisible;

  const cardStyle = {
    // Only allow click if it's not a target card, not a placeholder, and onClick is provided
    cursor: isTarget || shouldBePlaceholder || !onClick ? 'default' : 'pointer',
  };

  return (
    <div
      className={`card ${selected ? 'selected' : ''} ${shouldBePlaceholder ? 'invisible-card' : ''} ${isTarget ? 'target-card-wrapper' : ''}`}
      onClick={onClick}
      style={cardStyle}
    >
      <div className={`card-inner ${isFlipped ? 'is-flipped' : ''}`}>
        {/* Front of the card */}
        <div className="card-face card-front">
          <img src={frontImagePath} alt={value} />
          {isAbstract && 
          <span className="card-label">{formattedValue}</span>
          }
          {isAbstract && 
          <span className="card-label-top corner-label">{formattedValue}</span>
          }
          {isAbstract && 
          <span className="card-label-bottom corner-label">{formattedValue}</span>
          }
        </div>

        {/* Back of the card */}
        <div className="card-face card-back">
          <img src={backImagePath} alt="Card Back" />
        </div>
      </div>
    </div>
  );
}