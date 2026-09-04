// Shared scoring engine — used by the server (authoritative) and mirrored in the client for previews.
// Rules per README.md:
//   Yellow  sum of face values
//   Purple  sum of face values, doubled
//   Blue    sum of face values; doubled once if any die is the glitter variant
//   Red     white numerals add, black numerals subtract, summed, then multiplied by the red-dice count
//   Green   sum of face values
//   Clear   sum of face values
//   Pink    face value of your pity die

export const DICE_COLORS = ['yellow', 'purple', 'blue', 'red', 'green', 'clear', 'pink'];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function sanitizeDie(d) {
  const color = DICE_COLORS.includes(d && d.color) ? d.color : 'yellow';
  const die = {
    color,
    value: Math.max(0, Math.min(99, Math.round(num(d && d.value)))),
  };
  if (color === 'blue') die.glitter = !!(d && d.glitter);
  if (color === 'red') die.sign = d && d.sign === 'negative' ? 'negative' : 'positive';
  return die;
}

export function sanitizeDice(dice) {
  const list = Array.isArray(dice) ? dice : [];
  return list.slice(0, 80).map(sanitizeDie);
}

export function scoreRound(dice) {
  const list = sanitizeDice(dice);
  const by = (c) => list.filter((d) => d.color === c);
  const sum = (arr) => arr.reduce((s, d) => s + num(d.value), 0);

  const yellowSum = sum(by('yellow'));
  const purpleSum = sum(by('purple')) * 2;

  const blueDice = by('blue');
  const blueRaw = sum(blueDice);
  const hasGlitter = blueDice.some((d) => d.glitter);
  const blueScore = hasGlitter ? blueRaw * 2 : blueRaw;

  const redDice = by('red');
  const redSigned = redDice.reduce(
    (s, d) => s + (d.sign === 'negative' ? -num(d.value) : num(d.value)),
    0
  );
  const redScore = redSigned * redDice.length;

  const greenSum = sum(by('green'));
  const clearSum = sum(by('clear'));
  const pinkSum = sum(by('pink'));

  const total =
    yellowSum + purpleSum + blueScore + redScore + greenSum + clearSum + pinkSum;

  return {
    total,
    breakdown: { yellowSum, purpleSum, blueScore, redScore, greenSum, clearSum, pinkSum },
    counts: {
      yellow: by('yellow').length,
      purple: by('purple').length,
      blue: blueDice.length,
      red: redDice.length,
      green: by('green').length,
      clear: by('clear').length,
      pink: by('pink').length,
    },
  };
}
