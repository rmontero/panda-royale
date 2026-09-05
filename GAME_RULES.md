# Panda Royale — game rules as implemented by this app

This document describes the rules of **Panda Royale** exactly as this
scorekeeping app encodes them — dice colors, scoring formulas, round
structure, and the pass-and-play guidance it displays. It is written for a
coding agent that needs to modify or extend the scoring/game logic without
re-deriving it from the UI code.

**Scope disclaimer** (same one `llms.txt` gives humans): this app does not
implement or teach the *full* physical rulebook — it has no drafting/market
mechanics, no die-acquisition rules, and doesn't know the box's physical die
counts. It only encodes **scoring arithmetic**, **round structure**, and a
few **pass-and-play conveniences** (starting-dice guidance, pity-die
tracking) that were added on top. Every rule below is traceable to a
specific file/function — if it's not listed here with a source, this app
doesn't implement it, full stop. See "Not covered" at the end.

## Players and rounds

- **2–10 players** per game.
- **Exactly 10 rounds**, numbered 1–10. Constant: `ROUNDS = 10` in
  `index.html:475` (client) and `TOTAL_ROUNDS = 10` in `api/_lib/store.js`
  (server, authoritative for online games).
- **Round 1 is special**: every player rolls only their single starting
  yellow die — no other colors are in play yet. Enforced in two places:
  - Client UI: `renderEntry()` in `index.html` only shows the yellow row
    when `state.entryRound === 1` (`visibleRows = isR1 ? ENTRY_ROWS.filter(r
    => r.color === 'yellow') : ENTRY_ROWS`).
  - Client scoring: `diceForRound(fields, round)` (`index.html:1248`)
    discards every non-yellow value and keeps at most the first yellow value
    when `round === 1`, before the dice ever reach the scoring engine.
- Rounds 2–10: all seven colors are in play.

## The seven dice colors

Physical description of each color (from the vision-scan prompt in
`api/analyze.js`, which is the most detailed authoritative description of
what the physical dice look like) and its exact scoring rule (from
`lib/score.js`, the canonical scoring engine — run on both client for live
preview and server as the authoritative re-score):

| Color | What it looks like | Scoring formula |
|---|---|---|
| **Yellow** | Solid yellow, pipped (dots) | Sum of face values |
| **Purple** | Solid purple, pipped | Sum of face values, **×2** |
| **Blue** | Solid blue, pipped. Most have plain white pips; a few are the **glitter** variant (sparkly gold/metallic pips) | Sum of face values; if **any** blue die rolled this round is glitter, the **entire blue sum** is doubled (not just the glitter die's own value) |
| **Red** | Solid red. Each die mixes white-ink and black-ink numerals across its faces — read whichever ink color is face-up | White-numeral dice add, black-numeral dice subtract; sum the signed values, then **multiply by the count of red dice rolled** (not by anything else) |
| **Green** | Usually one large 20-sided die showing a printed number (not dots), 1–20 | Sum of face values |
| **Clear** | Colorless translucent/frosted plastic, pipped — easy to miss against a light table | Sum of face values |
| **Pink** | Solid pink, pipped. Usually zero or one per player per round (the "pity die" — see below) | Face value of the pity die, if the player has one |

Round total = sum of all seven colors' scores. Source: `scoreRound(dice)` in
[`lib/score.js`](lib/score.js):

```js
total = yellowSum + purpleSum + blueScore + redScore + greenSum + clearSum + pinkSum
```

Worked examples (from the actual formulas):
- **Blue**: dice `[3, 5]` with no glitter → `8`. Dice `[3, 5]` where either
  one is glitter → `16` (the whole sum doubles, once, regardless of how many
  glitter dice there are).
- **Red**: two white dice (`4`, `6`) and one black die (`2`) → signed sum
  `4 + 6 - 2 = 8`, dice count `3` → score `8 × 3 = 24`.
- **Purple**: dice `[3, 5]` → `(3 + 5) × 2 = 16`.

Each die object is `{ color, value, glitter?, sign? }` — `glitter` (bool)
only meaningful on blue, `sign` (`'positive' | 'negative'`) only meaningful
on red (white numeral = positive, black numeral = negative). See
`sanitizeDie()` in `lib/score.js` for the exact validation (values clamped
to `0..99`, unknown colors default to yellow, at most 80 dice per round).

## Starting setup and the pity (pink) die

Two pieces of setup guidance the app surfaces in the pass-and-play lobby
(`index.html`'s `renderLobby()`), not stored per-game state — just derived
from the player count each render:

- **Every player starts with exactly 1 yellow die** (this is what round 1
  scores).
- **Pity (pink) dice available in the box**, by player count — helper
  `pinkDiceFor(n)` in `index.html:1208`:

  | Players | Pink dice |
  |---|---|
  | 2–3 | 1 |
  | 4–6 | 2 |
  | 7–9 | 3 |
  | 10 | 4 |

  This count is *only* the app's UI guidance for how many physical pink dice
  to keep in the box for the group size — it is not itself a scoring rule
  (pink dice score exactly like any other color, per the table above; the
  count just tells you how many exist to be picked up as pity dice).

## Standings and the pity-die indicator (pass-and-play)

Implemented client-side only, for the shared-device (pass-and-play) mode —
`renderLobby()`'s local branch in `index.html`:

- Cumulative standings use `totalsFor(v)` (`index.html:1284`): sum every
  round's total per player, sort descending. This is the same helper used
  for the scoreboard tab.
- Once at least one player has a nonzero cumulative total, the player list
  re-sorts to current standings (instead of seating/roster order) and:
  - **Every player tied for the top total** gets a 👑 crown next to their
    name.
  - The **bottom N players** in that sorted order get a 🎀 ribbon, where
    `N = pinkDiceFor(playerCount)` (same table as above) — a simple
    positional cut of the current last-place player(s), not a strict
    tie-aware rules engine. This is meant to read as "these players
    currently hold/are eligible for a pity die," not as an authoritative
    ruling.
- Before any round has been scored (all totals are 0), no crown/ribbon is
  shown — the sort stays in roster/drag order.

## Entering a round's dice

Per-color input fields, one row per color (`ENTRY_ROWS` in `index.html`):

- **Yellow, purple, green, clear**: one free-text field; values are
  space/comma-separated face values, e.g. `3 5 6` (parsed by
  `parseValues()`, `index.html:1219` — clamped to `0..99`, non-numeric
  tokens dropped).
- **Blue**: two fields — "plain" and "glitter" — because glitter changes the
  scoring for the whole color, not the individual die.
- **Red**: two fields — "white +" and "black −" — because the numeral color
  determines the sign before the count-multiplier is applied.
- **Pink**: one field, normally holding at most one value (the pity die), but
  the input itself doesn't enforce a maximum — scoring just sums whatever's
  entered.
- Alternative to typing: a photo of the dice pool can be read by a vision
  model (`api/analyze.js`) using the exact same seven-color/scoring-formula
  knowledge described above; the player always confirms/edits the result
  before it's saved — the photo path never bypasses manual review.

## End of game

- A game is "finished" once every player has a saved entry for round 10.
- **Online (separate-phones) games**: detected server-side
  (`state.game.finished`, set by an Upstash Workflow —
  `api/workflows/finalize.js` — triggered when round 10 is submitted; it
  sleeps 45s for stragglers, then archives the final standings and records
  each player's **best single round** to a global Hall of Fame, shown on the
  home screen: `finalizeGame()` in `api/_lib/store.js`).
- **Local (pass-and-play) games**: detected purely client-side — every
  player has a `scores[10]` entry (`index.html`'s `renderBoard()`) — and are
  **never** sent to the Hall of Fame (pass-and-play makes zero server
  calls, by design).
- Local mode offers a **rematch**: "Start new match" (`resetLocalMatch()`,
  `index.html`) clears every round's scores but keeps the player roster
  (names, ids, chosen avatar colors) exactly as-is.

## What gates a player from playing (not a game rule, but affects who can)

Two features are optionally paywalled, independently, via feature flags
(`config:flags` in Redis, default **off** everywhere) — this has no effect
on scoring, only on who can start/join:
- Online multiplayer (create/join a separate-phones game).
- Photo-scan dice reading (`api/analyze.js`'s `POST`).

Pass-and-play is **always free** — it's 100% client-side and touches none of
the paywalled endpoints. Full detail in `README.md`'s "Pro / paywall"
section; not repeated here since it's an access-control concern, not a
scoring/game-mechanics one.

## Source-of-truth map

| Rule | File | Symbol |
|---|---|---|
| Scoring formulas | `lib/score.js` | `scoreRound()` |
| Die validation/clamping | `lib/score.js` | `sanitizeDie()`, `sanitizeDice()` |
| Round count | `index.html`, `api/_lib/store.js` | `ROUNDS`, `TOTAL_ROUNDS` |
| Round 1 special case | `index.html` | `diceForRound()` |
| Input field layout | `index.html` | `ENTRY_ROWS`, `FIELD_KEYS` |
| Text-field → dice parsing | `index.html` | `parseValues()`, `fieldsToDice()` |
| Pity-dice-by-player-count | `index.html` | `pinkDiceFor()` |
| Cumulative standings | `index.html` | `totalsFor()` |
| Local-mode ranking/crown/ribbon | `index.html` | `renderLobby()` |
| Local-mode end-of-game + rematch | `index.html` | `renderBoard()`, `resetLocalMatch()` |
| Online end-of-game + Hall of Fame | `api/workflows/finalize.js`, `api/_lib/store.js` | `finalizeGame()` |
| Physical die appearance (for photo-scan) | `api/analyze.js` | `SYSTEM_PROMPT` |

## Not covered by this app (and therefore not in this document)

- How dice are drafted, traded, or otherwise acquired during physical play
  (the "roll-and-write... dice-drafting" part of the game's own tagline) —
  this app only scores whatever dice a player reports having at the end of
  a round.
- Physical box contents/quantities beyond the derived pity-die guidance
  above.
- Any win condition beyond "highest cumulative total after round 10" — the
  app doesn't model tiebreak rules, bonus objectives, or end-game triggers
  besides round count.
- Official publisher rules text. For that, see Last Night Games' own rules
  for *Panda Royale* — this app is an unaffiliated fan-made companion tool.
