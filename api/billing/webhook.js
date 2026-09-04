// POST /api/billing/webhook — Stripe webhook receiver.
// Web-standard handler (raw, unparsed Request) so the signature can be
// verified against the exact bytes Stripe sent, the same reason
// api/tasks/sweep.js uses this shape for QStash signatures.
//
// On checkout.session.completed: mint a permanent Pro code, record it, and
// best-effort email it. A failed email must never fail the webhook — the
// purchase and the code already exist in Redis either way, and the buyer can
// always see the code on the success page or use "resend" later.

import { createEntitlement } from '../_lib/entitlements.js';

async function sendProCodeEmail({ email, code }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !email) return;
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: process.env.RESEND_FROM || 'Panda Royale Scorekeeper <noreply@pnd.ad>',
      to: email,
      subject: 'Your Panda Royale Pro code',
      text: `Thanks for upgrading!\n\nYour Pro code: ${code}\n\nEnter it on any device at https://pnd.ad to unlock online multiplayer and photo scoring — no account or password needed, just this code.`,
    });
  } catch (err) {
    console.error('pro code email failed (purchase is still valid)', err);
  }
}

export async function POST(request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
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
    console.error('stripe webhook signature verification failed', err.message);
    return new Response(JSON.stringify({ error: 'bad_signature' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.payment_status === 'paid') {
        const entitlement = await createEntitlement({
          email: session.customer_details?.email || session.customer_email,
          stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
          stripeSessionId: session.id,
        });
        if (entitlement) await sendProCodeEmail({ email: entitlement.email, code: entitlement.code });
      }
    }
  } catch (err) {
    // Stripe retries on non-2xx, which would re-run this for an already-paid
    // session. Log and still acknowledge — the alternative is duplicate codes.
    console.error('stripe webhook handling error', err);
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
