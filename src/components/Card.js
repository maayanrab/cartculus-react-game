import React from 'react';

export default function Card({ value, onClick, selected, isAbstract }) {
  // Format the value to have a maximum of 2 decimal places if it's a number
  const formattedValue = typeof value === 'number'
    ? parseFloat(value.toFixed(3)) // Convert back to number to remove trailing zeros if not needed (e.g., 5.00 becomes 5)
    : value;

  const imagePath = isAbstract
    ? './images/cardabstract.png'
    : `./images/card${value}.png`; // Note: imagePath still uses original 'value' if image names depend on exact value

  return (
    <div
      className={`card ${selected ? 'selected' : ''}`}
      onClick={onClick}
    >
      <img src={imagePath} alt={value} />
      {isAbstract && <span className="card-label">{formattedValue}</span>}
    </div>
  );
}