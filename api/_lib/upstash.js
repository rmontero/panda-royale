// QStash + Workflow helpers. Everything here is optional — if the QStash env
// vars are missing the functions degrade to no-ops and the app keeps working
// (games just don't get an archived final snapshot or a hall-of-fame entry).

import { Client as QStashClient, Receiver } from '@upstash/qstash';
import { Client as WorkflowClient } from '@upstash/workflow';

export function qstashToken() {
  return process.env.QSTASH_TOKEN || null;
}

// Absolute base URL of this deployment, for QStash/Workflow callbacks.
export function appBaseUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const host =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || 'localhost:3000';
  return `https://${host}`;
}

let qstash;
export function getQStash() {
  const token = qstashToken();
  if (!token) return null;
  if (!qstash) qstash = new QStashClient({ token });
  return qstash;
}

let workflow;
export function getWorkflowClient() {
  const token = qstashToken();
  if (!token) return null;
  if (!workflow) workflow = new WorkflowClient({ token });
  return workflow;
}

let receiver;
export function getReceiver() {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) return null;
  if (!receiver) receiver = new Receiver({ currentSigningKey, nextSigningKey });
  return receiver;
}

// Verify an incoming QStash-signed request. Returns true when there is no
// receiver configured (so local/dev without keys still works) OR the signature
// checks out; false only when a receiver is configured and the signature is bad.
export async function verifyQStash(signature, body) {
  const r = getReceiver();
  if (!r) return true;
  if (!signature) return false;
  try {
    return await r.verify({ signature, body });
  } catch {
    return false;
  }
}

// Fire-and-forget: kick off the durable finalize workflow for a finished game.
export async function triggerFinalize(code) {
  const client = getWorkflowClient();
  if (!client) return { skipped: 'no_qstash_token' };
  try {
    const { workflowRunId } = await client.trigger({
      url: `${appBaseUrl()}/api/workflows/finalize`,
      body: { code },
      workflowRunId: `finalize-${String(code).toUpperCase()}`,
      retries: 2,
    });
    return { workflowRunId };
  } catch (err) {
    // A duplicate workflowRunId (game already being finalized) is fine.
    return { skipped: String(err && err.message) };
  }
}
