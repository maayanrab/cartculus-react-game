import React from 'react';

export default function Card({ value, onClick, selected, isAbstract, invisible }) {
  // Format the value to have a maximum of 3 decimal places if it's a number
  const formattedValue =
    typeof value === 'number' ? parseFloat(value.toFixed(3)) : value;

  // Determine image path
  const imagePath = isAbstract
    ? './images/cardabstract.png'
    : `./images/card${value}.png`;

  // Apply conditional styling
  const cardStyle = {
    visibility: invisible ? 'hidden' : 'visible',
    cursor: invisible ? 'default' : 'pointer',
  };

  return (
    <div
      className={`card ${selected ? 'selected' : ''}`}
      onClick={onClick}
      style={cardStyle}
    >
      <img src={imagePath} alt={value} />
      {isAbstract && <span className="card-label">{formattedValue}</span>}
    </div>
  );
}
