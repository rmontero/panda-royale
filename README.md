# Panda Royale Scorekeeper

A companion scorekeeping app for **Panda Royale** (Last Night Games), the dice-drafting
party game. Enter each round's dice (or snap a photo and let a vision model read them),
and the app does the scoring math — across all ten rounds, for every player.

Two ways to play:

- **Separate phones** — one person starts a game, everyone else joins with a 4-character
  code from their own device, and the scoreboard syncs live.
- **One shared phone** — pass-and-play: add everyone once, then hand the phone around
  each round. No code, no network.

This is a fan-made tool and isn't affiliated with or endorsed by Last Night Games.

Live at **https://pnd.ad**.

## How scoring works

| Color | Rule |
|---|---|
| Yellow | Sum of face values |
| Purple | Sum of face values, doubled |
| Blue | Sum of face values; doubled once if any die is the glitter variant |
| Red | White numerals add, black numerals subtract, summed, then multiplied by the number of red dice rolled |
| Green | Sum of face values |
| Clear | Sum of face values |
| Pink | Face value of your pity die |

The scoring engine lives in [`lib/score.js`](lib/score.js) and runs on both the client
(for the live preview as you type) and the server (authoritative — the server re-scores
every submission).

## Manual entry

The entry screen shows every color at once as plain number fields. Type the face values
space-separated (`3 5 6`), tab to the next color, and the round total updates on every
keystroke. Blue has a separate "glitter" box; red has separate white (+) and black (−)
boxes. No dropdowns, no steppers.

## Architecture

Static `index.html` + Vercel serverless functions. No build step for the front end.

| Piece | Tech | Purpose |
|---|---|---|
| Shared game state | **Upstash Redis** (Vercel KV) | One Redis hash per game — players, per-round scores. Per-field writes so players never clobber each other. 24h TTL. |
| End-of-game finalize | **Upstash Workflow** | On round 10, a durable workflow sleeps 45s for stragglers, then archives the final board and updates the hall of fame. Survives restarts mid-run. |
| Daily maintenance | **Upstash QStash** (schedule) | Cron job trims the hall-of-fame sorted set to the top 25. |
| Photo → dice | **Google Gemini** (`gemini-3.6-flash`, free tier) with a **Claude Haiku 4.5** fallback | Server-side proxy so the key never reaches the browser. Optional — manual entry always works. |

### Endpoints

| Route | Notes |
|---|---|
| `GET/POST /api/game` | Create / join / leave / score / unscore / reset. `GET ?code=ABCD` returns state (clients poll this every 3s). |
| `GET/POST /api/analyze` | `GET` reports whether a vision provider is configured; `POST { image }` returns read dice. |
| `POST /api/workflows/finalize` | Upstash Workflow endpoint (called by QStash, not humans). |
| `POST /api/tasks/sweep` | QStash-scheduled maintenance, signature-verified. |
| `GET /api/hof` | Hall of fame — biggest single-round scores across finished games. |

## Deploying

The project auto-deploys to Vercel on push to `main`.

### Required: Redis (multiplayer won't work without it)

1. Vercel dashboard → your project → **Storage** → **Create Database** → **Upstash for Redis**
   (or **Marketplace → Upstash**). Connect it to the project.
2. Redeploy. The integration injects `KV_REST_API_URL` / `KV_REST_API_TOKEN`
   (the store also accepts `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`).

Until this is connected, "separate phones" shows a friendly banner and only pass-and-play works.

### Optional: QStash + Workflow (archival + hall of fame)

1. Vercel → **Storage / Marketplace** → **Upstash QStash** → connect. It injects
   `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`.
2. Set `APP_URL=https://pnd.ad` in the project env (so QStash callbacks hit the right host).
3. Register the daily schedule once:

   ```bash
   QSTASH_TOKEN=<token> APP_URL=https://pnd.ad npm run setup:upstash
   ```

Without these, finishing a game just skips the archive/hall-of-fame step — everything else is unaffected.

### Optional: photo scoring

Set **one** of:

- `GEMINI_API_KEY` — free key from [ai.google.dev](https://ai.google.dev/) (Google AI Studio).
  Free-tier rate limits are far above what a game night needs.
- `ANTHROPIC_API_KEY` — uses `claude-haiku-4-5`.

### Domain

`pnd.ad` is configured on the Vercel project. If DNS needs pointing: add the `A` / `CNAME`
records Vercel shows under **Settings → Domains**.

## Local development

```bash
npm install
npx vercel dev          # runs the functions locally; needs `vercel link` first
```

For a quick front-end-only check, any static server works (`npx serve .`) — pass-and-play
mode is fully functional offline; the online endpoints will 404 without `vercel dev`.

## Tech

Vanilla HTML/CSS/JS front end (one ES module). Node serverless functions.
Dependencies: `@upstash/redis`, `@upstash/qstash`, `@upstash/workflow`, `@anthropic-ai/sdk`.

## License

No license file yet — all rights reserved by default.
