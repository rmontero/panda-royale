// Shared Stripe client + helpers for Talacha's own client billing
// (invoicing + one-off payments for software engineering services).
//
// Deliberately namespaced and keyed separately from the Panda Royale Pro
// paywall's Stripe integration (api/billing/*, STRIPE_* env vars) — these are
// two unrelated revenue lines (consulting clients vs. game players) and must
// never share a webhook endpoint or a secret: a Talacha invoice payment must
// not be mistaken for a Panda Royale Pro purchase, or vice versa.
//
// Env vars: TALACHA_STRIPE_SECRET_KEY, TALACHA_STRIPE_WEBHOOK_SECRET.

let client;

export function getStripeConfigured() {
  return !!process.env.TALACHA_STRIPE_SECRET_KEY;
}

export async function getStripe() {
  const key = process.env.TALACHA_STRIPE_SECRET_KEY;
  if (!key) return null;
  if (client) return client;
  const { default: Stripe } = await import('stripe');
  client = new Stripe(key);
  return client;
}

// "General - Services" — the generic Stripe Tax code for professional /
// consulting services. Swap for a more specific code (see
// https://docs.stripe.com/tax/tax-categories) if a jurisdiction needs it,
// e.g. a distinct code for packaged software licenses vs. custom dev work.
export const SERVICES_TAX_CODE = 'txcd_10000000';

export async function ensureCustomer(stripe, { email, name }) {
  if (!email) throw new Error('email is required');
  const existing = await stripe.customers.list({ email, limit: 1 });
  if (existing.data.length) return existing.data[0];
  return stripe.customers.create({ email, name: name || undefined });
}

export function send(res, status, body) {
  res.status(status).setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export function readBody(req) {
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
