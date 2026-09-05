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
//
//   -- optional email+password login, layered on top of a redeemed code --
//   POST /api/billing { op: "register", email, code, password } -> { ok, code, email } + session cookie
//   POST /api/billing { op: "login", email, password }           -> { ok, code, email } + session cookie
//   POST /api/billing { op: "logout" }                            -> { ok } (clears session cookie)
//   GET  /api/billing?op=me                                       -> { loggedIn, code?, email? }
//
// The product ("Panda Score Keeper Pro", $10 one-time) is defined inline in
// opCheckout via price_data — see PRODUCT_* below — not a dashboard-created
// Stripe Price, so STRIPE_PRICE_ID is no longer used/required.

import {
  getCodeForSession,
  getEntitlement,
  createAccount,
  verifyAccountPassword,
  createSession,
  getSessionAccount,
  deleteSession,
} from './_lib/entitlements.js';

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

const SESSION_COOKIE = 'pr_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 90; // 90 days, matches createSession's Redis TTL

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// HttpOnly: the client never reads this cookie directly — it learns whether
// it's logged in via GET ?op=me, which is the point (a token client JS can't
// read can't be stolen by an XSS bug either).
function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

function appBaseUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || 'localhost:3000';
  return `https://${host}`;
}

// The one and only thing for sale: a single $10 one-time unlock. Defined
// inline (price_data) rather than a dashboard-created Stripe Price so there's
// nothing to pre-configure beyond STRIPE_SECRET_KEY — the name, amount, and
// disclaimer all live here in code.
const PRODUCT_NAME = 'Panda Score Keeper Pro';
const PRODUCT_DESCRIPTION =
  'One-time unlock for online multiplayer and photo scanning. No guarantees, ' +
  'no backsies, no support — this fee just supports development of the ' +
  "game's advanced features; the basic version remains fully functional for " +
  'free. Software projects have a natural life cycle and this one may be ' +
  'discontinued without prior notice — this fee is not a lifetime commitment ' +
  'or an uptime warranty.';
const PRODUCT_AMOUNT_CENTS = 1000; // $10.00
const PRODUCT_CURRENCY = 'usd';

async function opCheckout(req, res) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return send(res, 503, { error: 'billing_unconfigured', message: 'Set STRIPE_SECRET_KEY to enable purchases.' });
  }
  try {
    const body = readBody(req);
    const email = typeof body.email === 'string' ? body.email.trim().slice(0, 200) : undefined;
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(secretKey);
    const base = appBaseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: PRODUCT_CURRENCY,
            unit_amount: PRODUCT_AMOUNT_CENTS,
            product_data: { name: PRODUCT_NAME, description: PRODUCT_DESCRIPTION },
          },
          quantity: 1,
        },
      ],
      // Gives the buyer a real Stripe-generated invoice/receipt for this
      // one-time payment, same as they'd get from a formal invoice.
      invoice_creation: {
        enabled: true,
        invoice_data: { description: PRODUCT_DESCRIPTION, footer: PRODUCT_DESCRIPTION },
      },
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
    if (entitlement.retiredAt) {
      return send(res, 409, { ok: false, error: 'retired', message: 'This code is now tied to an account — log in instead.' });
    }
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

async function opRegister(req, res) {
  const { storageConfigured } = await import('./_lib/store.js');
  if (!storageConfigured()) return send(res, 503, { error: 'storage_unconfigured' });
  try {
    const body = readBody(req);
    const result = await createAccount({ email: body.email, code: body.code, password: body.password });
    if (result.error) return send(res, 400, { ok: false, error: result.error });
    const token = await createSession(result.email);
    if (token) setSessionCookie(res, token);
    return send(res, 200, { ok: true, code: result.code, email: result.email });
  } catch (err) {
    console.error('billing register error', err);
    return send(res, 500, { error: 'server_error' });
  }
}

async function opLogin(req, res) {
  const { storageConfigured } = await import('./_lib/store.js');
  if (!storageConfigured()) return send(res, 503, { error: 'storage_unconfigured' });
  try {
    const body = readBody(req);
    const account = await verifyAccountPassword(body.email, body.password);
    if (!account) return send(res, 401, { ok: false, error: 'invalid_credentials' });
    const token = await createSession(account.email);
    if (token) setSessionCookie(res, token);
    return send(res, 200, { ok: true, code: account.code, email: account.email });
  } catch (err) {
    console.error('billing login error', err);
    return send(res, 500, { error: 'server_error' });
  }
}

async function opLogout(req, res) {
  try {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) await deleteSession(token);
  } catch (err) {
    console.error('billing logout error', err);
  }
  clearSessionCookie(res);
  return send(res, 200, { ok: true });
}

async function opMe(req, res) {
  try {
    const token = parseCookies(req)[SESSION_COOKIE];
    const account = token ? await getSessionAccount(token) : null;
    if (!account) return send(res, 200, { loggedIn: false });
    return send(res, 200, { loggedIn: true, code: account.code, email: account.email });
  } catch (err) {
    console.error('billing me error', err);
    return send(res, 200, { loggedIn: false });
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const op = String(req.query.op || 'session');
    if (op === 'session') return opSession(req, res);
    if (op === 'me') return opMe(req, res);
    return send(res, 400, { error: 'unknown_op' });
  }
  if (req.method === 'POST') {
    const op = String(readBody(req).op || '');
    if (op === 'checkout') return opCheckout(req, res);
    if (op === 'redeem') return opRedeem(req, res);
    if (op === 'register') return opRegister(req, res);
    if (op === 'login') return opLogin(req, res);
    if (op === 'logout') return opLogout(req, res);
    return send(res, 400, { error: 'unknown_op' });
  }
  res.setHeader('Allow', 'GET, POST');
  return send(res, 405, { error: 'method_not_allowed' });
}
