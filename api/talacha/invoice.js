// POST /api/talacha/invoice
//   { email, name?, address?, description?, currency?, dueInDays?,
//     items: [{ description, amount }] }   // amount in major units, e.g. 1500 = $1,500.00
// -> { id, status, hosted_invoice_url, invoice_pdf }
//
// Creates (or reuses) the client as a Stripe Customer, adds one invoice item
// per line item, finalizes and sends the invoice. Stripe hosts the payment
// page — there's no checkout UI to build for this path. Tax is calculated
// automatically (Stripe Tax must be turned on for the account in the
// Dashboard first; see README).

import { getStripe, getStripeConfigured, ensureCustomer, SERVICES_TAX_CODE, send, readBody } from './_lib/stripe.js';

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
