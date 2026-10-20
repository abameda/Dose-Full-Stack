import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import { expect, test } from 'vitest';
import { placeCodOrder, quoteBag } from '../src/checkout';
import type { Db, Tx } from '../src/db';
import {
  cancelOrder,
  CANCEL_REASONS,
  confirmOrder,
  expireStaleOrders,
  type ActionOutcome,
  type CancelReason,
} from '../src/order-actions';
import type { OrderState } from '../src/states';
import { getStock, type Actor } from '../src/stock';
import { makeProduct, makeVariant, type VariantFixture } from './factories';
import { withTestDb } from './harness';

// Rule 4: every reservation is used or released exactly once. Random sequences of placing,
// confirming, cancelling and expiring orders, including actions whose transaction dies right after
// its first statement, are run against a model of each order and its reservations. After every
// command the database must agree with the model and with three invariants:
//   - a reservation flips from held at most once (and its one settling movement matches its status),
//   - the held quantities of a variant add up to its stock_levels.reserved,
//   - no order that is no longer pending still has a held reservation.

const HOUR_MS = 3_600_000;
const WINDOW_HOURS = 48;
const VARIANTS_PER_RUN = 2;
const STOCK = 500; // enough that a run never runs out: placing is not what this test is about
const staff: Actor = { type: 'staff', id: 'model@example.test' };

type ReservationStatus = 'held' | 'consumed' | 'released';

interface ModelOrder {
  number: string;
  state: OrderState;
  version: number;
  expiresAtMs: number;
  reservations: Map<string, { variantId: string; quantity: number; status: ReservationStatus }>;
}

interface Model {
  nowMs: number;
  orders: ModelOrder[];
}

interface Real {
  app: Db;
  owner: Db;
  variants: VariantFixture[];
}

/** The clock carries on across runs, so orders left pending by an earlier run expire in a later one. */
let clockMs = new Date('2026-10-20T10:00:00.000Z').getTime();

class Crash extends Error {
  constructor() {
    super('crashed after the first statement');
    this.name = 'Crash';
  }
}

/** A `Db` whose transactions die right after their first statement, as if the worker were killed. */
function crashingAfterFirstStatement(db: Db): Db {
  return {
    query: (sql, params) => db.query(sql, params),
    close: () => db.close(),
    transaction: (fn) =>
      db.transaction((tx) => {
        let ran = false;
        const dying: Tx = {
          async query<R>(sql: string, params?: unknown[]): Promise<R[]> {
            if (ran) throw new Crash();
            ran = true;
            await tx.query<R>(sql, params);
            throw new Crash();
          },
        };
        return fn(dying);
      }),
  };
}

function settle(order: ModelOrder, to: 'confirmed' | 'cancelled'): void {
  if (order.state !== 'pending') throw new Error(`model: ${order.number} is already ${order.state}`);
  order.state = to;
  order.version += 1;
  for (const r of order.reservations.values()) {
    // Rule 4 in the model itself: only a held reservation may flip.
    if (r.status !== 'held') throw new Error(`model: a reservation of ${order.number} flipped twice`);
    r.status = to === 'confirmed' ? 'consumed' : 'released';
  }
}

function expectedOutcome(order: ModelOrder): ActionOutcome {
  return order.state === 'pending'
    ? { ok: true, version: order.version + 1 }
    : { ok: false, code: 'conflict', current: { orderState: order.state, version: order.version } };
}

function pick(m: Readonly<Model>, index: number): ModelOrder {
  const order = m.orders[index % m.orders.length];
  if (order === undefined) throw new Error('model: no order to act on');
  return order;
}

/** Checks the database against the model and the three invariants of rule 4. */
async function checkInvariants(m: Model, r: Real): Promise<void> {
  const reservations = await r.owner.query<{ id: string; status: ReservationStatus; order_state: string; movements: string[] }>(
    `select res.id, res.status, o.order_state,
            array(select m.source_key from stock_movements m
                   where m.source_key in ('sold:' || res.id, 'release:' || res.id)) as movements
       from reservations res join orders o on o.id = res.order_id
      where res.variant_id = any($1::uuid[])`,
    [r.variants.map((v) => v.id)],
  );
  const modelled = new Map(m.orders.flatMap((o) => [...o.reservations.entries()]));
  expect(reservations).toHaveLength(modelled.size);
  for (const row of reservations) {
    expect(row.status).toBe(modelled.get(row.id)?.status);
    const expectedMovements = { held: [], consumed: [`sold:${row.id}`], released: [`release:${row.id}`] }[row.status];
    expect(row.movements).toEqual(expectedMovements);
    if (row.order_state !== 'pending') expect(row.status).not.toBe('held');
  }

  for (const v of r.variants) {
    let held = 0;
    let sold = 0;
    for (const res of modelled.values()) {
      if (res.variantId !== v.id) continue;
      if (res.status === 'held') held += res.quantity;
      if (res.status === 'consumed') sold += res.quantity;
    }
    expect(await getStock(r.owner, v.id)).toEqual({ onHand: STOCK - sold, reserved: held, available: STOCK - sold - held });
  }

  // Over the whole database, not just this run: no held reservation on an order that is not pending.
  expect(
    await r.owner.query(
      `select o.number from reservations res join orders o on o.id = res.order_id
        where res.status = 'held' and o.order_state <> 'pending'`,
    ),
  ).toEqual([]);

  const orders = await r.owner.query<{ number: string; order_state: string; version: number }>(
    `select number, order_state, version from orders where number = any($1::text[])`,
    [m.orders.map((o) => o.number)],
  );
  expect(new Map(orders.map((o) => [o.number, { state: o.order_state, version: o.version }]))).toEqual(
    new Map(m.orders.map((o) => [o.number, { state: o.state, version: o.version }])),
  );
}

class Place implements fc.AsyncCommand<Model, Real> {
  constructor(readonly quantities: number[]) {}
  check(): boolean {
    return true;
  }
  async run(m: Model, r: Real): Promise<void> {
    const lines = r.variants.flatMap((v, i) => {
      const quantity = this.quantities[i] ?? 0;
      return quantity > 0 ? [{ sku: v.sku, quantity }] : [];
    });
    if (lines.length === 0) {
      const [first] = r.variants;
      if (first === undefined) throw new Error('no variants');
      lines.push({ sku: first.sku, quantity: 1 });
    }
    const quote = await quoteBag(r.app, lines, 'cairo');
    if ('unknownSkus' in quote) throw new Error('unknown SKUs');
    const outcome = await placeCodOrder(r.app, {
      idempotencyKey: randomUUID(),
      lang: 'en',
      direction: 'd0-baseline',
      surface: 'storefront',
      lines,
      quotedTotal: quote.total,
      customer: { name: 'Model Customer', phone: '01012345678' },
      address: { governorate: 'cairo', area: 'Nasr City', street: 'Model Street', building: '1' },
      now: new Date(m.nowMs),
    });
    if (!outcome.ok) throw new Error(`placing failed: ${JSON.stringify(outcome)}`);
    const held = await r.owner.query<{ id: string; variant_id: string; quantity: number }>(
      `select res.id, res.variant_id, res.quantity from reservations res join orders o on o.id = res.order_id where o.number = $1`,
      [outcome.orderNumber],
    );
    m.orders.push({
      number: outcome.orderNumber,
      state: 'pending',
      version: 1,
      expiresAtMs: m.nowMs + WINDOW_HOURS * HOUR_MS,
      reservations: new Map(held.map((h) => [h.id, { variantId: h.variant_id, quantity: h.quantity, status: 'held' as const }])),
    });
    await checkInvariants(m, r);
  }
  toString(): string {
    return `Place(${this.quantities.join(',')})`;
  }
}

class Confirm implements fc.AsyncCommand<Model, Real> {
  constructor(readonly index: number) {}
  check(m: Readonly<Model>): boolean {
    return m.orders.length > 0;
  }
  async run(m: Model, r: Real): Promise<void> {
    const order = pick(m, this.index);
    const outcome = await confirmOrder(r.app, { orderNumber: order.number, expectedVersion: order.version, actor: staff, method: 'phone' });
    expect(outcome).toEqual(expectedOutcome(order));
    if (outcome.ok) settle(order, 'confirmed');
    await checkInvariants(m, r);
  }
  toString(): string {
    return `Confirm(${String(this.index)})`;
  }
}

class Cancel implements fc.AsyncCommand<Model, Real> {
  constructor(
    readonly index: number,
    readonly reason: CancelReason,
  ) {}
  check(m: Readonly<Model>): boolean {
    return m.orders.length > 0;
  }
  async run(m: Model, r: Real): Promise<void> {
    const order = pick(m, this.index);
    const outcome = await cancelOrder(r.app, {
      orderNumber: order.number,
      expectedVersion: order.version,
      actor: staff,
      reason: this.reason,
      note: 'model test',
    });
    expect(outcome).toEqual(expectedOutcome(order));
    if (outcome.ok) settle(order, 'cancelled');
    await checkInvariants(m, r);
  }
  toString(): string {
    return `Cancel(${String(this.index)}, ${this.reason})`;
  }
}

/** A limit far above anything a run leaves behind, so every overdue order is expired at once. */
const EXPIRE_ALL = 100_000;

class Expire implements fc.AsyncCommand<Model, Real> {
  constructor(readonly advanceHours: number) {}
  check(): boolean {
    return true;
  }
  async run(m: Model, r: Real): Promise<void> {
    m.nowMs += this.advanceHours * HOUR_MS;
    clockMs = Math.max(clockMs, m.nowMs);
    const { cancelled } = await expireStaleOrders(r.app, new Date(m.nowMs), EXPIRE_ALL);
    const overdue = m.orders.filter((o) => o.state === 'pending' && o.expiresAtMs <= m.nowMs);
    // Earlier runs' leftovers are expired too; only this run's orders are modelled.
    const mine = new Set(m.orders.map((o) => o.number));
    expect(cancelled.filter((n) => mine.has(n)).sort()).toEqual(overdue.map((o) => o.number).sort());
    for (const o of overdue) settle(o, 'cancelled');
    await checkInvariants(m, r);
  }
  toString(): string {
    return `Expire(${String(this.advanceHours)}h)`;
  }
}

type CrashedAction = 'confirm' | 'cancel' | 'expire';

class CrashMidway implements fc.AsyncCommand<Model, Real> {
  constructor(
    readonly action: CrashedAction,
    readonly index: number,
    readonly advanceHours: number,
  ) {}
  check(m: Readonly<Model>): boolean {
    return this.action === 'expire' || m.orders.length > 0;
  }
  async run(m: Model, r: Real): Promise<void> {
    const dying = crashingAfterFirstStatement(r.app);
    let attempt: Promise<unknown>;
    if (this.action === 'expire') {
      // The clock moves on, but the job dies, so nothing expires yet.
      m.nowMs += this.advanceHours * HOUR_MS;
      clockMs = Math.max(clockMs, m.nowMs);
      attempt = expireStaleOrders(dying, new Date(m.nowMs), EXPIRE_ALL);
    } else {
      const order = pick(m, this.index);
      const base = { orderNumber: order.number, expectedVersion: order.version, actor: staff };
      attempt =
        this.action === 'confirm'
          ? confirmOrder(dying, { ...base, method: 'whatsapp' })
          : cancelOrder(dying, { ...base, reason: 'unreachable' });
    }
    await expect(attempt).rejects.toBeInstanceOf(Crash);
    await checkInvariants(m, r);
  }
  toString(): string {
    return `CrashMidway(${this.action}, ${String(this.index)}${this.action === 'expire' ? `, ${String(this.advanceHours)}h` : ''})`;
  }
}

const index = fc.nat({ max: 50 });
const hours = fc.integer({ min: 1, max: 60 });
const commands = fc.commands(
  [
    fc.array(fc.integer({ min: 0, max: 3 }), { minLength: VARIANTS_PER_RUN, maxLength: VARIANTS_PER_RUN }).map((q) => new Place(q)),
    index.map((i) => new Confirm(i)),
    fc.tuple(index, fc.constantFrom(...CANCEL_REASONS)).map(([i, reason]) => new Cancel(i, reason)),
    hours.map((h) => new Expire(h)),
    fc
      .tuple(fc.constantFrom<CrashedAction>('confirm', 'cancel', 'expire'), index, hours)
      .map(([action, i, h]) => new CrashMidway(action, i, h)),
  ],
  { maxCommands: 15 },
);

test('rule 4: every reservation is consumed or released exactly once', async () => {
  const { app, owner } = await withTestDb();
  const product = await makeProduct(owner, { status: 'published' });

  await fc.assert(
    fc.asyncProperty(commands, async (cmds) => {
      // Fresh variants per run, so each run's stock is its own.
      const variants: VariantFixture[] = [];
      for (let i = 0; i < VARIANTS_PER_RUN; i++) variants.push(await makeVariant(owner, product.id, { stock: STOCK }));
      await fc.asyncModelRun(() => ({ model: { nowMs: clockMs, orders: [] }, real: { app, owner, variants } }), cmds);
    }),
    { numRuns: 300 },
  );
}, 600_000);
