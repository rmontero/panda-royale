# Panda Royale — game rules as implemented by this app

This document describes the rules of **Panda Royale** exactly as this
scorekeeping app encodes them — dice colors, scoring formulas, round
structure, and the pass-and-play guidance it displays. It is written for a
coding agent that needs to modify or extend the scoring/game logic without
re-deriving it from the UI code.

**Scope disclaimer**: this document has two kinds of claims, marked
throughout —
- **[APP]** — implemented by this codebase, traceable to a specific
  file/function. If a rule is marked [APP], you can go read the code.
- **[OFFICIAL]** — from Last Night Games' own official game description
  (publisher website), included here for context because a coding agent
  working on this app should know the real game even where the app doesn't
  model it. These are **not** implemented by this app — no code enforces
  them, and there's nothing to point at.

The app only encodes **scoring arithmetic**, **round structure**, and a few
**pass-and-play conveniences** (starting-dice guidance, pity-die tracking)
that were added on top — it does not implement drafting, stealing, or turn
order. See "Not implemented by this app" at the end for the full list of
official mechanics this app is silent on.

## Theme [OFFICIAL]

Each player is a panda Elder recruiting pandas onto their team from seven
clans, one clan per dice color. Each clan/color has its own quirk (see the
color table below) — picking which clans to invest in is the game's core
strategic tension. None of the theme (Elders, clans, recruitment) has any
mechanical presence in this app beyond flavor.

## Players and rounds

- **2–10 players** per game. [APP] — enforced only implicitly (no explicit
  min/max check found in `api/game.js`'s create/join; this is a UI/social
  convention, not a coded limit).
- **Exactly 10 rounds**, numbered 1–10. [APP] Constant: `ROUNDS = 10` in
  `index.html:475` (client) and `TOTAL_ROUNDS = 10` in `api/_lib/store.js`
  (server, authoritative for online games).
- **Dice pool grows by one die per round** [OFFICIAL]: players begin round 1
  with a single starter die (yellow) and draft one additional die of their
  choice each round, so by round 10 every player rolls 10 dice total. **The
  app does not enforce this** — it only special-cases round 1 (see below);
  rounds 2–10 accept however many dice of any color a player reports, with
  no check that the count matches "rounds played so far."
- **Round 1 is special**: every player rolls only their single starting
  yellow die — no other colors are in play yet. [APP] Enforced in two
  places:
  - Client UI: `renderEntry()` in `index.html` only shows the yellow row
    when `state.entryRound === 1` (`visibleRows = isR1 ? ENTRY_ROWS.filter(r
    => r.color === 'yellow') : ENTRY_ROWS`).
  - Client scoring: `diceForRound(fields, round)` (`index.html:1248`)
    discards every non-yellow value and keeps at most the first yellow value
    when `round === 1`, before the dice ever reach the scoring engine.
- Rounds 2–10: all seven colors are in play (per the app's input UI); per
  the official rules, the player's actual dice count that round should equal
  the round number, growing by exactly one drafted die each round.

## The round structure — four steps [OFFICIAL]

The official rules run each round in four steps. **This app only assists
with step 1** (recording the outcome of rolling+scoring); steps 2–4 are
pure tabletop play the app has no visibility into:

1. **Roll & score.** Everyone rolls their current dice pool and tallies
   their round score (originally via a paper score sheet — this app's
   entry screen replaces that sheet). This is the only step this app
   models — see "The seven dice colors" and "Entering a round's dice"
   below.
2. **Steal (optional).** Any player holding a clear/"rogue" die may use it
   to steal a die from another player. See the Clear row in the color table
   — the publisher explicitly calls out removing clear dice from the game
   entirely for a kid-friendlier session, "so no one gets their feelings
   hurt."
3. **Draft.** Each player adds one new die to their hand for next round.
4. **Draft order.** Turn order for drafting is set by each player's
   **cumulative yellow-dice score** (highest yellow total drafts first) —
   this makes yellow a dual-purpose resource: it scores like any other
   color *and* buys drafting priority. A player can lean into yellow early
   for draft-order control, or skip it entirely to leave room in their
   hand for higher-scoring colors.

## The seven dice colors

Physical description of each color (from the vision-scan prompt in
`api/analyze.js`, which is the most detailed authoritative description of
what the physical dice look like) and its exact scoring rule (from
`lib/score.js`, the canonical scoring engine — run on both client for live
preview and server as the authoritative re-score):

| Color | What it looks like | Scoring formula [APP] | Special property [OFFICIAL, not implemented by the app] |
|---|---|---|---|
| **Yellow** | Solid yellow, pipped (dots) | Sum of face values | Cumulative yellow score sets **drafting turn order** each round (highest drafts first) — see round-structure step 4 above |
| **Purple** | Solid purple, pipped | Sum of face values, **×2** | None beyond scoring |
| **Blue** | Solid blue, pipped. Most have plain white pips; a few are the **glitter** variant (sparkly gold/metallic pips) | Sum of face values; if **any** blue die rolled this round is glitter, the **entire blue sum** is doubled (not just the glitter die's own value) | None beyond scoring — glitter blue is drafted as its own die type (see dice distribution below), not a random property of a plain blue die |
| **Red** | Solid red. Each die mixes white-ink and black-ink numerals across its faces — read whichever ink color is face-up | White-numeral dice add, black-numeral dice subtract; sum the signed values, then **multiply by the count of red dice rolled** (not by anything else) | None beyond scoring |
| **Green** | Usually one large 20-sided die showing a printed number (not dots), 1–20 | Sum of face values | None beyond scoring |
| **Clear** | Colorless translucent/frosted plastic, pipped — easy to miss against a light table | Sum of face values | Also called the **"rogue" die**: a player holding one may **steal a die from any other player** (round-structure step 2). Publisher's own suggestion: **remove clear dice entirely for kid-friendly play** so no one's feelings get hurt over a steal — the app has no toggle for this today, but it's a natural candidate for a future "kid mode" |
| **Pink** | Solid pink, pipped/D12. Usually zero or one per player per round (the "pity die" — see below) | Face value of the pity die, if the player has one | Fixed, scarce supply (only 4 exist in the whole box, regardless of player count — see dice distribution below); who's entitled to hold one is a table-negotiated "pity" convention the official rules don't spell out mechanically |

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

## Official dice distribution [OFFICIAL]

The physical box's full die inventory, per the publisher's product page.
Not modeled by the app at all — the app takes a face value per die and
never asks about die size or which specific die was rolled:

| Die type | Quantity |
|---|---|
| Yellow D6 (starter dice) | 10 |
| Yellow D8 | 7 |
| Purple D8 | 7 |
| Purple D12 | 7 |
| Blue D6 | 10 |
| Blue D8 | 9 |
| Blue D12 | 9 |
| Glitter Blue D6 | 7 |
| Red D6 | 10 |
| Red D8 | 9 |
| Green D20 | 10 |
| Clear/White D6 | 7 |
| Pink D12 (pity dice) | 4 |

Notable implications, none enforced by the app:
- Most colors come in **multiple sizes** (yellow/purple/blue/red span
  D6→D8→D12), implying a die-size upgrade path through drafting — a bigger
  die drafted later presumably rolls higher on average. The app just
  accepts whatever value is typed in; it has no concept of die size or
  tier.
- **Pink is fixed at 4 dice total in the box**, full stop — it does not
  scale with player count officially.

## Starting setup and the pity (pink) die

- **Every player starts with exactly 1 yellow D6** [OFFICIAL, matches
  round 1's app behavior] — this is what round 1 scores.
- **App-only pity-dice guidance** [APP]: the pass-and-play lobby
  (`renderLobby()` in `index.html`) shows a suggested pink-dice count that
  *scales with player count*, via `pinkDiceFor(n)` (`index.html:1208`):

  | Players | Pink dice (app's suggestion) |
  |---|---|
  | 2–3 | 1 |
  | 4–6 | 2 |
  | 7–9 | 3 |
  | 10 | 4 |

  **This diverges from the official box, which fixes pink dice at exactly 4
  regardless of player count** (see above). This table was a deliberate
  app-level house-rule addition (requested and specified exactly as shown,
  independent of the official count) to give smaller groups fewer pity dice
  in circulation rather than handing out all 4 regardless of table size — it
  is not a claim about the physical game. If this app is ever changed to
  match the official rules exactly, `pinkDiceFor()` should return a
  constant `4` instead of scaling. In both cases, pink dice score identically
  (per the color table above) — this only affects the app's UI hint and the
  pity-ribbon cutoff (see next section), never the arithmetic.

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

## Not implemented by this app

These are real, official mechanics (documented above, tagged [OFFICIAL])
that this app has **zero code for** — no state, no UI, no enforcement. If a
future feature wants to model any of these, there is nothing to extend;
they'd be built from scratch:

- **Drafting**: choosing and adding one new die per round. The app never
  asks "which die did you draft" — it only asks "what did you roll," each
  round independently.
- **Stealing** via a clear/rogue die. The app has no concept of one
  player's die moving to another player's hand.
- **Draft turn order** by cumulative yellow score. The app tracks yellow's
  *score* (it's just another color in `scoreRound()`) but never uses it to
  order anything.
- **Die size/tier** (D6 vs. D8 vs. D12 vs. D20). The app only ever sees a
  face value (`0..99`); it has no idea what die produced it.
- Any win condition beyond "highest cumulative total after round 10" — no
  tiebreak rules, bonus objectives, or end-game triggers besides round
  count.

For the official rules in full (including anything not summarized here),
see Last Night Games' own product page and rulebook for *Panda Royale* —
this app is an unaffiliated fan-made companion tool and does not reproduce
the rulebook verbatim.
