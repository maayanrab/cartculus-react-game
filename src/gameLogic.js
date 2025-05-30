export const generateCards = () => {
  // Create a full deck with 4 of each card from 1 to 13
  const fullDeck = Array(4).fill().flatMap(() => Array.from({ length: 13 }, (_, i) => i + 1));

  // Draw 4 cards without replacement
  const drawn = [];
  for (let i = 0; i < 4; i++) {
    const index = Math.floor(Math.random() * fullDeck.length);
    drawn.push(fullDeck.splice(index, 1)[0]); // Remove from deck
  }

  // Return card objects with IDs
  return drawn.map((value, i) => ({
    id: Date.now() + i,
    value,
  }));
};

export const generateTarget = () => {
  // Random target between 1 and 13
  return Math.floor(Math.random() * 13) + 1;
};

export const operate = (a, b, op) => {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '×':
      return a * b;
    case '÷':
      return b !== 0 ? a / b : null;
    default:
      return null;
  }
};
