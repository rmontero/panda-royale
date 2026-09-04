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

Localized in English, Spanish, German, French, and Portuguese — auto-detected from the
browser (`navigator.languages`), with a picker on every screen; the choice is remembered
in `localStorage` (`pr.lang`). All strings live in the `I18N` table in `index.html`.

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
| `GET /api/flags` | Paywall feature flags — see **Pro / paywall** below. |
| `POST /api/billing { op: "checkout" }` | Creates a Stripe Checkout Session for the one-time Pro unlock. |
| `POST /api/billing/webhook` | Stripe webhook — mints a Pro code on `checkout.session.completed`. |
| `GET /api/billing?op=session` | Post-checkout: looks up the code just minted for a `session_id`. |
| `POST /api/billing { op: "redeem" }` | Validates a Pro code so it can be entered on another device. |

`checkout`/`session`/`redeem` share one function (`api/billing.js`, dispatched
by `op`) rather than three separate files — the Vercel Hobby plan caps a
deployment at 12 Serverless Functions. `webhook` stays standalone since it
needs the raw request body for Stripe signature verification.

## Pro / paywall

Pass-and-play is free forever — it's 100% client-side and touches none of the
endpoints above. Online multiplayer (separate phones) and photo scanning can
each be gated behind a one-time "Pro" unlock, independently, via feature flags
stored in Redis (`config:flags`) — everything defaults to **off** (free) until
explicitly turned on, so this ships inert.

- **Toggle it** (no deploy needed): `npm run flags -- --paywall=on --online=on --ai=on`
  (needs the project's Redis env vars available locally — see below). Turning
  `paywallEnabled` off is the kill-switch if something goes wrong.
- **Identity model:** no accounts or passwords. Stripe Checkout collects an
  email, the webhook mints a short Pro code (`pro:<CODE>` in Redis, permanent),
  emails it via Resend, and shows it immediately on the post-checkout screen.
  Entering that code on any device unlocks it there (`pr.pro` in `localStorage`).
- **What's gated, and when:** `api/game.js` checks entitlement only on
  `create`/`join` — never on `score`/`unscore`/`leave`/`reset` — so a game
  already in progress keeps working even if a flag flips or a code is later
  revoked mid-session. `api/analyze.js`'s `POST` checks entitlement independently
  of `onlinePaywalled`, so photo scanning is paid even inside a free
  pass-and-play game.
- **Required env vars** to actually sell it: `STRIPE_SECRET_KEY`,
  `STRIPE_PRICE_ID` (a one-time Price created in the Stripe dashboard),
  `STRIPE_WEBHOOK_SECRET` (from the webhook endpoint's settings in Stripe,
  pointed at `/api/billing/webhook`), and optionally `RESEND_API_KEY` /
  `RESEND_FROM` for the confirmation email. Without these, `POST /api/billing { op: "checkout" }`
  and the webhook report `billing_unconfigured` rather than failing silently.

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

### Optional: Talacha client billing (unrelated to the game)

`api/talacha/*` is a separate integration for **Talacha's own client billing**
(software engineering services) — invoicing and one-off payments for
consulting clients, piggybacking on this repo's Vercel project. It shares
nothing with the Panda Royale Pro paywall above: different env var prefix
(`TALACHA_*` vs `STRIPE_*`), different webhook endpoint, different Stripe
Customers. See [`api/talacha/README.md`](api/talacha/README.md) for env vars,
required Stripe Dashboard setup (Tax, Business profile), and the two CLI
scripts (`npm run talacha:invoice`, `npm run talacha:checkout`).

## Local development

```bash
npm install
npx vercel dev          # runs the functions locally; needs `vercel link` first
```

For a quick front-end-only check, any static server works (`npx serve .`) — pass-and-play
mode is fully functional offline; the online endpoints will 404 without `vercel dev`.

## SEO & discovery

- `index.html` head: title/description, canonical, Open Graph + Twitter card,
  per-locale `og:locale:alternate`, and JSON-LD (`WebApplication` + `Game`).
- `og.jpg` (1200×630) is a static card (title + tagline + product photo).
  Favicon is a die: `favicon.svg` (primary) + PNG fallbacks + `site.webmanifest`.
- `robots.txt` allows search + answer engines (so assistants can cite the app)
  and blocks AI-training crawlers and commercial SEO scrapers. If a bot ignores
  it, add a Vercel Firewall / Cloudflare WAF rule.
- `llms.txt` is a plain-language description of the app and the scoring rules
  for generative engines. Geographic `geo.*` meta tags don't apply here.
- Canonical is `https://pnd.ad/`; set **pnd.ad** as the primary domain in Vercel
  (Settings → Domains) so `www` redirects to it, not the other way around.
- `<title>` and description are also translated client-side per language; the
  static tags stay English for non-JS crawlers.

## Tech

Vanilla HTML/CSS/JS front end (one ES module). Node serverless functions.
Dependencies: `@upstash/redis`, `@upstash/qstash`, `@upstash/workflow`, `@anthropic-ai/sdk`, `stripe`, `resend`.

## License

No license file yet — all rights reserved by default.
