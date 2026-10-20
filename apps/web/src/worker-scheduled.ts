// The Worker's entry point: Astro answers every request, and the cron trigger in wrangler.jsonc
// (every five minutes) runs the order expiry and the outbox.
import { handle } from '@astrojs/cloudflare/handler';
import type { ScheduledController } from '@cloudflare/workers-types';
import { requestDb, type WorkerEnv } from './env';
import { runCron } from './jobs';

/** No provider handlers in Milestone 1; Bosta's arrives in M3. */
const OUTBOX_HANDLERS = {};

export default {
  fetch: handle,
  async scheduled(controller: ScheduledController, env: WorkerEnv): Promise<void> {
    const db = requestDb(env);
    try {
      const result = await runCron(db, OUTBOX_HANDLERS, new Date(controller.scheduledTime));
      console.log(`cron: expired ${String(result.expired.length)} order(s), delivered ${String(result.delivered)} message(s)`);
    } finally {
      await db.close();
    }
  },
};
