// Engine + rules tests — run with:  node --test
// Pure-logic coverage of what BOTH game modes share (scoring, dice-count
// validation, per-color value ranges). No browser needed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreRound, sanitizeDie } from '../lib/score.js';
import {
  COLOR_MAX_VALUE, MAX_PLAYERS, isValidDieValue,
  expectedDiceCount, validateRoundDice,
} from '../lib/rules.js';

/* ------------------------------------------------------------------ *
 * scoring engine — one rule per color
 * ------------------------------------------------------------------ */
test('yellow / green / clear / pink = sum of face values', () => {
  assert.equal(scoreRound([{ color: 'yellow', value: 3 }, { color: 'yellow', value: 5 }]).breakdown.yellowSum, 8);
  assert.equal(scoreRound([{ color: 'green', value: 20 }]).breakdown.greenSum, 20);
  assert.equal(scoreRound([{ color: 'clear', value: 6 }, { color: 'clear', value: 2 }]).breakdown.clearSum, 8);
  assert.equal(scoreRound([{ color: 'pink', value: 11 }]).breakdown.pinkSum, 11);
});

test('purple = sum doubled', () => {
  assert.equal(scoreRound([{ color: 'purple', value: 3 }, { color: 'purple', value: 5 }]).breakdown.purpleSum, 16);
});

test('blue = sum, doubled once if any glitter die present', () => {
  assert.equal(scoreRound([{ color: 'blue', value: 3 }, { color: 'blue', value: 5 }]).breakdown.blueScore, 8);
  assert.equal(scoreRound([{ color: 'blue', value: 3 }, { color: 'blue', value: 5, glitter: true }]).breakdown.blueScore, 16);
  // two glitter dice still only doubles once
  assert.equal(scoreRound([{ color: 'blue', value: 3, glitter: true }, { color: 'blue', value: 5, glitter: true }]).breakdown.blueScore, 16);
});

test('red = signed sum × count of red dice', () => {
  // white 4,6 + black 2 => signed 8, count 3 => 24
  const dice = [
    { color: 'red', value: 4, sign: 'positive' },
    { color: 'red', value: 6, sign: 'positive' },
    { color: 'red', value: 2, sign: 'negative' },
  ];
  assert.equal(scoreRound(dice).breakdown.redScore, 24);
});

test('round total sums every color', () => {
  const dice = [
    { color: 'yellow', value: 3 },
    { color: 'purple', value: 5 },          // ×2 = 10
    { color: 'blue', value: 4, glitter: true }, // ×2 = 8
    { color: 'green', value: 20 },
  ];
  const r = scoreRound(dice);
  assert.equal(r.total, 3 + 10 + 8 + 20);
});

/* ------------------------------------------------------------------ *
 * per-color value ranges (server sanitize + shared rule)
 * ------------------------------------------------------------------ */
test('COLOR_MAX_VALUE matches the rulebook largest die per color', () => {
  assert.deepEqual(COLOR_MAX_VALUE, { yellow: 8, purple: 12, blue: 12, red: 8, green: 20, clear: 6, pink: 12 });
});

test('isValidDieValue enforces 1..max per color', () => {
  assert.equal(isValidDieValue('yellow', 8), true);
  assert.equal(isValidDieValue('yellow', 9), false);   // no yellow D9+
  assert.equal(isValidDieValue('clear', 6), true);
  assert.equal(isValidDieValue('clear', 7), false);    // clear is D6 only
  assert.equal(isValidDieValue('green', 20), true);
  assert.equal(isValidDieValue('pink', 0), false);     // a die can't roll 0
});

test('server sanitizeDie drops out-of-range values (clamps to 0)', () => {
  assert.equal(sanitizeDie({ color: 'yellow', value: 9 }).value, 0);
  assert.equal(sanitizeDie({ color: 'clear', value: 7 }).value, 0);
  assert.equal(sanitizeDie({ color: 'green', value: 20 }).value, 20);
});

test('scoreRound ignores out-of-range values (authoritative re-score)', () => {
  assert.equal(scoreRound([{ color: 'yellow', value: 6 }, { color: 'yellow', value: 9 }]).breakdown.yellowSum, 6);
  assert.equal(scoreRound([{ color: 'clear', value: 5 }, { color: 'clear', value: 7 }]).breakdown.clearSum, 5);
});

/* ------------------------------------------------------------------ *
 * per-round dice-count validation (both modes, on submit)
 * ------------------------------------------------------------------ */
test('expectedDiceCount: N normally, N+1 with a pink, 1 in round 1', () => {
  assert.equal(expectedDiceCount(1, false), 1);
  assert.equal(expectedDiceCount(1, true), 1);
  assert.equal(expectedDiceCount(2, false), 2);
  assert.equal(expectedDiceCount(2, true), 3);
  assert.equal(expectedDiceCount(5, false), 5);
  assert.equal(expectedDiceCount(5, true), 6);
});

test('round 1: exactly one yellow die', () => {
  assert.equal(validateRoundDice(1, [{ color: 'yellow', value: 5 }]).ok, true);
  assert.equal(validateRoundDice(1, []).code, 'need_dice');
  assert.equal(validateRoundDice(1, [{ color: 'yellow', value: 5 }, { color: 'yellow', value: 6 }]).code, 'too_many');
  assert.equal(validateRoundDice(1, [{ color: 'yellow', value: 5 }, { color: 'purple', value: 3 }]).code, 'r1_yellow');
});

test('round 2: exactly 2 dice, or 3 with a pink', () => {
  assert.equal(validateRoundDice(2, [{ color: 'yellow', value: 5 }, { color: 'purple', value: 3 }]).ok, true);
  assert.equal(validateRoundDice(2, [{ color: 'yellow', value: 5 }]).code, 'too_few');
  assert.equal(validateRoundDice(2, [
    { color: 'yellow', value: 5 }, { color: 'purple', value: 3 }, { color: 'green', value: 9 },
  ]).code, 'too_many');
  // 2 regular + 1 pink = 3 total => allowed
  assert.equal(validateRoundDice(2, [
    { color: 'yellow', value: 5 }, { color: 'purple', value: 3 }, { color: 'pink', value: 7 },
  ]).ok, true);
});

test('round N with a pink allows N+1; out-of-range values dont count', () => {
  const dice = [
    { color: 'yellow', value: 1 }, { color: 'yellow', value: 2 }, { color: 'green', value: 20 },
    { color: 'pink', value: 5 },
  ];
  assert.equal(validateRoundDice(3, dice).ok, true); // 4 dice, has pink, expected 4
  // an out-of-range clear:7 is not counted, so this stays exactly 3 for round 3
  const withBad = [
    { color: 'yellow', value: 1 }, { color: 'yellow', value: 2 }, { color: 'green', value: 20 },
    { color: 'clear', value: 7 },
  ];
  assert.equal(validateRoundDice(3, withBad).ok, true);
});

test('player cap constant', () => {
  assert.equal(MAX_PLAYERS, 10);
});
