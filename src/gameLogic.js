// Generates a deck with 4 of each card from 1 to 13 (like a real deck)
const createFullDeck = () => {
  return Array(4).fill().flatMap(() => Array.from({ length: 13 }, (_, i) => i + 1));
};

export const generateCardsAndTarget = () => {
  const deck = createFullDeck();

  // Draw target from the deck
  const targetIndex = Math.floor(Math.random() * deck.length);
  const target = deck.splice(targetIndex, 1)[0];

  // Draw 4 cards from the remaining deck
  const cards = [];
  for (let i = 0; i < 4; i++) {
    const index = Math.floor(Math.random() * deck.length);
    cards.push(deck.splice(index, 1)[0]);
  }

  // Return both cards and target
  return {
    target,
    cards: cards.map((value, i) => ({
      id: Date.now() + i,
      value,
    })),
  };
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
