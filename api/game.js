// Multiplayer game API.
//   GET  /api/game?code=ABCD                          -> current game state
//   POST /api/game { op: "create", playerId, name }   -> new game (code in response)
//   POST /api/game { op: "join",   code, playerId, name }
//   POST /api/game { op: "leave",  code, playerId }
//   POST /api/game { op: "score",  code, playerId, round, dice }
//   POST /api/game { op: "unscore", code, playerId, round }
//   POST /api/game { op: "reset",  code, playerId }   -> host only, wipes all round scores

import {
  storageConfigured,
  loadGame,
  createGame,
  joinGame,
  leaveGame,
  submitScore,
  clearScore,
  resetScores,
  TOTAL_ROUNDS,
} from './_lib/store.js';
import { triggerFinalize } from './_lib/upstash.js';
import { getFlags, isEntitled } from './_lib/entitlements.js';
import { send, readBody } from './_lib/http.js';

const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

export default async function handler(req, res) {
  if (!storageConfigured()) {
    return send(res, 503, {
      error: 'storage_unconfigured',
      message:
        'Shared storage is not connected. Attach an Upstash Redis (Vercel KV) store to this project and redeploy.',
    });
  }

  try {
    if (req.method === 'GET') {
      const code = cleanCode(req.query.code);
      if (!code) return send(res, 400, { error: 'missing_code' });
      const game = await loadGame(code);
      if (!game) return send(res, 404, { error: 'not_found' });
      return send(res, 200, game);
    }

    if (req.method === 'POST') {
      const body = readBody(req);
      const op = body.op;
      const playerId = String(body.playerId || '').slice(0, 40);
      if (!playerId) return send(res, 400, { error: 'missing_player_id' });

      // Online play needs at least one Pro member. The HOST pays: `create`
      // requires the caller's own entitlement. Joiners ride on the host's
      // membership — a `join` is allowed as long as the game already exists
      // (its host was entitled at create time), so a whole table plays on one
      // person's unlock. Never checked on score/unscore/leave/reset, so an
      // in-progress game keeps working even if a flag flips mid-session.
      if (op === 'create') {
        const flags = await getFlags();
        if (flags.paywallEnabled && flags.onlinePaywalled && !(await isEntitled(body.proCode))) {
          return send(res, 402, {
            error: 'payment_required',
            message: 'Separate-phones play needs a Pro unlock.',
          });
        }
      } else if (op === 'join') {
        const flags = await getFlags();
        if (flags.paywallEnabled && flags.onlinePaywalled) {
          const jcode = cleanCode(body.code);
          const exists = jcode ? await loadGame(jcode) : null;
          // Game exists => host already paid; the joiner plays on that
          // membership. Game missing => require the joiner's own Pro (mirrors
          // the create gate; join then 404s anyway if the code is bad).
          if (!exists && !(await isEntitled(body.proCode))) {
            return send(res, 402, {
              error: 'payment_required',
              message: 'Separate-phones play needs a Pro unlock.',
            });
          }
        }
      }

      if (op === 'create') {
        const game = await createGame({ hostId: playerId, name: body.name });
        return send(res, 200, game);
      }

      const code = cleanCode(body.code);
      if (!code) return send(res, 400, { error: 'missing_code' });

      let game;
      if (op === 'join') game = await joinGame(code, { playerId, name: body.name });
      else if (op === 'leave') game = await leaveGame(code, { playerId });
      else if (op === 'score') {
        game = await submitScore(code, { playerId, round: body.round, dice: body.dice });
        if (game && Number(body.round) >= TOTAL_ROUNDS) {
          // durable: settle for stragglers, then archive + hall of fame.
          // awaited on purpose — a serverless function may freeze before an
          // un-awaited fetch to QStash completes.
          await triggerFinalize(code).catch((e) => console.error('triggerFinalize', e));
        }
      } else if (op === 'unscore')
        game = await clearScore(code, { playerId, round: body.round });
      else if (op === 'reset') game = await resetScores(code, { playerId });
      else return send(res, 400, { error: 'unknown_op' });

      if (game && game.error === 'forbidden')
        return send(res, 403, { error: 'forbidden', message: 'Only the host can do that.' });
      if (!game) return send(res, 404, { error: 'not_found' });
      return send(res, 200, game);
    }

    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    console.error('game api error', err);
    return send(res, 500, { error: 'server_error', message: String(err && err.message) });
  }
}
