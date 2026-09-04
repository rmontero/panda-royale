// POST /api/talacha/webhook — Stripe webhook for Talacha's own billing.
// Deliberately a separate endpoint + separate signing secret from the Panda
// Royale Pro webhook (api/billing/webhook.js) so the two revenue lines never
// cross wires. Web-standard handler (raw, unparsed Request) so the signature
// verifies against the exact bytes Stripe sent.
//
// Env: TALACHA_STRIPE_SECRET_KEY, TALACHA_STRIPE_WEBHOOK_SECRET.
// Optional: keeps a lightweight paid-invoice / paid-checkout log in Redis
// under the `talacha:` prefix (distinct from the game's `pr:`/`pro:` keys)
// so you have a record even without opening the Stripe Dashboard.

import { getRedis } from '../_lib/store.js';

async function logPayment(kind, record) {
  const redis = getRedis();
  if (!redis) return; // optional — a missing Redis never breaks the webhook
  try {
    await redis.lpush('talacha:payments', { kind, at: Date.now(), ...record });
    await redis.ltrim('talacha:payments', 0, 499); // keep the most recent 500
  } catch (err) {
    console.error('talacha payment log failed (payment itself is still valid)', err);
  }
}

export async function POST(request) {
  const secret = process.env.TALACHA_STRIPE_WEBHOOK_SECRET;
  const stripeKey = process.env.TALACHA_STRIPE_SECRET_KEY;
  if (!secret || !stripeKey) {
    return new Response(JSON.stringify({ error: 'billing_unconfigured' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }

  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  let event;
  try {
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(stripeKey);
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    console.error('talacha webhook signature verification failed', err.message);
    return new Response(JSON.stringify({ error: 'bad_signature' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    const obj = event.data.object;
    if (event.type === 'invoice.paid') {
      await logPayment('invoice_paid', {
        invoiceId: obj.id,
        customerEmail: obj.customer_email,
        amount: obj.amount_paid,
        currency: obj.currency,
      });
    } else if (event.type === 'invoice.payment_failed') {
      await logPayment('invoice_payment_failed', { invoiceId: obj.id, customerEmail: obj.customer_email });
    } else if (event.type === 'checkout.session.completed' && obj.payment_status === 'paid') {
      await logPayment('checkout_paid', {
        sessionId: obj.id,
        customerEmail: obj.customer_details?.email,
        amount: obj.amount_total,
        currency: obj.currency,
      });
    }
  } catch (err) {
    console.error('talacha webhook handling error', err);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

export function GET() {
  return new Response(JSON.stringify({ ok: true, hint: 'POST from Stripe only' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
