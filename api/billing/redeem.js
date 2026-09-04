// POST /api/billing/redeem { code } -> { ok:true, email } | { ok:false }
// Validates a Pro code exists. No secrets are returned beyond the email on
// the record itself (which the redeemer already knows, since they typed the
// code they were emailed).

import { storageConfigured } from '../_lib/store.js';
import { getEntitlement } from '../_lib/entitlements.js';

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end(JSON.stringify({ error: 'method_not_allowed' }));
  }
  if (!storageConfigured()) {
    return res.status(503).end(JSON.stringify({ error: 'storage_unconfigured' }));
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const code = String(body.code || '').trim();
    if (!code) return res.status(400).end(JSON.stringify({ error: 'missing_code' }));

    const entitlement = await getEntitlement(code);
    if (!entitlement) return res.status(404).end(JSON.stringify({ ok: false, error: 'not_found' }));

    return res.status(200).end(JSON.stringify({ ok: true, email: entitlement.email || null }));
  } catch (err) {
    console.error('redeem error', err);
    return res.status(500).end(JSON.stringify({ error: 'server_error' }));
  }
}
