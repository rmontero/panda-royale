// Panda Royale Pro paywall — consolidated into one function (Vercel Hobby
// plan caps a deployment at 12 Serverless Functions; this used to be three
// separate files under api/billing/*). Dispatches on `op`, same pattern as
// api/game.js. api/billing/webhook.js stays its own file — it needs the raw,
// unparsed request body for Stripe signature verification, which doesn't mix
// with the JSON body parsing used here.
//
//   POST /api/billing { op: "checkout", email? }        -> { url }
//   POST /api/billing { op: "redeem", code }             -> { ok, email }
//   GET  /api/billing?op=session&session_id=cs_...       -> { code, email } | { pending: true } | 404

import { getCodeForSession, getEntitlement } from './_lib/entitlements.js';

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

function appBaseUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || 'localhost:3000';
  return `https://${host}`;
}

async function opCheckout(req, res) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!secretKey || !priceId) {
    return send(res, 503, { error: 'billing_unconfigured', message: 'Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID to enable purchases.' });
  }
  try {
    const body = readBody(req);
    const email = typeof body.email === 'string' ? body.email.trim().slice(0, 200) : undefined;
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(secretKey);
    const base = appBaseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${base}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/`,
      customer_email: email || undefined,
      allow_promotion_codes: true,
    });
    return send(res, 200, { url: session.url });
  } catch (err) {
    console.error('billing checkout error', err);
    return send(res, 502, { error: 'checkout_failed', message: String(err && err.message) });
  }
}

async function opRedeem(req, res) {
  const { storageConfigured } = await import('./_lib/store.js');
  if (!storageConfigured()) {
    return send(res, 503, { error: 'storage_unconfigured' });
  }
  try {
    const body = readBody(req);
    const code = String(body.code || '').trim();
    if (!code) return send(res, 400, { error: 'missing_code' });
    const entitlement = await getEntitlement(code);
    if (!entitlement) return send(res, 404, { ok: false, error: 'not_found' });
    return send(res, 200, { ok: true, email: entitlement.email || null });
  } catch (err) {
    console.error('billing redeem error', err);
    return send(res, 500, { error: 'server_error' });
  }
}

async function opSession(req, res) {
  const sessionId = String(req.query.session_id || '');
  if (!sessionId) return send(res, 400, { error: 'missing_session_id' });
  try {
    const code = await getCodeForSession(sessionId);
    if (!code) {
      // Common right after checkout: the webhook hasn't landed yet. The client
      // retries briefly before giving up and falling back to "check your email".
      return send(res, 202, { pending: true });
    }
    const entitlement = await getEntitlement(code);
    return send(res, 200, { code, email: entitlement && entitlement.email });
  } catch (err) {
    console.error('billing session lookup error', err);
    return send(res, 500, { error: 'server_error' });
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const op = String(req.query.op || 'session');
    if (op === 'session') return opSession(req, res);
    return send(res, 400, { error: 'unknown_op' });
  }
  if (req.method === 'POST') {
    const op = String(readBody(req).op || '');
    if (op === 'checkout') return opCheckout(req, res);
    if (op === 'redeem') return opRedeem(req, res);
    return send(res, 400, { error: 'unknown_op' });
  }
  res.setHeader('Allow', 'GET, POST');
  return send(res, 405, { error: 'method_not_allowed' });
}
