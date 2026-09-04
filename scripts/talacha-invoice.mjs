#!/usr/bin/env node
// Send a client invoice via the deployed /api/talacha/invoice endpoint.
//
// Usage:
//   node scripts/talacha-invoice.mjs --email=client@co.com --name="Client Co" \
//     --item="Sprint 1 — API integration:5000" --item="Sprint 2 — dashboard:3500" \
//     --due=14 --currency=usd [--base=https://pnd.ad]
//
// Each --item is "description:amount" (amount in major units, e.g. 5000 = $5,000.00).
// Defaults to --base=http://localhost:3000 for local testing with `vercel dev`.

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.join('=')];
  })
);
const items = process.argv.slice(2)
  .filter((a) => a.startsWith('--item='))
  .map((a) => a.slice('--item='.length))
  .map((raw) => {
    const idx = raw.lastIndexOf(':');
    if (idx === -1) throw new Error(`--item must be "description:amount", got: ${raw}`);
    return { description: raw.slice(0, idx), amount: Number(raw.slice(idx + 1)) };
  });

if (!args.email) {
  console.error('Usage: node scripts/talacha-invoice.mjs --email=... --item="desc:amount" [--item=...] [--name=] [--due=14] [--currency=usd] [--base=https://pnd.ad]');
  process.exit(1);
}
if (!items.length) {
  console.error('At least one --item="description:amount" is required.');
  process.exit(1);
}

const base = (args.base || 'http://localhost:3000').replace(/\/$/, '');
const res = await fetch(`${base}/api/talacha/invoice`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: args.email,
    name: args.name,
    items,
    currency: args.currency || 'usd',
    dueInDays: args.due ? Number(args.due) : undefined,
    description: args.description,
  }),
});
const data = await res.json();
if (!res.ok) {
  console.error(`Failed (${res.status}):`, data);
  process.exit(1);
}
console.log(`Invoice ${data.emailWarning ? 'created' : 'sent'}:`);
console.log(`  id:  ${data.id}  (${data.status})`);
console.log(`  pay: ${data.hosted_invoice_url}`);
console.log(`  pdf: ${data.invoice_pdf}`);
if (data.emailWarning) console.log(`\n⚠️  ${data.emailWarning}`);
