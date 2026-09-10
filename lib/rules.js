// Shared game-constraint rules — imported by the client (index.html) AND the
// test suite, so validation is verified against the same code the app runs.
//
// Grounded in GAME_RULES.md (official dice distribution):
//   • Each color's max face value = the largest die that color comes in.
//   • A player rolls N dice in round N (start 1, draft +1 each round), PLUS one
//     extra when they hold a pink pity die (so N+1 with a pink).
//   • Round 1: exactly 1 die, yellow only.
//   • 2–10 players.

export const TOTAL_ROUNDS = 10;
export const MAX_PLAYERS = 10;
export const MIN_PLAYERS = 2;

// Largest die each color comes in → max legal face value (values are 1..max).
// Yellow D6/D8 → 8; Purple D8/D12 → 12; Blue D6/D8/D12 → 12; Red D6/D8 → 8;
// Green D20 → 20; Clear/White D6 → 6; Pink D12 → 12.
export const COLOR_MAX_VALUE = {
  yellow: 8, purple: 12, blue: 12, red: 8, green: 20, clear: 6, pink: 12,
};

/** True if a face value is legal for its color (1..max). */
export function isValidDieValue(color, value) {
  const max = COLOR_MAX_VALUE[color] || 99;
  return Number.isFinite(value) && value >= 1 && value <= max;
}

/** Keep only dice whose face value is in range for their color. */
export function inRangeDice(dice) {
  return (dice || []).filter((d) => isValidDieValue(d.color, d.value));
}

/**
 * Expected dice count for a round given whether a pink pity die is held.
 *   round 1 → 1 (yellow only). round N → N, or N+1 when hasPink.
 */
export function expectedDiceCount(round, hasPink) {
  if (round <= 1) return 1;
  return round + (hasPink ? 1 : 0);
}

/**
 * Validate the dice a player entered for a round. `dice` is an array of
 * { color, value } (each entered value is one die). Returns:
 *   { ok: true }  or  { ok: false, code, ...vars }
 * codes: 'need_dice' | 'r1_yellow' | 'too_many' | 'too_few'
 * Out-of-range values are ignored (they're dropped/flagged separately).
 */
export function validateRoundDice(round, dice) {
  const all = inRangeDice(dice);
  const count = all.length;
  const hasPink = all.some((d) => d.color === 'pink');

  if (round <= 1) {
    if (count === 0) return { ok: false, code: 'need_dice', n: 1 };
    if (all.some((d) => d.color !== 'yellow')) return { ok: false, code: 'r1_yellow' };
    if (count > 1) return { ok: false, code: 'too_many', max: 1 };
    return { ok: true };
  }
  const expected = expectedDiceCount(round, hasPink);
  if (count < expected) return { ok: false, code: 'too_few', have: count, need: expected };
  if (count > expected) return { ok: false, code: 'too_many', max: expected };
  return { ok: true };
}
