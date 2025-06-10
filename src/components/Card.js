import React, { useRef, useLayoutEffect, useState } from 'react';

export default function Card({ value, onClick, selected, isAbstract, invisible, isFlipped = false, isTarget = false, isPlaceholder = false }) {
  const formattedValue =
    typeof value === 'number' ? parseFloat(value.toFixed(3)) : value;

  const frontImagePath = isAbstract
    ? './images/cardabstract.png'
    : `./images/card${value}.png`;

  const backImagePath = './images/card_back.png';

  // Refs for dynamic font sizing
  const labelRef = useRef(null);
  const imageContainerRef = useRef(null);

  // State to hold the dynamically calculated font size for the main label
  const [mainLabelFontSize, setMainLabelFontSize] = useState(88); // Initial max font size

  const MAX_FONT_SIZE = 88; // Your maximum desired font size
  const MIN_FONT_SIZE = 20; // The smallest you want the font to get
  // Adjust this buffer based on your padding (5px padding on each side = 10px buffer)
  // and any desired extra space from the edges.
  const HORIZONTAL_BUFFER = 10; // e.g., 5px padding on left + 5px padding on right

  useLayoutEffect(() => {
    if (labelRef.current && imageContainerRef.current) {
      const cardContentWidth = imageContainerRef.current.clientWidth; // Get the effective width of the card's content area
      const availableWidth = cardContentWidth - HORIZONTAL_BUFFER;

      // Temporarily set a large font size to measure the intrinsic width if it overflows
      // This ensures scrollWidth reflects the true width without current constraints
      labelRef.current.style.fontSize = `${MAX_FONT_SIZE}px`;
      const currentTextWidth = labelRef.current.scrollWidth;

      if (currentTextWidth > availableWidth) {
        // Text is too wide, calculate new font size
        const newFontSize = (availableWidth / currentTextWidth) * MAX_FONT_SIZE;
        setMainLabelFontSize(Math.max(MIN_FONT_SIZE, newFontSize)); // Ensure it doesn't go below min
      } else {
        // Text fits or is smaller than available space, set to max font size
        setMainLabelFontSize(MAX_FONT_SIZE);
      }
    }
  }, [formattedValue]); // Re-run this effect whenever the number (formattedValue) changes

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
          {/* Apply ref to the container whose width you want to respect for the main label */}
          <div className="image-container" ref={imageContainerRef}>
            <img src={frontImagePath} alt={value} />
            {isAbstract && (
              <span
                className="card-label"
                ref={labelRef} // Apply ref to the label span
                style={{ fontSize: `${mainLabelFontSize}px` }} // Dynamically set font size
              >
                {formattedValue}
              </span>
            )}
            {isAbstract && <span className="top-card-label">{formattedValue}</span>}
            {isAbstract && <span className="bottom-card-label">{formattedValue}</span>}
          </div>
        </div>

        {/* Back of the card */}
        <div className="card-face card-back">
          <img src={backImagePath} alt="Card Back" />
        </div>
      </div>
    </div>
  );
}