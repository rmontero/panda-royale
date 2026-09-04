#!/usr/bin/env node
// Flip the paywall on/off without a deploy. This is the kill-switch: if
// Stripe, the webhook, or the entitlement check ever misbehaves in
// production, run this with everything set to "off" and the app is free
// for everyone again within seconds.
//
// Usage (locally, with the project's Redis env vars available):
//   KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/set-flags.mjs --status
//   KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/set-flags.mjs --paywall=on --online=on --ai=on
//   KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/set-flags.mjs --paywall=off   # kill-switch
//
// Flags default to "off" everywhere until explicitly turned on — see
// api/_lib/entitlements.js's DEFAULT_FLAGS.

import { getFlags, setFlags } from '../api/_lib/entitlements.js';
import { storageConfigured } from '../api/_lib/store.js';

if (!storageConfigured()) {
  console.error('Redis isn\'t configured — set KV_REST_API_URL / KV_REST_API_TOKEN (or the UPSTASH_* equivalents) first.');
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'on'];
  })
);

const toBool = (v) => v === 'on' || v === 'true' || v === '1';

if (args.status) {
  console.log(await getFlags());
  process.exit(0);
}

const patch = {};
if ('paywall' in args) patch.paywallEnabled = toBool(args.paywall);
if ('online' in args) patch.onlinePaywalled = toBool(args.online);
if ('ai' in args) patch.aiPaywalled = toBool(args.ai);

if (Object.keys(patch).length === 0) {
  console.log('Nothing to change. Usage: --status | --paywall=on|off --online=on|off --ai=on|off');
  console.log('Current flags:', await getFlags());
  process.exit(0);
}

const next = await setFlags(patch);
console.log('Flags updated:', next);
