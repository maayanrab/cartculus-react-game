// Generates a deck with 4 of each card from 1 to 13 (like a real deck)
const createFullDeck = () => {
  return Array(4).fill().flatMap(() => Array.from({ length: 13 }, (_, i) => i + 1));
};

export const generateCardsAndTarget = (presetCards = null, presetTarget = null) => {
  if (presetCards && presetTarget !== null) {
    return {
      target: presetTarget,
      cards: presetCards.map((value, i) => ({
        id: Date.now() + i,
        value,
      })),
    };
  }

  const deck = createFullDeck();
  const targetIndex = Math.floor(Math.random() * deck.length);
  const target = deck.splice(targetIndex, 1)[0];

  const cards = [];
  for (let i = 0; i < 4; i++) {
    const index = Math.floor(Math.random() * deck.length);
    cards.push(deck.splice(index, 1)[0]);
  }

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
