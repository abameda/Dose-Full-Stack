import { writeAudit } from './audit';
import type { Db, Tx } from './db';
import { ORDER_TRANSITIONS, PAYMENT_TRANSITIONS, type OrderState, type PaymentState } from './states';
import { releaseStock, sellReserved, type Actor } from './stock';

/**
 * What staff (and the expiry job) do to a pending cash-on-delivery order: confirm it, which sells
 * the stock it holds, or cancel it, which releases that stock and voids the payment. Each action is
 * one transaction that starts with a conditional update of the order from an allowed state at the
 * version the caller saw (rule 6). When that update matches no row, someone else changed the order
 * first: the action changes nothing and answers `conflict` with the order's current state, so two
 * staff acting at once, or a confirm racing the expiry job, move stock once (rule 4). Every held
 * reservation flips exactly once, in the same transaction as its stock movement, whose source key
 * names the reservation.
 */

export const CANCEL_REASONS = [
  'customer_request',
  'unreachable',
  'duplicate',
  'suspected_fraud',
  'out_of_stock',
  'confirmation_window_expired',
  'other',
] as const;
/** Moves to `@dose/contract` with the admin API (Task 10), as `Lang` does. */
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const CONFIRM_METHODS = ['whatsapp', 'phone'] as const;
/** Moves to `@dose/contract` with the admin API (Task 10). */
export type ConfirmMethod = (typeof CONFIRM_METHODS)[number];

export type ActionOutcome =
  | { ok: true; version: number }
  | { ok: false; code: 'conflict'; current: { orderState: OrderState; version: number } }
  | { ok: false; code: 'not_found' | 'invalid' };

export interface ConfirmCommand {
  orderNumber: string;
  /** The `orders.version` the caller saw; any other version is a conflict. */
  expectedVersion: number;
  actor: Actor;
  method: ConfirmMethod;
  note?: string;
}

export interface CancelCommand {
  orderNumber: string;
  expectedVersion: number;
  actor: Actor;
  reason: CancelReason;
  /** Required (non-blank) when `reason` is `'other'`. */
  note?: string;
}

export const MAX_NOTE_LENGTH = 1000;
/** Orders the expiry job cancels in one call unless told otherwise. */
export const DEFAULT_EXPIRY_LIMIT = 100;
const EXPIRY_ACTOR: Actor = { type: 'system', id: 'expiry' };
const INVALID: ActionOutcome = { ok: false, code: 'invalid' };

/** The states `table` allows moving to `to` from. */
function statesLeadingTo<S extends string>(table: Record<S, readonly S[]>, to: S): S[] {
  return (Object.keys(table) as S[]).filter((from) => table[from].includes(to));
}

const CONFIRMABLE = statesLeadingTo(ORDER_TRANSITIONS, 'confirmed');
const CANCELLABLE = statesLeadingTo(ORDER_TRANSITIONS, 'cancelled');
const VOIDABLE = statesLeadingTo<PaymentState>(PAYMENT_TRANSITIONS, 'voided');

/** The note trimmed (absent when blank), or `null` when it is too long. Checked at run time: it arrives from a request body. */
function cleanNote(note: unknown): { note: string | undefined } | null {
  if (note === undefined) return { note: undefined };
  if (typeof note !== 'string') return null;
  const trimmed = note.trim();
  if (trimmed.length > MAX_NOTE_LENGTH) return null;
  return { note: trimmed.length > 0 ? trimmed : undefined };
}

function isVersion(n: unknown): n is number {
  return Number.isSafeInteger(n) && (n as number) >= 1;
}

interface Transitioned {
  orderId: string;
  version: number;
}

/**
 * Moves the order from one of `from` to `to` at `expectedVersion`, bumping its version. On no
 * match, the outcome to answer with instead: `not_found`, or `conflict` with the current state.
 */
async function transition(
  tx: Tx,
  orderNumber: string,
  expectedVersion: number,
  from: readonly OrderState[],
  to: OrderState,
): Promise<Transitioned | ActionOutcome> {
  const [moved] = await tx.query<{ id: string; version: number }>(
    `update orders set order_state = $2, version = version + 1
      where number = $1 and order_state = any($3::text[]) and version = $4
      returning id, version`,
    [orderNumber, to, from, expectedVersion],
  );
  if (moved !== undefined) return { orderId: moved.id, version: moved.version };
  const [current] = await tx.query<{ order_state: OrderState; version: number }>(
    `select order_state, version from orders where number = $1`,
    [orderNumber],
  );
  if (current === undefined) return { ok: false, code: 'not_found' };
  return { ok: false, code: 'conflict', current: { orderState: current.order_state, version: current.version } };
}

/** Flips every held reservation of the order to `status`, in ascending variant order (the lock order checkout uses). */
async function settleReservations(tx: Tx, orderId: string, status: 'consumed' | 'released') {
  const rows = await tx.query<{ id: string; variant_id: string; quantity: number }>(
    `update reservations set status = $2 where order_id = $1 and status = 'held'
     returning id, variant_id, quantity`,
    [orderId, status],
  );
  return rows.sort((a, b) => (a.variant_id < b.variant_id ? -1 : a.variant_id > b.variant_id ? 1 : 0));
}

/** The confirm's note, cleaned, or `null` when the command is invalid. */
function confirmNote(a: ConfirmCommand): { note: string | undefined } | null {
  const note = cleanNote(a.note);
  if (note === null || !isVersion(a.expectedVersion) || !(CONFIRM_METHODS as readonly string[]).includes(a.method)) return null;
  return note;
}

/** The cancel's note, cleaned, or `null` when the command is invalid. The reason `'other'` needs a note. */
function cancelNote(a: CancelCommand): { note: string | undefined } | null {
  const note = cleanNote(a.note);
  if (note === null || !isVersion(a.expectedVersion) || !(CANCEL_REASONS as readonly string[]).includes(a.reason)) return null;
  if (a.reason === 'other' && note.note === undefined) return null;
  return note;
}

/**
 * `confirmOrder` on a transaction the caller owns, for a confirm that is part of a larger change
 * (a provider event, say). Its changes commit or roll back with that transaction. Answers
 * `conflict` (changing nothing) as `confirmOrder` does; the caller decides whether that is an error.
 */
export async function confirmOrderInTx(tx: Tx, a: ConfirmCommand): Promise<ActionOutcome> {
  const checked = confirmNote(a);
  if (checked === null) return INVALID;
  const note = checked.note;
  const moved = await transition(tx, a.orderNumber, a.expectedVersion, CONFIRMABLE, 'confirmed');
  if ('ok' in moved) return moved;

  for (const r of await settleReservations(tx, moved.orderId, 'consumed')) {
    const sold = await sellReserved(tx, { variantId: r.variant_id, quantity: r.quantity, sourceKey: `sold:${r.id}`, actor: a.actor });
    // A held reservation whose sale is already in the ledger means the two disagree: refuse to go on.
    if (sold === 'duplicate') throw new Error(`reservation ${r.id} was held but its sale is already recorded`);
  }
  await writeAudit(tx, {
    actor: a.actor,
    action: 'order.confirmed',
    entity: 'order',
    entityId: a.orderNumber,
    entityVersion: moved.version,
    data: { method: a.method, note },
  });
  return { ok: true, version: moved.version };
}

/**
 * `cancelOrder` on a transaction the caller owns; its changes commit or roll back with that
 * transaction. Answers `conflict` (changing nothing) as `cancelOrder` does.
 */
export async function cancelOrderInTx(tx: Tx, a: CancelCommand): Promise<ActionOutcome> {
  const checked = cancelNote(a);
  if (checked === null) return INVALID;
  const note = checked.note;
  const moved = await transition(tx, a.orderNumber, a.expectedVersion, CANCELLABLE, 'cancelled');
  if ('ok' in moved) return moved;

  for (const r of await settleReservations(tx, moved.orderId, 'released')) {
    const released = await releaseStock(tx, { variantId: r.variant_id, quantity: r.quantity, sourceKey: `release:${r.id}`, actor: a.actor });
    if (released === 'duplicate') throw new Error(`reservation ${r.id} was held but its release is already recorded`);
  }
  // Nothing will be collected for a cancelled order. The payment state lives on the order and on
  // its payment row; both move only from a state that may be voided.
  const voided = await tx.query(
    `update orders set payment_state = 'voided' where id = $1 and payment_state = any($2::text[]) returning id`,
    [moved.orderId, VOIDABLE],
  );
  await tx.query(`update payments set state = 'voided' where order_id = $1 and state = any($2::text[])`, [moved.orderId, VOIDABLE]);
  await writeAudit(tx, {
    actor: a.actor,
    action: 'order.cancelled',
    entity: 'order',
    entityId: a.orderNumber,
    entityVersion: moved.version,
    reason: a.reason,
    data: { note, paymentVoided: voided.length > 0 },
  });
  return { ok: true, version: moved.version };
}

/**
 * Confirms a pending order at `expectedVersion`: its held stock is sold and `order.confirmed` is
 * recorded with who confirmed it and how. Answers `conflict` (changing nothing) when the order is
 * no longer pending or no longer at that version.
 */
export async function confirmOrder(db: Db, a: ConfirmCommand): Promise<ActionOutcome> {
  // Checked here as well, so invalid input never opens a transaction.
  if (confirmNote(a) === null) return INVALID;
  return db.transaction((tx) => confirmOrderInTx(tx, a));
}

/**
 * Cancels a pending order at `expectedVersion`: its held stock is released, its payment voided and
 * `order.cancelled` recorded with the reason. The reason `'other'` needs a note. Answers `conflict`
 * (changing nothing) when the order is no longer pending or no longer at that version.
 */
export async function cancelOrder(db: Db, a: CancelCommand): Promise<ActionOutcome> {
  if (cancelNote(a) === null) return INVALID;
  return db.transaction((tx) => cancelOrderInTx(tx, a));
}

/**
 * The expiry job: cancels, oldest first, up to `limit` pending orders holding a reservation whose
 * confirmation window ended at or before `now`, with reason `confirmation_window_expired`. Each
 * order is locked (`for update skip locked`: one a staff member is acting on right now is left for
 * the next run) and cancelled in its own transaction through the same path as a staff cancel, at the
 * version just read, so a confirm racing it gets a conflict. Returns the cancelled order numbers.
 */
export async function expireStaleOrders(db: Db, now: Date, limit: number = DEFAULT_EXPIRY_LIMIT): Promise<{ cancelled: string[] }> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError(`limit must be a positive whole number, got ${String(limit)}`);
  const cancelled: string[] = [];
  while (cancelled.length < limit) {
    const number = await db.transaction(async (tx) => {
      const [stale] = await tx.query<{ number: string; version: number }>(
        `select o.number, o.version from orders o
          where o.order_state = 'pending'
            and exists (select 1 from reservations r where r.order_id = o.id and r.status = 'held' and r.expires_at <= $1)
          order by o.created_at, o.id
          limit 1
          for update of o skip locked`,
        [now],
      );
      if (stale === undefined) return null;
      const outcome = await cancelOrderInTx(tx, {
        orderNumber: stale.number,
        expectedVersion: stale.version,
        actor: EXPIRY_ACTOR,
        reason: 'confirmation_window_expired',
      });
      // The row is locked at the version just read, so the cancel cannot lose a race.
      if (!outcome.ok) throw new Error(`expiry could not cancel ${stale.number}: ${outcome.code}`);
      return stale.number;
    });
    if (number === null) break;
    cancelled.push(number);
  }
  return { cancelled };
}
