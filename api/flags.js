// GET /api/flags -> { paywallEnabled, onlinePaywalled, aiPaywalled }
// Public, no auth. Always returns a usable object — missing/unconfigured
// storage just means every flag is false (paywall off, everything free).

import { getFlags } from './_lib/entitlements.js';

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  try {
    const flags = await getFlags();
    res.status(200).end(JSON.stringify(flags));
  } catch (err) {
    console.error('flags error', err);
    res.status(200).end(JSON.stringify({ paywallEnabled: false, onlinePaywalled: false, aiPaywalled: false }));
  }
}
