// Shared HTTP helpers for the Node-runtime `(req, res)` endpoints
// (game.js, billing.js, analyze.js). The webhook / QStash routes use the Web
// `(request)` runtime and build their own `new Response(...)` because they need
// the raw, unparsed body for signature verification — they intentionally do
// NOT use these helpers.

// Write a JSON response with no-store caching.
export function send(res, status, body) {
  res.status(status).setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

// Parse a request body that Vercel may hand us as an already-parsed object, a
// JSON string, or nothing. Always returns an object (never throws).
export function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      return {};
    }
  }
  return req.body;
}
