// Card.js
import React, { useRef, useLayoutEffect, useState, useCallback } from 'react';

export default function Card({ value, onClick, selected, isAbstract, invisible, isFlipped = false, isTarget = false, isPlaceholder = false }) {
  const formattedValue =
    typeof value === 'number' ? parseFloat(value.toFixed(3)) : value;

  const frontImagePath = isAbstract
    ? './images/cardabstract.png'
    : `./images/card${value}.png`;

  const backImagePath = './images/card_back.png';

  // Refs for dynamic font sizing
  const mainLabelRef = useRef(null);
  const topLabelRef = useRef(null);
  const bottomLabelRef = useRef(null);
  const imageContainerRef = useRef(null);

  // State to hold the dynamically calculated font size for the labels
  const [mainLabelFontSize, setMainLabelFontSize] = useState(88);
  const [cornerLabelFontSize, setCornerLabelFontSize] = useState(24); // Shared for top and bottom

  const MAX_MAIN_FONT_SIZE = 88;
  const MIN_MAIN_FONT_SIZE = 20;
  const MAX_CORNER_FONT_SIZE = 24; // Max font size for corner labels
  const MIN_CORNER_FONT_SIZE = 10; // Min font size for corner labels

  // Adjust this buffer based on your padding (5px padding on each side = 10px buffer)
  // and any desired extra space from the edges.
  const MAIN_LABEL_HORIZONTAL_BUFFER = 10;
  // A smaller buffer for corner labels as they might have less padding
  // Adjust based on your specific top/bottom label padding/margins
  const CORNER_LABEL_HORIZONTAL_BUFFER = 5;

  // Generic function to calculate font size
  const calculateFontSize = useCallback((labelElement, containerWidth, maxFontSize, minFontSize, horizontalBuffer) => {
    if (!labelElement || !containerWidth) return maxFontSize;

    // Temporarily set a large font size to measure the intrinsic width
    labelElement.style.fontSize = `${maxFontSize}px`;
    const currentTextWidth = labelElement.scrollWidth;

    const availableWidth = containerWidth - horizontalBuffer;

    if (currentTextWidth > availableWidth) {
      const newFontSize = (availableWidth / currentTextWidth) * maxFontSize;
      return Math.max(minFontSize, newFontSize);
    } else {
      return maxFontSize;
    }
  }, []);

  useLayoutEffect(() => {
    if (imageContainerRef.current) {
      const cardContentWidth = imageContainerRef.current.clientWidth;

      // Calculate font size for main label
      setMainLabelFontSize(
        calculateFontSize(
          mainLabelRef.current,
          cardContentWidth,
          MAX_MAIN_FONT_SIZE,
          MIN_MAIN_FONT_SIZE,
          MAIN_LABEL_HORIZONTAL_BUFFER
        )
      );

      // Calculate font size for corner labels (top and bottom)
      // They use the same logic and should have the same calculated size
      setCornerLabelFontSize(
        calculateFontSize(
          topLabelRef.current, // Use topLabelRef for calculation, as it's representative
          cardContentWidth / 2, // Assuming corner labels occupy roughly half the card width
          MAX_CORNER_FONT_SIZE,
          MIN_CORNER_FONT_SIZE,
          CORNER_LABEL_HORIZONTAL_BUFFER
        )
      );
    }
  }, [formattedValue, calculateFontSize]); // Re-run whenever the number changes or calc function is updated

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
                ref={mainLabelRef} // Apply ref to the main label span
                style={{ fontSize: `${mainLabelFontSize}px` }} // Dynamically set font size
              >
                {formattedValue}
              </span>
            )}
            {isAbstract && (
              <span
                className="top-card-label"
                ref={topLabelRef} // Apply ref to the top label span
                style={{ fontSize: `${cornerLabelFontSize}px` }} // Dynamically set font size
              >
                {formattedValue}
              </span>
            )}
            {isAbstract && (
              <span
                className="bottom-card-label"
                ref={bottomLabelRef} // Apply ref to the bottom label span
                style={{ fontSize: `${cornerLabelFontSize}px` }} // Dynamically set font size
              >
                {formattedValue}
              </span>
            )}
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