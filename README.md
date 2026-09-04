# Panda Royale Scorekeeper

A companion scorekeeping app for [Panda Royale](https://boardgamegeek.com/boardgame/) (Last Night Games), the dice-drafting party game. Photograph your dice pool each round, confirm what the app read, and it does the scoring math for you — plus a shared scoreboard so everyone at the table can follow along on their own phone.

This is a fan-made tool and isn't affiliated with or endorsed by Last Night Games.

## Features

- **Photo scoring** — snap a picture of your dice pool; an AI vision call reads each die's color and value, and you confirm or correct the results before anything is scored.
- **Full rules engine** — implements all seven dice colors' scoring, including doubled purple, glitter-doubled blue, and signed/multiplied red.
- **Shared scoreboard** — create a game with a short code, everyone at the table joins from their own device, and round-by-round totals sync live.
- **No install** — a single static HTML file, no build step, no dependencies.

## How scoring works

| Color | Rule |
|---|---|
| Yellow | Sum of face values |
| Purple | Sum of face values, doubled |
| Blue | Sum of face values; doubled once if any die is the glitter variant |
| Red | White numerals add, black numerals subtract, summed, then multiplied by the number of red dice rolled |
| Green | Sum of face values |
| Clear | Sum of face values |
| Pink | Face value of your pity die, if you have one |

## Running it

There's nothing to install. `index.html` is a self-contained static page — open it in a browser, or serve it from any static host.

```bash
# locally
open index.html

# or serve it
npx serve .
```

## ⚠️ Platform dependency

This app was built and tested as a **Claude artifact**, and it relies on two browser APIs that Claude's artifact runtime provides automatically:

- `window.storage` — used for all shared/cross-device data (joining a game, submitting scores, the live scoreboard). Outside of Claude, this API doesn't exist, so those actions will fail.
- An unauthenticated `fetch` to `https://api.anthropic.com/v1/messages` for the photo-reading step — Claude's runtime injects the API credentials automatically. On a standalone deployment (Vercel, etc.), this call will fail with no key configured, and would also hit CORS restrictions from a browser origin Anthropic doesn't allow directly.

**In short: as deployed to Vercel right now, the photo-reading and multiplayer sync features won't work.** To make a standalone deployment fully functional, it needs:

1. A small backend (e.g. a Vercel serverless function) that holds an Anthropic API key server-side and proxies the vision request.
2. A real shared datastore (e.g. Vercel KV, Upstash, Supabase) behind a small API, replacing `window.storage`.

Happy to build that backend layer if you want this fully working as a standalone site — just say so.

## Tech

Plain HTML, CSS, and vanilla JavaScript. No framework, no bundler, no npm dependencies.

## License

No license file is included yet — all rights reserved by default. Let me know if you'd like one added (e.g. MIT).
