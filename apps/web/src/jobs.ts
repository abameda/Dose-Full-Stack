import type { Db } from '@dose/core/db';
import { expireStaleOrders } from '@dose/core/order-actions';
import { deliverNext, type OutboxHandler } from '@dose/core/outbox';

/** The most outbox messages one cron run delivers; the rest wait for the next run. */
export const MAX_DELIVERIES_PER_RUN = 50;

export interface CronResult {
  expired: string[];
  delivered: number;
}

/**
 * One cron run: cancel the cash-on-delivery orders whose confirmation window has ended, then
 * deliver outbox messages one by one until nothing deliverable is left (`idle`, or only kinds with
 * no handler) or `MAX_DELIVERIES_PER_RUN` have gone.
 */
export async function runCron(db: Db, handlers: Record<string, OutboxHandler>, now: Date): Promise<CronResult> {
  const { cancelled } = await expireStaleOrders(db, now);
  let delivered = 0;
  while (delivered < MAX_DELIVERIES_PER_RUN) {
    const outcome = await deliverNext(db, handlers, now);
    if (outcome === 'idle' || outcome === 'no_handler') break;
    delivered += 1;
  }
  return { expired: cancelled, delivered };
}
