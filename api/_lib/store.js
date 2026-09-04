// Shared game store, backed by Upstash Redis (Vercel KV / Upstash integration).
//
// One Redis hash per game, key `pr:<CODE>`, with fields:
//   meta               -> { code, createdAt, hostId, rounds }
//   player:<id>        -> { id, name, joinedAt }
//   r<n>:<id>          -> { total, breakdown, dice, submittedAt }
//
// Per-field writes mean concurrent players never clobber each other.

import { Redis } from '@upstash/redis';
import { scoreRound, sanitizeDice } from '../../lib/score.js';

const TTL_SECONDS = 60 * 60 * 24; // games evaporate a day after their last write
export const TOTAL_ROUNDS = 10;

let client;

export function getRedis() {
  if (client) return client;
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.REDIS_REST_API_URL;
  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.REDIS_REST_API_TOKEN;
  if (!url || !token) return null;
  client = new Redis({ url, token });
  return client;
}

export function storageConfigured() {
  return !!getRedis();
}

const key = (code) => `pr:${String(code).toUpperCase()}`;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
function genCode() {
  let c = '';
  for (let i = 0; i < 4; i++) {
    c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return c;
}

function cleanName(name) {
  return (String(name || '').trim() || 'Player').slice(0, 24);
}

function asObject(v) {
  if (v && typeof v === 'object') return v;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return null;
}

function shapeGame(code, hash) {
  if (!hash) return null;
  const meta = asObject(hash.meta);
  if (!meta) return null;

  const players = [];
  const rounds = {};
  for (const [field, raw] of Object.entries(hash)) {
    if (field === 'meta') continue;
    const val = asObject(raw);
    if (!val) continue;
    if (field.startsWith('player:')) {
      players.push(val);
    } else {
      const m = field.match(/^r(\d+):(.+)$/);
      if (m) {
        const rn = Number(m[1]);
        (rounds[rn] = rounds[rn] || {})[m[2]] = val;
      }
    }
  }
  players.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));

  return {
    code: meta.code || String(code).toUpperCase(),
    hostId: meta.hostId || null,
    rounds: meta.rounds || TOTAL_ROUNDS,
    createdAt: meta.createdAt || null,
    players,
    scores: rounds,
    updatedAt: Date.now(),
  };
}

export async function loadGame(code) {
  const redis = getRedis();
  if (!redis) return null;
  const hash = await redis.hgetall(key(code));
  return shapeGame(code, hash);
}

async function touch(code) {
  const redis = getRedis();
  await redis.expire(key(code), TTL_SECONDS);
}

export async function createGame({ hostId, name }) {
  const redis = getRedis();
  if (!redis || !hostId) return null;

  let code = genCode();
  for (let i = 0; i < 8 && (await redis.exists(key(code))); i++) code = genCode();

  const now = Date.now();
  const meta = { code, createdAt: now, hostId, rounds: TOTAL_ROUNDS };
  const player = { id: hostId, name: cleanName(name), joinedAt: now };
  await redis.hset(key(code), { meta, [`player:${hostId}`]: player });
  await touch(code);
  return loadGame(code);
}

export async function joinGame(code, { playerId, name }) {
  const redis = getRedis();
  if (!redis || !playerId) return null;
  if (!(await redis.exists(key(code)))) return null;

  const existing = asObject(await redis.hget(key(code), `player:${playerId}`));
  const player = {
    id: playerId,
    name: cleanName(name),
    joinedAt: (existing && existing.joinedAt) || Date.now(),
  };
  await redis.hset(key(code), { [`player:${playerId}`]: player });
  await touch(code);
  return loadGame(code);
}

export async function leaveGame(code, { playerId }) {
  const redis = getRedis();
  if (!redis || !playerId) return null;
  if (!(await redis.exists(key(code)))) return null;

  const fields = (await redis.hkeys(key(code))).filter(
    (f) => f === `player:${playerId}` || new RegExp(`^r\\d+:${playerId}$`).test(f)
  );
  if (fields.length) await redis.hdel(key(code), ...fields);
  return loadGame(code);
}

export async function submitScore(code, { playerId, round, dice }) {
  const redis = getRedis();
  if (!redis || !playerId) return null;
  if (!(await redis.exists(key(code)))) return null;

  const r = Math.max(1, Math.min(TOTAL_ROUNDS, parseInt(round, 10) || 1));
  let clean = sanitizeDice(dice);
  if (r === 1) {
    // round 1: every player rolls only their single starting yellow die
    const y = clean.find((d) => d.color === 'yellow');
    clean = y ? [{ color: 'yellow', value: y.value }] : [];
  }
  const scored = scoreRound(clean);
  const entry = {
    total: scored.total,
    breakdown: scored.breakdown,
    dice: clean,
    submittedAt: Date.now(),
  };
  await redis.hset(key(code), { [`r${r}:${playerId}`]: entry });
  await touch(code);
  return loadGame(code);
}

export async function clearScore(code, { playerId, round }) {
  const redis = getRedis();
  if (!redis || !playerId) return null;
  if (!(await redis.exists(key(code)))) return null;
  const r = Math.max(1, Math.min(TOTAL_ROUNDS, parseInt(round, 10) || 1));
  await redis.hdel(key(code), `r${r}:${playerId}`);
  await touch(code);
  return loadGame(code);
}

export async function resetScores(code, { playerId }) {
  const redis = getRedis();
  if (!redis) return null;
  const game = await loadGame(code);
  if (!game) return null;
  if (game.hostId && game.hostId !== playerId) return { error: 'forbidden' };

  const roundFields = (await redis.hkeys(key(code))).filter((f) => /^r\d+:/.test(f));
  if (roundFields.length) await redis.hdel(key(code), ...roundFields);
  await redis.hdel(key(code), 'finished').catch(() => {});
  await redis.del(finalLockKey(code)).catch(() => {});
  await touch(code);
  return loadGame(code);
}

/* ------------------------------------------------------------------ *
 * end-of-game archival + hall of fame
 *
 * When round 10 is submitted, api/game.js triggers the Upstash Workflow
 * at /api/workflows/finalize, which (after a 45s settle) calls
 * finalizeGame(). QStash's daily schedule hits /api/tasks/sweep, which
 * calls trimHallOfFame(). Everything here degrades to a no-op if Redis
 * is not configured.
 * ------------------------------------------------------------------ */

const ARCHIVE_TTL_SECONDS = 60 * 60 * 24 * 30; // keep finished games a month
const HOF_KEY = 'pr:hof'; // sorted set: member "Name @CODE ·Rn" -> best single-round score
const archiveKey = (code) => `pr:archive:${String(code).toUpperCase()}`;
const finalLockKey = (code) => `pr:final:${String(code).toUpperCase()}`;

export function computeStandings(game) {
  return (game.players || [])
    .map((p) => {
      let total = 0;
      let bestRound = { round: 0, total: 0 };
      const perRound = [];
      for (let r = 1; r <= TOTAL_ROUNDS; r++) {
        const e = game.scores[r] && game.scores[r][p.id];
        const v = e ? e.total : null;
        perRound.push(v);
        if (e) {
          total += e.total;
          if (e.total > bestRound.total) bestRound = { round: r, total: e.total };
        }
      }
      return { id: p.id, name: p.name, total, perRound, bestRound };
    })
    .sort((a, b) => b.total - a.total);
}

// Returns true if it performed the finalization, false if skipped (already done / missing).
export async function finalizeGame(code) {
  const redis = getRedis();
  if (!redis) return false;

  // idempotency lock — first caller wins, others no-op
  const gotLock = await redis.set(finalLockKey(code), Date.now(), {
    nx: true,
    ex: ARCHIVE_TTL_SECONDS,
  });
  if (!gotLock) return false;

  const game = await loadGame(code);
  if (!game) {
    await redis.del(finalLockKey(code));
    return false;
  }

  const standings = computeStandings(game);
  const finishedAt = Date.now();

  await redis.set(
    archiveKey(code),
    { code: game.code, finishedAt, standings },
    { ex: ARCHIVE_TTL_SECONDS }
  );
  await redis.hset(key(code), { finished: { at: finishedAt } });
  await touch(code);

  // hall of fame — every player's best single round for this game
  const entries = standings
    .filter((s) => s.bestRound.round > 0)
    .map((s) => ({
      score: s.bestRound.total,
      member: `${s.name} @${game.code} ·R${s.bestRound.round}`,
    }));
  if (entries.length) {
    await redis.zadd(HOF_KEY, ...entries);
    await trimHallOfFame();
  }

  return true;
}

export async function getHallOfFame(limit = 8) {
  const redis = getRedis();
  if (!redis) return [];
  const rows = await redis.zrange(HOF_KEY, 0, Math.max(0, limit - 1), {
    rev: true,
    withScores: true,
  });
  const out = [];
  for (let i = 0; i < rows.length; i += 2) {
    out.push({ label: String(rows[i]), score: Number(rows[i + 1]) });
  }
  return out;
}

export async function trimHallOfFame(keep = 25) {
  const redis = getRedis();
  if (!redis) return 0;
  // drop everything below the top `keep` (ascending ranks 0 .. -keep-1)
  return redis.zremrangebyrank(HOF_KEY, 0, -keep - 1);
}
