import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { placeCodOrder, quoteBag, type BagLine } from '../src/checkout';
import type { Db } from '../src/db';
import { cancelOrder, confirmOrder, expireStaleOrders, type ActionOutcome } from '../src/order-actions';
import { getStock, type Actor } from '../src/stock';
import { makeProduct, makeVariant, type VariantFixture } from './factories';
import { withTestDb } from './harness';

const NOW = new Date('2026-10-20T10:00:00.000Z');
const HOUR_MS = 3_600_000;
const staff: Actor = { type: 'staff', id: 'ops@example.test' };

async function arrange(variants: { stock?: number }[] = [{}]) {
  const db = await withTestDb();
  const product = await makeProduct(db.owner, { status: 'published' });
  const made: VariantFixture[] = [];
  for (const v of variants) made.push(await makeVariant(db.owner, product.id, v));
  return { ...db, variants: made };
}

/** Places a cash-on-delivery order for `lines` through the real checkout and returns its number. */
async function place(app: Db, lines: BagLine[], now: Date = NOW): Promise<string> {
  const quote = await quoteBag(app, lines, 'cairo');
  if ('unknownSkus' in quote) throw new Error(`unknown SKUs ${quote.unknownSkus.join(', ')}`);
  const outcome = await placeCodOrder(app, {
    idempotencyKey: randomUUID(),
    lang: 'en',
    direction: 'd0-baseline',
    surface: 'storefront',
    lines,
    quotedTotal: quote.total,
    customer: { name: 'Test Customer', phone: '01012345678' },
    address: { governorate: 'cairo', area: 'Nasr City', street: 'Test Street', building: '12' },
    now,
  });
  if (!outcome.ok) throw new Error(`expected an order, got ${JSON.stringify(outcome)}`);
  return outcome.orderNumber;
}

function only<T>(items: T[]): T {
  const [item] = items;
  if (items.length !== 1 || item === undefined) throw new Error(`expected exactly one item, got ${String(items.length)}`);
  return item;
}

async function orderRow(owner: Db, number: string) {
  return only(
    await owner.query<{ id: string; order_state: string; payment_state: string; version: number }>(
      `select id, order_state, payment_state, version from orders where number = $1`,
      [number],
    ),
  );
}

/** Movements that consumed or released each of the order's reservations, by reservation id. */
async function settlingMovements(owner: Db, number: string) {
  return owner.query<{ reservation_id: string; status: string; movements: number }>(
    `select r.id as reservation_id, r.status,
            (select count(*)::int from stock_movements m
              where m.source_key in ('sold:' || r.id, 'release:' || r.id)) as movements
       from reservations r join orders o on o.id = r.order_id
      where o.number = $1`,
    [number],
  );
}

test('confirm sells reserved stock once and records who', async () => {
  const { app, owner, variants } = await arrange([{ stock: 10 }]);
  const v = only(variants);
  const number = await place(app, [{ sku: v.sku, quantity: 2 }]);
  expect(await getStock(app, v.id)).toEqual({ onHand: 10, reserved: 2, available: 8 });

  const outcome = await confirmOrder(app, { orderNumber: number, expectedVersion: 1, actor: staff, method: 'whatsapp', note: 'Customer replied' });
  expect(outcome).toEqual({ ok: true, version: 2 });

  expect(await orderRow(owner, number)).toMatchObject({ order_state: 'confirmed', payment_state: 'awaiting_collection', version: 2 });
  expect(await getStock(app, v.id)).toEqual({ onHand: 8, reserved: 0, available: 8 });
  const reservation = only(await settlingMovements(owner, number));
  expect(reservation).toMatchObject({ status: 'consumed', movements: 1 });
  expect(
    await owner.query(`select reason, on_hand_delta, reserved_delta, actor_type, actor_id from stock_movements where source_key = $1`, [
      `sold:${reservation.reservation_id}`,
    ]),
  ).toEqual([{ reason: 'sold', on_hand_delta: -2, reserved_delta: -2, actor_type: 'staff', actor_id: 'ops@example.test' }]);
  expect(
    await owner.query(
      `select actor_type, actor_id, action, entity, entity_id, entity_version, data
         from audit_events where action = 'order.confirmed'`,
    ),
  ).toEqual([
    {
      actor_type: 'staff',
      actor_id: 'ops@example.test',
      action: 'order.confirmed',
      entity: 'order',
      entity_id: number,
      entity_version: 2,
      data: { method: 'whatsapp', note: 'Customer replied' },
    },
  ]);

  // A second confirm with the version the first one used changes nothing.
  expect(await confirmOrder(app, { orderNumber: number, expectedVersion: 1, actor: staff, method: 'phone' })).toEqual({
    ok: false,
    code: 'conflict',
    current: { orderState: 'confirmed', version: 2 },
  });
  expect(await getStock(app, v.id)).toEqual({ onHand: 8, reserved: 0, available: 8 });
  expect(await owner.query(`select 1 from audit_events where action = 'order.confirmed'`)).toHaveLength(1);
});

test('cancel releases stock and voids payment', async () => {
  const { app, owner, variants } = await arrange([{ stock: 10 }, { stock: 5 }]);
  const [a, b] = variants;
  if (a === undefined || b === undefined) throw new Error('two variants expected');
  const number = await place(app, [
    { sku: a.sku, quantity: 3 },
    { sku: b.sku, quantity: 1 },
  ]);

  const outcome = await cancelOrder(app, { orderNumber: number, expectedVersion: 1, actor: staff, reason: 'customer_request' });
  expect(outcome).toEqual({ ok: true, version: 2 });

  const order = await orderRow(owner, number);
  expect(order).toMatchObject({ order_state: 'cancelled', payment_state: 'voided', version: 2 });
  expect(await owner.query(`select state from payments where order_id = $1`, [order.id])).toEqual([{ state: 'voided' }]);
  expect(await getStock(app, a.id)).toEqual({ onHand: 10, reserved: 0, available: 10 });
  expect(await getStock(app, b.id)).toEqual({ onHand: 5, reserved: 0, available: 5 });
  for (const r of await settlingMovements(owner, number)) expect(r).toMatchObject({ status: 'released', movements: 1 });
  expect(
    await owner.query(
      `select actor_type, actor_id, entity_id, entity_version, reason, data from audit_events where action = 'order.cancelled'`,
    ),
  ).toEqual([
    {
      actor_type: 'staff',
      actor_id: 'ops@example.test',
      entity_id: number,
      entity_version: 2,
      reason: 'customer_request',
      data: { paymentVoided: true },
    },
  ]);
});

test('cancel with reason other needs a note', async () => {
  const { app, owner, variants } = await arrange();
  const v = only(variants);
  const number = await place(app, [{ sku: v.sku, quantity: 1 }]);

  for (const note of [undefined, '', '   ']) {
    expect(
      await cancelOrder(app, { orderNumber: number, expectedVersion: 1, actor: staff, reason: 'other', ...(note === undefined ? {} : { note }) }),
    ).toEqual({ ok: false, code: 'invalid' });
  }
  expect(await orderRow(owner, number)).toMatchObject({ order_state: 'pending', version: 1 });

  expect(
    await cancelOrder(app, { orderNumber: number, expectedVersion: 1, actor: staff, reason: 'other', note: 'Wrong address, will reorder' }),
  ).toEqual({ ok: true, version: 2 });
  expect(await owner.query(`select reason, data from audit_events where action = 'order.cancelled'`)).toEqual([
    { reason: 'other', data: { note: 'Wrong address, will reorder', paymentVoided: true } },
  ]);
});

test('refuses malformed commands and unknown orders', async () => {
  const { app, variants } = await arrange();
  const v = only(variants);
  const number = await place(app, [{ sku: v.sku, quantity: 1 }]);
  const invalid: ActionOutcome = { ok: false, code: 'invalid' };

  for (const expectedVersion of [0, -1, 1.5, Number.NaN]) {
    expect(await confirmOrder(app, { orderNumber: number, expectedVersion, actor: staff, method: 'phone' })).toEqual(invalid);
    expect(await cancelOrder(app, { orderNumber: number, expectedVersion, actor: staff, reason: 'duplicate' })).toEqual(invalid);
  }
  // Commands arrive from request bodies, so the unions are checked at run time too.
  expect(await confirmOrder(app, { orderNumber: number, expectedVersion: 1, actor: staff, method: 'email' as 'phone' })).toEqual(invalid);
  expect(await cancelOrder(app, { orderNumber: number, expectedVersion: 1, actor: staff, reason: 'bored' as 'other' })).toEqual(invalid);
  expect(
    await confirmOrder(app, { orderNumber: number, expectedVersion: 1, actor: staff, method: 'phone', note: 'x'.repeat(1001) }),
  ).toEqual(invalid);

  expect(await confirmOrder(app, { orderNumber: 'D99999', expectedVersion: 1, actor: staff, method: 'phone' })).toEqual({
    ok: false,
    code: 'not_found',
  });
  expect(await cancelOrder(app, { orderNumber: 'D99999', expectedVersion: 1, actor: staff, reason: 'duplicate' })).toEqual({
    ok: false,
    code: 'not_found',
  });
  // A stale version on a pending order is a conflict too: someone else changed it first.
  expect(await confirmOrder(app, { orderNumber: number, expectedVersion: 7, actor: staff, method: 'phone' })).toEqual({
    ok: false,
    code: 'conflict',
    current: { orderState: 'pending', version: 1 },
  });
});

test('concurrent confirm and cancel', async () => {
  const { app, owner, variants } = await arrange([{ stock: 200 }]);
  const v = only(variants);
  let confirmed = 0;

  for (let run = 0; run < 50; run++) {
    const number = await place(app, [{ sku: v.sku, quantity: 2 }]);
    const [confirm, cancel] = await Promise.all([
      confirmOrder(app, { orderNumber: number, expectedVersion: 1, actor: staff, method: 'phone' }),
      cancelOrder(app, { orderNumber: number, expectedVersion: 1, actor: { type: 'staff', id: 'owner@example.test' }, reason: 'duplicate' }),
    ]);
    const outcomes = [confirm, cancel];
    expect(outcomes.filter((o) => o.ok)).toEqual([{ ok: true, version: 2 }]);
    const winner = confirm.ok ? 'confirmed' : 'cancelled';
    expect(outcomes.filter((o) => !o.ok)).toEqual([{ ok: false, code: 'conflict', current: { orderState: winner, version: 2 } }]);
    if (confirm.ok) confirmed++;

    expect(await orderRow(owner, number)).toMatchObject({ order_state: winner, version: 2 });
    for (const r of await settlingMovements(owner, number)) {
      expect(r).toMatchObject({ status: confirm.ok ? 'consumed' : 'released', movements: 1 });
    }
    expect(await owner.query(`select action from audit_events where entity_id = $1 and action <> 'order.placed'`, [number])).toEqual([
      { action: `order.${confirm.ok ? 'confirmed' : 'cancelled'}` },
    ]);
  }
  expect(await getStock(app, v.id)).toEqual({ onHand: 200 - 2 * confirmed, reserved: 0, available: 200 - 2 * confirmed });
}, 60_000);

test('confirm after expiry is a conflict', async () => {
  const { app, owner, variants } = await arrange([{ stock: 10 }]);
  const v = only(variants);
  const number = await place(app, [{ sku: v.sku, quantity: 4 }]);

  expect(await expireStaleOrders(app, new Date(NOW.getTime() + 49 * HOUR_MS))).toEqual({ cancelled: [number] });
  expect(await orderRow(owner, number)).toMatchObject({ order_state: 'cancelled', payment_state: 'voided', version: 2 });
  expect(await getStock(app, v.id)).toEqual({ onHand: 10, reserved: 0, available: 10 });
  expect(
    await owner.query(`select actor_type, actor_id, entity_version, reason from audit_events where action = 'order.cancelled'`),
  ).toEqual([{ actor_type: 'system', actor_id: 'expiry', entity_version: 2, reason: 'confirmation_window_expired' }]);

  expect(await confirmOrder(app, { orderNumber: number, expectedVersion: 1, actor: staff, method: 'whatsapp' })).toEqual({
    ok: false,
    code: 'conflict',
    current: { orderState: 'cancelled', version: 2 },
  });
  expect(await getStock(app, v.id)).toEqual({ onHand: 10, reserved: 0, available: 10 });
  for (const r of await settlingMovements(owner, number)) expect(r).toMatchObject({ status: 'released', movements: 1 });

  // Nothing is left to expire.
  expect(await expireStaleOrders(app, new Date(NOW.getTime() + 100 * HOUR_MS))).toEqual({ cancelled: [] });
});

test('expiry ignores orders inside the window', async () => {
  const { app, owner, variants } = await arrange([{ stock: 10 }]);
  const v = only(variants);
  const number = await place(app, [{ sku: v.sku, quantity: 1 }]);

  expect(await expireStaleOrders(app, new Date(NOW.getTime() + 47 * HOUR_MS))).toEqual({ cancelled: [] });
  expect(await orderRow(owner, number)).toMatchObject({ order_state: 'pending', version: 1 });
  expect(await getStock(app, v.id)).toEqual({ onHand: 10, reserved: 1, available: 9 });
});

test('expiry skips confirmed orders, takes the oldest first and stops at the limit', async () => {
  const { app, owner, variants } = await arrange([{ stock: 10 }]);
  const v = only(variants);
  const first = await place(app, [{ sku: v.sku, quantity: 1 }], NOW);
  const second = await place(app, [{ sku: v.sku, quantity: 1 }], new Date(NOW.getTime() + HOUR_MS));
  const third = await place(app, [{ sku: v.sku, quantity: 1 }], new Date(NOW.getTime() + 2 * HOUR_MS));
  expect(await confirmOrder(app, { orderNumber: first, expectedVersion: 1, actor: staff, method: 'phone' })).toMatchObject({ ok: true });

  const later = new Date(NOW.getTime() + 60 * HOUR_MS);
  expect(await expireStaleOrders(app, later, 1)).toEqual({ cancelled: [second] });
  expect(await expireStaleOrders(app, later, 1)).toEqual({ cancelled: [third] });
  expect(await expireStaleOrders(app, later, 1)).toEqual({ cancelled: [] });
  expect(await orderRow(owner, first)).toMatchObject({ order_state: 'confirmed', version: 2 });
  expect(await getStock(app, v.id)).toEqual({ onHand: 9, reserved: 0, available: 9 });
});
