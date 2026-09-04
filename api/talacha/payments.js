// GET /api/talacha/payments  (header: x-admin-token: <TALACHA_ADMIN_TOKEN>)
// -> { payments: [...] }
//
// Read-only view of the webhook's payment log. Gated behind a shared admin
// token (not public) since it lists client emails and amounts — set
// TALACHA_ADMIN_TOKEN to any random string and pass it back in the header.
// Without that env var set, the endpoint stays locked (fails closed).

import { getRedis } from '../_lib/store.js';

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');

  const expected = process.env.TALACHA_ADMIN_TOKEN;
  const given = req.headers['x-admin-token'];
  if (!expected || given !== expected) {
    return res.status(401).end(JSON.stringify({ error: 'unauthorized' }));
  }

  const redis = getRedis();
  if (!redis) return res.status(200).end(JSON.stringify({ payments: [] }));

  try {
    const payments = await redis.lrange('talacha:payments', 0, 99);
    return res.status(200).end(JSON.stringify({ payments }));
  } catch (err) {
    console.error('talacha payments read error', err);
    return res.status(500).end(JSON.stringify({ error: 'server_error' }));
  }
}
