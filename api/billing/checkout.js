// POST /api/billing/checkout { email? } -> { url }
// Creates a one-time Stripe Checkout Session ("Panda Royale Pro" lifetime
// unlock) and hands back the hosted checkout URL for the client to redirect to.

function send(res, status, body) {
  res.status(status).setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

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

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!secretKey || !priceId) {
    return send(res, 503, {
      error: 'billing_unconfigured',
      message: 'Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID to enable purchases.',
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
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
    console.error('checkout error', err);
    return send(res, 502, { error: 'checkout_failed', message: String(err && err.message) });
  }
}
