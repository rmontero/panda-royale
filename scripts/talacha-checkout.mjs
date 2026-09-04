#!/usr/bin/env node
// Create a one-off Stripe Checkout link via /api/talacha/checkout — for a
// deposit or fixed-fee charge that doesn't need a formal Invoice.
//
// Usage:
//   node scripts/talacha-checkout.mjs --desc="50% deposit — Q1 engagement" \
//     --amount=2500 [--email=client@co.com] [--currency=usd] [--base=https://pnd.ad]

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.join('=')];
  })
);

if (!args.desc || !args.amount) {
  console.error('Usage: node scripts/talacha-checkout.mjs --desc="..." --amount=2500 [--email=] [--currency=usd] [--base=https://pnd.ad]');
  process.exit(1);
}

const base = (args.base || 'http://localhost:3000').replace(/\/$/, '');
const res = await fetch(`${base}/api/talacha`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    op: 'checkout',
    description: args.desc,
    amount: Number(args.amount),
    email: args.email,
    currency: args.currency || 'usd',
  }),
});
const data = await res.json();
if (!res.ok) {
  console.error(`Failed (${res.status}):`, data);
  process.exit(1);
}
console.log('Checkout link:');
console.log(`  ${data.url}`);
