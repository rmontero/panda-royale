// POST /api/talacha/checkout
//   { email?, description, amount, currency? }   // amount in major units, e.g. 500 = $500.00
// -> { url }
//
// A hosted Stripe Checkout page for a one-off charge that doesn't need a
// formal Invoice — a deposit, a quick fixed-fee engagement, etc. Card data
// never touches this server (Stripe hosts the whole payment page), and tax
// is calculated automatically the same way as on invoices.

import { getStripe, getStripeConfigured, SERVICES_TAX_CODE, send, readBody } from './_lib/stripe.js';

function appBaseUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || 'localhost:3000';
  return `https://${host}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }
  if (!getStripeConfigured()) {
    return send(res, 503, { error: 'billing_unconfigured', message: 'Set TALACHA_STRIPE_SECRET_KEY.' });
  }

  try {
    const body = readBody(req);
    const description = String(body.description || '').trim();
    const amount = Math.round(Number(body.amount) * 100);
    const currency = String(body.currency || 'usd').toLowerCase();
    if (!description) return send(res, 400, { error: 'missing_description' });
    if (!Number.isFinite(amount) || amount <= 0) return send(res, 400, { error: 'bad_amount' });

    const stripe = await getStripe();
    const base = appBaseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency,
            unit_amount: amount,
            product_data: { name: description, tax_code: SERVICES_TAX_CODE },
          },
          quantity: 1,
        },
      ],
      automatic_tax: { enabled: true },
      customer_email: body.email || undefined,
      success_url: `${base}/talacha-thanks.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: base,
    });

    return send(res, 200, { url: session.url });
  } catch (err) {
    console.error('talacha checkout error', err);
    return send(res, 502, { error: 'stripe_error', message: String(err && err.message) });
  }
}
