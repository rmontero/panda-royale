// Daily maintenance, invoked by a QStash schedule (see scripts/setup-upstash.mjs).
// Keeps the hall-of-fame sorted set trimmed to the top entries. Signature-verified
// so only QStash can call it.
//
// Vercel serves this as a Web handler via the exported POST.

import { trimHallOfFame } from '../_lib/store.js';
import { verifyQStash } from '../_lib/upstash.js';

export async function POST(request) {
  const body = await request.text();
  const signature =
    request.headers.get('upstash-signature') || request.headers.get('Upstash-Signature');

  if (!(await verifyQStash(signature, body))) {
    return new Response(JSON.stringify({ error: 'bad_signature' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const removed = await trimHallOfFame(25);
  return new Response(JSON.stringify({ ok: true, removed }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

// Allow a manual GET ping (no-op) for humans checking the endpoint exists.
export function GET() {
  return new Response(JSON.stringify({ ok: true, hint: 'POST from QStash only' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
