export const generateCards = () => {
  const all = Array.from({ length: 13 }, (_, i) => i + 1);
  const shuffled = all.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, 4).map((value, i) => ({ id: Date.now() + i, value }));
};

export const generateTarget = () => {
  return Math.floor(Math.random() * 13) + 1;
};

export const operate = (a, b, op) => {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b !== 0 ? a / b : null;
    default: return null;
  }
};