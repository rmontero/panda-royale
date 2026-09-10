# AGENTS.md — Panda Royale Scorekeeper

Guidance for AI agents (and humans) working in this repo. Read this before making
changes. For the exhaustive scoring rules see [`GAME_RULES.md`](GAME_RULES.md);
for the product/deploy overview see [`README.md`](README.md).

## 1. What this repo is

A fan-made **scorekeeper** companion for the dice-drafting party game *Panda Royale*.
Live at **https://pnd.ad** (aka www.pnd.ad).

- **Front end:** a single `index.html` (~3.1k lines) — inline `<style>`, an `I18N`
  table, and one inline `<script type="module">`. **No build step.**
- **Back end:** Vercel serverless functions under `api/*`, sharing `api/_lib/*`.
- **Shared engine:** `lib/score.js` (scoring) + `lib/rules.js` (constraints), imported
  by both the client and the tests.
- **Storage:** Upstash Redis (one hash per game), optional Upstash QStash/Workflow.
- **Payments:** Stripe (Pro unlock). `api/talacha/*` is a **separate, unrelated**
  client-billing integration — do not touch it for game work.

## 2. Golden rules (read before any change)

- **Commit with signing OFF:** `git -c commit.gpgsign=false commit …`. The sandbox
  gpg keyring is unavailable and signed commits fail.
- **Deploy is not via git:** there is no push-to-deploy remote here. Ship with
  `npx vercel deploy --prod --yes` after each green checkpoint.
- **`lib/score.js` runs on BOTH client and server** (live preview + authoritative
  re-score). Never fork the logic — change it once.
- **`lib/rules.js` is the single source of truth** for `COLOR_MAX_VALUE`,
  `MAX_PLAYERS`/`MIN_PLAYERS`, and `validateRoundDice`/`expectedDiceCount`. It is
  imported by `index.html`, `lib/score.js`, and `tests/`. Don't re-inline these.
- **Everything fails toward free:** no Redis / missing or corrupt flags →
  paywall flags default off, `aiEnabled` defaults on.
- **Never touch `api/talacha/*`** — different Stripe account, `TALACHA_*` env.
- **5-locale parity is mandatory** (see §6).

## 3. Architecture map

Client → `POST /api/game` → Redis hash `pr:<CODE>` (per-field writes, 24h TTL).
Clients poll `GET /api/game?code=ABCD` every 3s.

| File | Role |
|---|---|
| `lib/score.js` | `scoreRound()`, `sanitizeDie()` — authoritative scoring |
| `lib/rules.js` | `COLOR_MAX_VALUE`, `MAX_PLAYERS`, `validateRoundDice`, `expectedDiceCount` |
| `api/game.js` | create / join / leave / score / unscore / reset (entitlement checked on create+join only) |
| `api/billing.js` | Pro checkout / session / redeem / register / login / me / **prefs** (op-dispatched) |
| `api/billing/webhook.js` | Stripe webhook — mints Pro code (needs raw body → own file) |
| `api/analyze.js` | photo → dice (Gemini, Claude fallback); Pro-gated independently |
| `api/flags.js` | `{ paywallEnabled, onlinePaywalled, aiPaywalled, aiEnabled }` |
| `api/_lib/store.js` | Redis game state + standings/finalize |
| `api/_lib/entitlements.js` | flags, Pro codes, accounts/sessions, server prefs |
| `api/_lib/upstash.js` | `appBaseUrl()`, QStash/Workflow helpers (import, don't re-declare) |

## 4. Invariants & non-obvious rules

- **10 rounds**; **2–10 players** (max enforced, min social).
- **Dice-count HARD STOP:** round N needs exactly N dice; **N+1 when a pink pity
  die is held**; round 1 is exactly one yellow die. Blocks too-few and too-many.
- **Per-color max face value** (`COLOR_MAX_VALUE`): yellow/red ≤8, purple/blue/pink
  ≤12, green ≤20, clear ≤6. Out-of-range values are dropped (to 0), not clamped.
- **🐼 / 🎀 badges:** 🐼 marks the last-round top scorer (drafts first), 🎀 the pity
  holder; badges go AFTER the name; no `#N` position tag.
- **Entry UI is a one-color-open-at-a-time accordion.** Keyboard: Tab/Enter forward
  (open next color, focus its input), Shift+Tab backward, past last color → Save.
- **Validation timing:** out-of-range dropped on blur (toast); focusing Save
  validates the whole round early; submit enforces the hard count rule.
- **Theme:** dark-default, OS-aware (`prefers-color-scheme` + `data-theme` override).
  Any light-theme change needs its own WCAG contrast pass — dark passing ≠ light passing.
- **Server prefs** (`lang`/`theme`) persist for logged-in users; anon → `localStorage`.

## 5. Feature flags & paywall

- Flags live in Redis `config:flags`. Toggle with `npm run flags -- --paywall=on --online=on --ai=on`.
- **Polarity trap:** `paywallEnabled` / `onlinePaywalled` / `aiPaywalled` default
  **off** (free). **`aiEnabled` is OPPOSITE — defaults on** and is a hard kill-switch
  for photo scanning (`npm run flags -- --enabled=off`).
- **Host-membership passthrough:** entitlement is checked on `create`/`join` only,
  never on score/unscore/leave/reset — a game in progress keeps working if a flag
  flips, and a joiner rides the host's unlock.
- **Prod is paywalled:** `onlinePaywalled=true`, `aiEnabled=false`. Online create
  returns 402 without a Pro code — this is correct, not a bug.

## 6. i18n

- 5 locales in the `I18N` table: **en, es, de, fr, pt**. Every key must exist in all
  five — no English leaks, no missing keys. Adding a string = 5 edits.
- Parity check: extract each locale's key set and assert equal counts before committing.

## 7. Test & verify

- **Engine:** `npm test` → `node --test tests/engine.test.mjs`.
- **E2E:** `npm run test:e2e` (Playwright). Pass-and-play auto-serves `index.html` on
  `127.0.0.1:8799`. The online flow only runs with `E2E_BASE_URL=https://www.pnd.ad`
  (and needs `E2E_PRO_CODE` to get past the prod paywall; without it the test asserts
  the correct gated upgrade screen).
- **a11y:** axe-core via `@axe-core/playwright`, target **0 violations in BOTH themes**.
- The `playwright-cli` KiroCrew browser tool is flaky here; `@playwright/test` works.

## 8. Deploy

- After each green checkpoint: `npx vercel deploy --prod --yes`, then verify markers live.
- **Vercel Hobby caps a deployment at 12 Serverless Functions.** Currently ~10 routes;
  `api/_lib/*` are libraries (not counted). This is why `billing.js` dispatches
  checkout/session/redeem/etc. by `op` instead of separate files. Adding routes risks
  breaching the cap.

## 9. Env vars

- **Redis (required for multiplayer):** `KV_REST_API_URL`/`KV_REST_API_TOKEN`
  (or `UPSTASH_REDIS_REST_*`). Without it, only pass-and-play works.
- **Optional:** QStash/Workflow (`QSTASH_*`, `APP_URL`) for archive + Hall of Fame;
  `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` for photo scan; `STRIPE_SECRET_KEY` +
  `STRIPE_WEBHOOK_SECRET` (+ optional `RESEND_*`) to sell Pro.
- `STRIPE_PRICE_ID` is **not** used (checkout uses inline `price_data`).

## 10. Known drift / TODO

- The Gemini model default in `api/analyze.js` (`GEMINI_MODEL || 'gemini-3.6-flash'`)
  is a non-existent slug — set a real model via `GEMINI_MODEL` before relying on
  photo scan (it ships disabled via `aiEnabled=false` anyway).
- Larger refactors deferred (recommended, not yet done): extract a shared
  `api/_lib/http.js` (`send`/`readBody`) to de-duplicate across endpoints; unify the
  Node `(req,res)` vs Web `(request)` handler split; fold the repeated `/api/billing`
  fetch boilerplate and the lantern-strip / last-round-badge helpers in `index.html`.
