// GET /api/billing/session?session_id=cs_... -> { code, email } | 404
// Lets the post-checkout success screen show the buyer's new Pro code right
// away instead of making them wait on email. Only returns the code the
// webhook already minted for *this* session id — never someone else's.

import { getCodeForSession, getEntitlement } from '../_lib/entitlements.js';

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end(JSON.stringify({ error: 'method_not_allowed' }));
  }

  const sessionId = String(req.query.session_id || '');
  if (!sessionId) return res.status(400).end(JSON.stringify({ error: 'missing_session_id' }));

  try {
    const code = await getCodeForSession(sessionId);
    if (!code) {
      // Common right after checkout: the webhook hasn't landed yet. The client
      // retries briefly before giving up and falling back to "check your email".
      return res.status(202).end(JSON.stringify({ pending: true }));
    }
    const entitlement = await getEntitlement(code);
    return res.status(200).end(JSON.stringify({ code, email: entitlement && entitlement.email }));
  } catch (err) {
    console.error('billing session lookup error', err);
    return res.status(500).end(JSON.stringify({ error: 'server_error' }));
  }
}
