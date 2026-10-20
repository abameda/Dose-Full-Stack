import type { Db, Tx } from './db';

/**
 * Messages to providers (rule 11). A change that must reach a provider enqueues its message on the
 * change's own transaction, so the two commit or roll back together. A worker then delivers it:
 * it claims the message under a lease and commits that claim before calling the provider, so a
 * worker that dies mid-delivery leaves the message claimed with an attempt counted. Once the lease
 * runs out another worker reclaims it and, because an earlier attempt may have reached the
 * provider, first asks the provider by the message's dedupe key; only when the provider has no
 * record of it is it sent again. In M1 no handlers are registered; real ones arrive with Bosta (M3).
 */

export interface OutboxMessage {
  /** Which handler delivers it. */
  kind: string;
  /** Unique per message: enqueueing the same key again keeps the first. Also what `lookup` is asked by. */
  dedupeKey: string;
  payload: unknown;
}

export interface OutboxHandler {
  /** The provider's reference for a message it already accepted under `dedupeKey`, or `null` when it has none. */
  lookup(dedupeKey: string): Promise<string | null>;
  /** Hands the message to the provider and returns the provider's reference for it. */
  send(payload: unknown, dedupeKey: string): Promise<string>;
}

export type DeliveryOutcome =
  /** Sent to the provider and marked done. */
  | 'delivered'
  /** A retry found the provider already had it, so it was marked done without sending again. */
  | 'reconciled'
  /** Nothing is waiting (or everything waiting is claimed by a worker whose lease still holds). */
  | 'idle'
  /** Messages are waiting, but only of kinds with no handler in this registry; they are left untouched. */
  | 'no_handler';

export const DEFAULT_LEASE_SECONDS = 60;

/** A message a worker may take: never claimed, or claimed under a lease that ended by `$2`. */
const CLAIMABLE = `(status = 'pending' or (status = 'claimed' and claimed_until <= $2))`;

/** Saves a message on `tx`, the transaction of the change that causes it. A dedupe key already saved keeps its first message. */
export async function enqueue(tx: Tx, m: OutboxMessage): Promise<void> {
  await tx.query(
    `insert into outbox (kind, dedupe_key, payload) values ($1, $2, $3::jsonb)
     on conflict (dedupe_key) do nothing`,
    [m.kind, m.dedupeKey, JSON.stringify(m.payload)],
  );
}

/**
 * Delivers the oldest claimable message whose kind has a handler. The claim (status `claimed`,
 * one more attempt, a lease until `now + leaseSeconds`) is taken with `for update skip locked` and
 * committed before the provider is called, so two workers never hold the same message. On a
 * retry (`attempts > 1`) the provider is asked first and, when it already has the message, it is
 * marked done with that reference (`'reconciled'`) instead of being sent again. When the handler
 * throws, the error is rethrown and the message stays claimed until its lease ends.
 */
export async function deliverNext(
  db: Db,
  handlers: Record<string, OutboxHandler>,
  now: Date,
  leaseSeconds: number = DEFAULT_LEASE_SECONDS,
): Promise<DeliveryOutcome> {
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1) {
    throw new RangeError(`leaseSeconds must be a positive whole number, got ${String(leaseSeconds)}`);
  }
  const kinds = Object.keys(handlers);

  const [claimed] = await db.query<{ id: string; kind: string; dedupe_key: string; payload: unknown; attempts: number }>(
    `update outbox set status = 'claimed', attempts = attempts + 1, claimed_until = $2::timestamptz + make_interval(secs => $3)
      where id = (select id from outbox
                   where kind = any($1::text[]) and ${CLAIMABLE}
                   order by id
                   limit 1
                   for update skip locked)
      returning id, kind, dedupe_key, payload, attempts`,
    [kinds, now, leaseSeconds],
  );

  if (claimed === undefined) {
    const [waiting] = await db.query<{ unhandled: boolean }>(
      `select exists (select 1 from outbox where not (kind = any($1::text[])) and ${CLAIMABLE}) as unhandled`,
      [kinds, now],
    );
    return waiting?.unhandled === true ? 'no_handler' : 'idle';
  }

  const handler = Object.hasOwn(handlers, claimed.kind) ? handlers[claimed.kind] : undefined;
  if (handler === undefined) throw new Error(`outbox: claimed a ${claimed.kind} message with no handler`);

  if (claimed.attempts > 1) {
    const ref = await handler.lookup(claimed.dedupe_key);
    if (ref !== null) {
      await markDone(db, claimed.id, claimed.attempts, ref, now);
      return 'reconciled';
    }
  }
  const ref = await handler.send(claimed.payload, claimed.dedupe_key);
  await markDone(db, claimed.id, claimed.attempts, ref, now);
  return 'delivered';
}

/**
 * Marks the message done, but only while this worker's claim (the attempt it made) is still the
 * current one. When the lease ran out mid-delivery and another worker reclaimed the message, that
 * worker's own lookup or send settles it instead.
 */
async function markDone(db: Db, id: string, attempt: number, providerRef: string, now: Date): Promise<void> {
  await db.query(
    `update outbox set status = 'done', provider_ref = $3, done_at = $4, claimed_until = null
      where id = $1 and status = 'claimed' and attempts = $2`,
    [id, attempt, providerRef, now],
  );
}
