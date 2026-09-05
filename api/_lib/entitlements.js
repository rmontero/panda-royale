// Feature flags + Pro entitlements.
//
// Everything here is designed to fail toward "free": if Redis isn't reachable,
// or the flags doc is missing/corrupt, every flag defaults to false and the
// app behaves exactly as it did before the paywall existed.
//
// Keys:
//   config:flags              -> { paywallEnabled, onlinePaywalled, aiPaywalled }
//   pro:<CODE>                -> { email, purchasedAt, stripeCustomerId, stripeSessionId, retiredAt?, accountEmail? }
//   pro:bySession:<sessionId> -> "<CODE>"  (short-lived, lets the success page find its own code)
//   account:<email>           -> { passwordHash, code, createdAt }  (optional login layered on top of a code)
//   session:<token>           -> "<email>"  (90-day TTL)

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { getRedis } from './store.js';

const scrypt = promisify(scryptCb);

const FLAGS_KEY = 'config:flags';
// aiEnabled defaults true (the feature exists unless explicitly turned off) —
// opposite polarity from the paywall flags (which default false/free), since
// this is a "does the feature exist at all" kill-switch, not a paywall gate.
const DEFAULT_FLAGS = { paywallEnabled: false, onlinePaywalled: false, aiPaywalled: false, aiEnabled: true };

export async function getFlags() {
  const redis = getRedis();
  if (!redis) return { ...DEFAULT_FLAGS };
  try {
    const stored = await redis.get(FLAGS_KEY);
    return { ...DEFAULT_FLAGS, ...(stored && typeof stored === 'object' ? stored : {}) };
  } catch {
    return { ...DEFAULT_FLAGS };
  }
}

export async function setFlags(patch) {
  const redis = getRedis();
  if (!redis) return null;
  const current = await getFlags();
  const next = { ...current, ...patch };
  await redis.set(FLAGS_KEY, next);
  return next;
}

const PRO_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1, same family as game codes
const PRO_CODE_LENGTH = 8; // longer than the 4-char game code — this one is permanent, not disposable
const proKey = (code) => `pro:${String(code || '').toUpperCase().trim()}`;
const bySessionKey = (sessionId) => `pro:bySession:${sessionId}`;

export function genProCode() {
  let c = '';
  for (let i = 0; i < PRO_CODE_LENGTH; i++) {
    c += PRO_CODE_ALPHABET[Math.floor(Math.random() * PRO_CODE_ALPHABET.length)];
  }
  return c;
}

// Create a permanent Pro entitlement record for one purchase. Retries on the
// astronomically unlikely code collision.
export async function createEntitlement({ email, stripeCustomerId, stripeSessionId }) {
  const redis = getRedis();
  if (!redis) return null;

  let code = genProCode();
  for (let i = 0; i < 8 && (await redis.exists(proKey(code))); i++) code = genProCode();

  const record = {
    email: String(email || '').slice(0, 200),
    purchasedAt: Date.now(),
    stripeCustomerId: stripeCustomerId || null,
    stripeSessionId: stripeSessionId || null,
  };
  await redis.set(proKey(code), record);
  if (stripeSessionId) {
    await redis.set(bySessionKey(stripeSessionId), code, { ex: 60 * 60 }); // 1h is plenty for the success page
  }
  return { code, ...record };
}

export async function isEntitled(code) {
  if (!code) return false;
  const redis = getRedis();
  if (!redis) return false;
  try {
    return !!(await redis.exists(proKey(code)));
  } catch {
    return false;
  }
}

export async function getEntitlement(code) {
  const redis = getRedis();
  if (!redis || !code) return null;
  const record = await redis.get(proKey(code));
  return record && typeof record === 'object' ? { code: String(code).toUpperCase(), ...record } : null;
}

// Looked up once, right after a successful Stripe Checkout redirect.
export async function getCodeForSession(sessionId) {
  const redis = getRedis();
  if (!redis || !sessionId) return null;
  const code = await redis.get(bySessionKey(sessionId));
  return typeof code === 'string' ? code : null;
}

/* ------------------------------------------------------------------ *
 * Optional email+password login, layered on top of a Pro code.
 * The code-redeem flow above keeps working unchanged for anyone who
 * doesn't want an account — this is purely additive.
 * ------------------------------------------------------------------ */

const accountKey = (email) => `account:${String(email || '').toLowerCase().trim()}`;
const sessionKey = (token) => `session:${token}`;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  return `${salt}:${hash}`;
}

async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const check = (await scrypt(password, salt, 64)).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(check, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Creates an account tied to an already-valid Pro code, and marks that code
// "retired" (kept, not deleted — see api/billing.js's opRedeem for why: no
// password-reset flow exists yet, so the raw code stays a recovery path).
export async function createAccount({ email, code, password }) {
  const redis = getRedis();
  if (!redis) return { error: 'storage_unconfigured' };
  email = String(email || '').toLowerCase().trim();
  if (!email || !password || password.length < 8) return { error: 'invalid_input' };

  const entitlement = await getEntitlement(code);
  if (!entitlement) return { error: 'invalid_code' };
  if (await redis.exists(accountKey(email))) return { error: 'email_taken' };

  const passwordHash = await hashPassword(password);
  await redis.set(accountKey(email), { passwordHash, code: entitlement.code, createdAt: Date.now() });
  await redis.set(proKey(entitlement.code), { ...entitlement, retiredAt: Date.now(), accountEmail: email });
  return { email, code: entitlement.code };
}

export async function verifyAccountPassword(email, password) {
  const redis = getRedis();
  if (!redis) return null;
  email = String(email || '').toLowerCase().trim();
  const record = await redis.get(accountKey(email));
  if (!record || typeof record !== 'object') return null;
  const ok = await verifyPassword(password, record.passwordHash);
  return ok ? { email, code: record.code } : null;
}

export async function createSession(email) {
  const redis = getRedis();
  if (!redis) return null;
  const token = randomBytes(32).toString('hex');
  await redis.set(sessionKey(token), email, { ex: SESSION_TTL_SECONDS });
  return token;
}

export async function getSessionAccount(token) {
  const redis = getRedis();
  if (!redis || !token) return null;
  const email = await redis.get(sessionKey(token));
  if (typeof email !== 'string') return null;
  const record = await redis.get(accountKey(email));
  if (!record || typeof record !== 'object') return null;
  return { email, code: record.code };
}

export async function deleteSession(token) {
  const redis = getRedis();
  if (!redis || !token) return;
  await redis.del(sessionKey(token));
}
