import type { Db, Tx } from './db';

export interface ProviderEvent<P> {
  /** Who sent it, e.g. `'paymob'` or `'bosta'`. Event ids are unique per provider. */
  provider: string;
  eventId: string;
  payload: P;
}

/**
 * Applies a provider event at most once (rule 8). In one transaction it records the receipt
 * (`provider`, `eventId`) and, only when that receipt is new, runs `apply` on the same `tx`; both
 * commit together. A redelivery finds the receipt and answers `'duplicate'` without calling
 * `apply`. A redelivery arriving while the first is still running waits on the receipt's unique
 * index until that one commits (then it is a duplicate) or rolls back (then it applies). When
 * `apply` throws, nothing is recorded and the error is rethrown, so the provider's retry applies
 * the event. Events with different ids are independent, so they may arrive in any order.
 */
export async function ingestEvent<P>(
  db: Db,
  e: ProviderEvent<P>,
  apply: (tx: Tx, payload: P) => Promise<void>,
): Promise<'applied' | 'duplicate'> {
  return db.transaction(async (tx) => {
    const recorded = await tx.query(
      `insert into webhook_receipts (provider, event_id, payload) values ($1, $2, $3::jsonb)
       on conflict (provider, event_id) do nothing
       returning id`,
      [e.provider, e.eventId, JSON.stringify(e.payload)],
    );
    if (recorded.length === 0) return 'duplicate';
    await apply(tx, e.payload);
    return 'applied';
  });
}
