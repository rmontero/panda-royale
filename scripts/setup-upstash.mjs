#!/usr/bin/env node
// One-time setup: register the daily QStash schedule that trims the hall of fame.
//
// Usage (locally, with the project's env vars available):
//   QSTASH_TOKEN=... APP_URL=https://pnd.ad node scripts/setup-upstash.mjs
//
// Safe to re-run — it removes any existing schedule pointing at /api/tasks/sweep
// before creating a fresh one.

import { Client } from '@upstash/qstash';

const token = process.env.QSTASH_TOKEN;
if (!token) {
  console.error('QSTASH_TOKEN is required (find it in the Upstash console / Vercel env).');
  process.exit(1);
}

const base = (process.env.APP_URL || 'https://pnd.ad').replace(/\/$/, '');
const destination = `${base}/api/tasks/sweep`;
const cron = process.env.SWEEP_CRON || '0 9 * * *'; // 09:00 UTC daily

const qstash = new Client({ token });

const existing = await qstash.schedules.list();
for (const s of existing) {
  if (s.destination === destination) {
    console.log(`removing existing schedule ${s.scheduleId}`);
    await qstash.schedules.delete(s.scheduleId);
  }
}

const { scheduleId } = await qstash.schedules.create({
  destination,
  cron,
  retries: 3,
});

console.log(`created schedule ${scheduleId}`);
console.log(`  ${cron}  ->  POST ${destination}`);
