import type { Tx } from './db';

/**
 * The stock ledger. Every change to a variant's stock is one row in `stock_movements`, and the
 * counters in `stock_levels` move by the same deltas in the same transaction, so on hand and
 * reserved always equal the sum of the movements (rule 3). Each operation carries a `sourceKey`
 * that is unique across the ledger: a repeat is reported as `'duplicate'` and changes nothing
 * (rule 5).
 *
 * Every function runs on the `Tx` it is given and must be called inside a transaction. When one
 * throws, the caller's transaction rolls back, taking the movement it had just inserted with it.
 */

export interface Actor {
  type: 'customer' | 'staff' | 'system';
  id: string;
}

export interface StockOperation {
  variantId: string;
  /** A positive whole number of units. */
  quantity: number;
  /** Names the cause (an order, a delivery note); the same key moves stock once. */
  sourceKey: string;
  actor: Actor;
}

export interface StockAdjustment {
  variantId: string;
  /** Units to add (positive) or remove (negative) from on hand; never zero. */
  delta: number;
  sourceKey: string;
  actor: Actor;
}

export interface Stock {
  onHand: number;
  reserved: number;
  /** `onHand - reserved`: what can still be reserved. */
  available: number;
}

/** There are not enough unreserved units (reserve), or on hand would drop below reserved (adjust). */
export class InsufficientStock extends Error {
  constructor(readonly variantId: string) {
    super(`Insufficient stock for variant ${variantId}`);
    this.name = 'InsufficientStock';
  }
}

/** Release or sale of more units than are reserved. A caller bug, not a shortage. */
export class NotReserved extends Error {
  constructor(readonly variantId: string) {
    super(`Fewer units are reserved than requested for variant ${variantId}`);
    this.name = 'NotReserved';
  }
}

const MAX_UNITS = 2_147_483_647; // the largest value of the integer columns

function assertUnits(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_UNITS) {
    throw new RangeError(`${name} must be a whole number between 1 and ${String(MAX_UNITS)}, got ${String(value)}`);
  }
}

type Reason = 'received' | 'reserved' | 'released' | 'sold' | 'adjusted';

/** Appends the movement; false when its source key was already used (nothing was inserted). */
async function appendMovement(
  tx: Tx,
  a: { variantId: string; sourceKey: string; actor: Actor },
  reason: Reason,
  onHandDelta: number,
  reservedDelta: number,
): Promise<boolean> {
  const inserted = await tx.query(
    `insert into stock_movements (variant_id, reason, on_hand_delta, reserved_delta, source_key, actor_type, actor_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (source_key) do nothing
     returning id`,
    [a.variantId, reason, onHandDelta, reservedDelta, a.sourceKey, a.actor.type, a.actor.id],
  );
  return inserted.length > 0;
}

export async function receiveStock(tx: Tx, a: StockOperation): Promise<'applied' | 'duplicate'> {
  assertUnits(a.quantity, 'quantity');
  if (!(await appendMovement(tx, a, 'received', a.quantity, 0))) return 'duplicate';
  await tx.query(`update stock_levels set on_hand = on_hand + $2 where variant_id = $1`, [a.variantId, a.quantity]);
  return 'applied';
}

/** Holds `quantity` units for a buyer. Throws `InsufficientStock` when fewer are free. */
export async function reserveStock(tx: Tx, a: StockOperation): Promise<'reserved' | 'duplicate'> {
  assertUnits(a.quantity, 'quantity');
  if (!(await appendMovement(tx, a, 'reserved', 0, a.quantity))) return 'duplicate';
  const updated = await tx.query(
    `update stock_levels set reserved = reserved + $2
      where variant_id = $1 and on_hand - reserved >= $2
      returning variant_id`,
    [a.variantId, a.quantity],
  );
  if (updated.length === 0) throw new InsufficientStock(a.variantId);
  return 'reserved';
}

/** Returns reserved units to the free pool. Throws `NotReserved` when fewer are reserved. */
export async function releaseStock(tx: Tx, a: StockOperation): Promise<'applied' | 'duplicate'> {
  assertUnits(a.quantity, 'quantity');
  if (!(await appendMovement(tx, a, 'released', 0, -a.quantity))) return 'duplicate';
  const updated = await tx.query(
    `update stock_levels set reserved = reserved - $2
      where variant_id = $1 and reserved >= $2
      returning variant_id`,
    [a.variantId, a.quantity],
  );
  if (updated.length === 0) throw new NotReserved(a.variantId);
  return 'applied';
}

/** Turns reserved units into sold ones: both counters drop. Throws `NotReserved` when fewer are reserved. */
export async function sellReserved(tx: Tx, a: StockOperation): Promise<'applied' | 'duplicate'> {
  assertUnits(a.quantity, 'quantity');
  if (!(await appendMovement(tx, a, 'sold', -a.quantity, -a.quantity))) return 'duplicate';
  const updated = await tx.query(
    `update stock_levels set on_hand = on_hand - $2, reserved = reserved - $2
      where variant_id = $1 and reserved >= $2
      returning variant_id`,
    [a.variantId, a.quantity],
  );
  if (updated.length === 0) throw new NotReserved(a.variantId);
  return 'applied';
}

/**
 * A stock count correction. Removing units may not take on hand below what is reserved:
 * that throws `InsufficientStock`.
 */
export async function adjustStock(tx: Tx, a: StockAdjustment): Promise<'applied' | 'duplicate'> {
  if (!Number.isInteger(a.delta) || a.delta === 0 || Math.abs(a.delta) > MAX_UNITS) {
    throw new RangeError(`delta must be a non-zero whole number, got ${String(a.delta)}`);
  }
  if (!(await appendMovement(tx, a, 'adjusted', a.delta, 0))) return 'duplicate';
  const updated = await tx.query(
    `update stock_levels set on_hand = on_hand + $2
      where variant_id = $1 and on_hand + $2 >= reserved
      returning variant_id`,
    [a.variantId, a.delta],
  );
  if (updated.length === 0) throw new InsufficientStock(a.variantId);
  return 'applied';
}

export async function getStock(tx: Tx, variantId: string): Promise<Stock> {
  const [row] = await tx.query<{ on_hand: number; reserved: number }>(
    `select on_hand, reserved from stock_levels where variant_id = $1`,
    [variantId],
  );
  if (row === undefined) throw new Error(`Unknown variant ${variantId}`);
  return { onHand: row.on_hand, reserved: row.reserved, available: row.on_hand - row.reserved };
}
