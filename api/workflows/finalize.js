// Upstash Workflow — durable end-of-game finalization.
//
// Triggered by api/game.js when round 10 is submitted. Runs as a QStash-backed
// durable function: it sleeps 45s (no compute held) so late submissions still
// land, then archives the final board and updates the hall of fame. Each step
// is checkpointed, so a crash mid-way resumes rather than restarts.
//
// Vercel serves this as a Web handler via the exported POST.

import { serve } from '@upstash/workflow/nextjs';
import { finalizeGame } from '../_lib/store.js';

export const { POST } = serve(
  async (context) => {
    const { code } = context.requestPayload || {};
    if (!code) return;

    await context.sleep('settle-for-stragglers', 45);
    await context.run('archive-and-hall-of-fame', () => finalizeGame(code));
  },
  {
    failureFunction: async ({ failStatus, failResponse }) => {
      console.error('finalize workflow failed', failStatus, failResponse);
    },
  }
);
