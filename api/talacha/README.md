# Talacha client billing

Stripe integration for **Talacha's own client billing** (software engineering
services) — invoicing and one-off payments for consulting clients. This is
unrelated to the Panda Royale Pro paywall (`api/billing/*`) that lives
elsewhere in this repo: different Stripe usage, different customers,
different money. Kept deliberately separate — see the top of
[`_lib/stripe.js`](_lib/stripe.js).

## What's here

| Route | Purpose |
|---|---|
| `POST /api/talacha/invoice` | Create/reuse a Customer, add line items, finalize + send a Stripe Invoice (Stripe hosts the payment page). |
| `POST /api/talacha/checkout` | A hosted Checkout Session for a one-off charge — a deposit, a fixed-fee project — without a formal invoice. |
| `POST /api/talacha/webhook` | Stripe webhook (own signing secret). Logs `invoice.paid`, `invoice.payment_failed`, `checkout.session.completed` to Redis (`talacha:payments`, best-effort — a missing Redis never breaks a webhook). |
| `GET /api/talacha/payments` | Read the payment log. Gated by an `x-admin-token` header — locked by default. |

Both `invoice` and `checkout` pass `automatic_tax: { enabled: true }` and tag
line items with the generic "General - Services" tax code
(`txcd_10000000` — see [Stripe's tax category list](https://docs.stripe.com/tax/tax-categories)
if a more specific one fits, e.g. packaged software vs. custom dev work).

## Required setup (Stripe Dashboard — can't be done via API)

1. **Enable Stripe Tax**: Dashboard → **Tax** → set your origin address and turn
   it on, plus register in whichever states/countries you're required to collect
   in. Without this, `automatic_tax` won't error, but it also won't add any tax —
   it silently calculates $0 until Tax is actually configured.
2. **Complete your Business profile**: Dashboard → **Settings → Business** (legal
   name, address, support contact) and **Settings → Invoicing → Emails**. A
   brand-new/incomplete account can finalize invoices but Stripe will refuse to
   email them ("This invoice cannot be sent right now") until this is filled in —
   the API still returns the invoice's `hosted_invoice_url` in that case
   (`emailWarning` in the response tells you to share the link yourself
   meanwhile).
3. **Register the webhook**: Dashboard → **Developers → Webhooks** → add endpoint
   `https://pnd.ad/api/talacha/webhook`, subscribe to `invoice.paid`,
   `invoice.payment_failed`, `checkout.session.completed`. Copy the signing
   secret into `TALACHA_STRIPE_WEBHOOK_SECRET`.

## Env vars

| Var | Required for |
|---|---|
| `TALACHA_STRIPE_SECRET_KEY` | Everything — without it, `invoice`/`checkout` return `503 billing_unconfigured`. |
| `TALACHA_STRIPE_WEBHOOK_SECRET` | The webhook to accept events — without it, it also 503s (fails closed, never accepts an unsigned request). |
| `TALACHA_STRIPE_PUBLISHABLE_KEY` | Only needed if you later build a client-side Elements form; unused by the current server-only flows. |
| `TALACHA_ADMIN_TOKEN` | Reading `/api/talacha/payments`. Pick any random string; without it the endpoint stays locked. |

## CLI usage

```bash
npm run talacha:invoice -- --email=client@co.com --name="Client Co" \
  --item="Sprint 1 — API integration:5000" --item="Sprint 2 — dashboard:3500" \
  --due=14 --base=https://pnd.ad

npm run talacha:checkout -- --desc="50% deposit — Q1 engagement" --amount=2500 \
  --email=client@co.com --base=https://pnd.ad
```

`--base` defaults to `http://localhost:3000` for testing against `vercel dev`.
Invoice `--item` values are `"description:amount"` (amount in major units,
e.g. `5000` = $5,000.00).

## A note on testing this yourself

Stripe's Invoice API does **not** auto-attach a customer's pending invoice
items to a newly created invoice — `invoiceItems.create` needs an explicit
`invoice: <draft id>`, which means the invoice has to be created *before* its
line items, not after (the reverse of what you'd naively expect). Get this
order backwards and you'll get a valid-looking, successfully "paid" invoice
for **$0** with zero line items — nothing errors, it just silently invoices
for nothing. `invoice.js` does it in the right order; if you ever refactor
it, re-verify with `stripe.invoices.retrieve(id, { expand: ['lines'] })`
rather than trusting a 200 response alone.

Also pass `currency` on `invoices.create` itself, not just on the invoice
items — otherwise the draft invoice defaults to your Stripe account's own
default currency, which will conflict with the items' currency the moment
they don't match.
