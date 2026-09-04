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

function send(res, status, body) {
  res.status(status).setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      return {};
    }
  }
  return req.body;
}

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
