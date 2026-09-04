// GET /api/hof -> { entries: [{ label, score }] }
// Biggest single-round scores across every finished game. Empty when Redis
// is not configured or no game has finished yet.

import { getHallOfFame } from './_lib/store.js';

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'public, max-age=30');
  try {
    const entries = await getHallOfFame(8);
    res.status(200).end(JSON.stringify({ entries }));
  } catch (err) {
    console.error('hof error', err);
    res.status(200).end(JSON.stringify({ entries: [] }));
  }
}
