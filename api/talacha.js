// Talacha client billing — consolidated into one function (Vercel Hobby plan
// caps a deployment at 12 Serverless Functions; this used to be three
// separate files under api/talacha/*). Dispatches on `op`, same pattern as
// api/game.js / api/billing.js. api/talacha/webhook.js stays its own file —
// it needs the raw, unparsed request body for Stripe signature verification.
//
// Unrelated to the Panda Royale Pro paywall (api/billing.js, STRIPE_* env
// vars) — this is Talacha's own client billing (software engineering
// services). Different env var prefix, different Stripe customers, different
// money. See api/talacha/_lib/stripe.js and api/talacha/README.md.
//
//   POST /api/talacha { op: "invoice", email, name?, address?, description?,
//                        currency?, dueInDays?, items: [{description, amount}] }
//     -> { id, status, hosted_invoice_url, invoice_pdf }
//   POST /api/talacha { op: "checkout", email?, description, amount, currency? }
//     -> { url }
//   GET  /api/talacha?op=payments  (header: x-admin-token)
//     -> { payments: [...] }

import { getStripe, getStripeConfigured, ensureCustomer, SERVICES_TAX_CODE, send, readBody } from './talacha/_lib/stripe.js';
import { getRedis } from './_lib/store.js';

function appBaseUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || 'localhost:3000';
  return `https://${host}`;
}

async function opInvoice(req, res) {
  if (!getStripeConfigured()) {
    return send(res, 503, { error: 'billing_unconfigured', message: 'Set TALACHA_STRIPE_SECRET_KEY.' });
  }
  try {
    const body = readBody(req);
    const email = String(body.email || '').trim();
    const items = Array.isArray(body.items) ? body.items : [];
    if (!email) return send(res, 400, { error: 'missing_email' });
    if (!items.length) return send(res, 400, { error: 'missing_items', message: 'At least one line item is required.' });

    const currency = String(body.currency || 'usd').toLowerCase();
    const cleanItems = items.map((item) => ({
      description: item.description,
      amount: Math.round(Number(item.amount) * 100),
    }));
    const badItem = cleanItems.find((i) => !i.description || !Number.isFinite(i.amount) || i.amount <= 0);
    if (badItem) {
      return send(res, 400, { error: 'bad_item', message: 'Each item needs a description and a positive amount.' });
    }

    const stripe = await getStripe();
    const customer = await ensureCustomer(stripe, { email, name: body.name });

    if (body.address) {
      // A customer address is what lets Stripe Tax determine the right rate.
      await stripe.customers.update(customer.id, { address: body.address });
    }

    // Create the (draft) invoice FIRST, then attach each line item to it by
    // id. Stripe does NOT auto-collect a customer's other pending invoice
    // items onto a newly created invoice — passing `invoice:` explicitly is
    // what actually puts money on this invoice; skipping it silently
    // produces a valid-looking $0 invoice.
    const draft = await stripe.invoices.create({
      customer: customer.id,
      currency, // must match the invoice items' currency, or Stripe rejects the invoice —
                // it otherwise defaults to the account's own default currency
      collection_method: 'send_invoice',
      days_until_due: Number(body.dueInDays) > 0 ? Number(body.dueInDays) : 14,
      description: body.description || undefined,
      automatic_tax: { enabled: true },
    });

    for (const item of cleanItems) {
      await stripe.invoiceItems.create({
        customer: customer.id,
        invoice: draft.id,
        currency,
        amount: item.amount,
        description: item.description,
        tax_code: SERVICES_TAX_CODE,
      });
    }

    const finalized = await stripe.invoices.finalizeInvoice(draft.id);

    // The invoice is already valid and payable at this point (it has a
    // hosted_invoice_url) regardless of whether Stripe's own email notice
    // goes out — e.g. a brand-new account without its business profile /
    // invoice sender details filled in (Settings -> Business, Settings ->
    // Invoicing) can finalize invoices before it's allowed to email them.
    // Don't let that email step turn an otherwise-successful invoice into
    // an error; surface it as a warning instead.
    let emailWarning = null;
    try {
      await stripe.invoices.sendInvoice(finalized.id);
    } catch (err) {
      console.error('talacha invoice: sendInvoice failed (invoice itself is valid)', err.message);
      emailWarning = 'Invoice created, but Stripe could not email it automatically — share the link below yourself. ' +
        '(Usually fixed by completing Settings -> Business and Settings -> Invoicing -> Emails in the Stripe Dashboard.)';
    }

    return send(res, 200, {
      id: finalized.id,
      status: finalized.status,
      hosted_invoice_url: finalized.hosted_invoice_url,
      invoice_pdf: finalized.invoice_pdf,
      customer: customer.id,
      emailWarning,
    });
  } catch (err) {
    console.error('talacha invoice error', err);
    return send(res, 502, { error: 'stripe_error', message: String(err && err.message) });
  }
}

async function opCheckout(req, res) {
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

async function opPayments(req, res) {
  const expected = process.env.TALACHA_ADMIN_TOKEN;
  const given = req.headers['x-admin-token'];
  if (!expected || given !== expected) {
    return send(res, 401, { error: 'unauthorized' });
  }

  const redis = getRedis();
  if (!redis) return send(res, 200, { payments: [] });

  try {
    const payments = await redis.lrange('talacha:payments', 0, 99);
    return send(res, 200, { payments });
  } catch (err) {
    console.error('talacha payments read error', err);
    return send(res, 500, { error: 'server_error' });
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const op = String(req.query.op || '');
    if (op === 'payments') return opPayments(req, res);
    return send(res, 400, { error: 'unknown_op' });
  }
  if (req.method === 'POST') {
    const op = String(readBody(req).op || '');
    if (op === 'invoice') return opInvoice(req, res);
    if (op === 'checkout') return opCheckout(req, res);
    return send(res, 400, { error: 'unknown_op' });
  }
  res.setHeader('Allow', 'GET, POST');
  return send(res, 405, { error: 'method_not_allowed' });
}
