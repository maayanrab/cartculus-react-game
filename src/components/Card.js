import React from 'react';

export default function Card({ value, onClick, selected, isAbstract }) {
  const imagePath = isAbstract
    ? './cartculus-react-game/images/cardabstract.png'
    : `./cartculus-react-game/images/card${value}.png`;

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