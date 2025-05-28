import React from 'react';

export default function Card({ value, onClick, selected, isAbstract }) {
  const imagePath = isAbstract
    ? './images/cardabstract.png'
    : `./images/card${value}.png`;

  return (
    <div
      className={`card ${selected ? 'selected' : ''}`}
      onClick={onClick}
    >
      <img src={imagePath} alt={value} />
      {isAbstract && <span className="card-label">{value}</span>}
    </div>
  );
}