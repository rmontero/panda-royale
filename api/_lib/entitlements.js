// Feature flags + Pro entitlements.
//
// Everything here is designed to fail toward "free": if Redis isn't reachable,
// or the flags doc is missing/corrupt, every flag defaults to false and the
// app behaves exactly as it did before the paywall existed.
//
// Keys:
//   config:flags              -> { paywallEnabled, onlinePaywalled, aiPaywalled }
//   pro:<CODE>                -> { email, purchasedAt, stripeCustomerId, stripeSessionId }
//   pro:bySession:<sessionId> -> "<CODE>"  (short-lived, lets the success page find its own code)

import { getRedis } from './store.js';

const FLAGS_KEY = 'config:flags';
const DEFAULT_FLAGS = { paywallEnabled: false, onlinePaywalled: false, aiPaywalled: false };

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
