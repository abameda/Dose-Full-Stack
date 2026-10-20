import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { placeCodOrder, quoteBag, type CheckoutCommand, type CheckoutOutcome } from '../src/checkout';
import type { Db } from '../src/db';
import { getStock } from '../src/stock';
import { makeProduct, makeVariant } from './factories';
import { withTestDb } from './harness';

const NOW = new Date('2026-10-20T10:00:00.000Z');
const DELIVERY = 7_000;

async function arrange(variants: { stock?: number; pricePiastres?: number }[] = [{}]) {
  const db = await withTestDb();
  const product = await makeProduct(db.owner, { status: 'published', nameAr: 'جنة', nameEn: 'Paradise' });
  const made = [];
  for (const v of variants) made.push(await makeVariant(db.owner, product.id, v));
  return { ...db, variants: made };
}

/** A valid storefront checkout for `lines`, quoted at their current prices plus EGP 70 delivery. */
async function command(app: Db, lines: CheckoutCommand['lines'], overrides: Partial<CheckoutCommand> = {}) {
  const quote = await quoteBag(app, lines, 'cairo');
  if ('unknownSkus' in quote) throw new Error(`unknown SKUs ${quote.unknownSkus.join(', ')}`);
  const cmd: CheckoutCommand = {
    idempotencyKey: randomUUID(),
    lang: 'en',
    direction: 'd0-baseline',
    surface: 'storefront',
    lines,
    quotedTotal: quote.total,
    customer: { name: 'Test Customer', phone: '01012345678' },
    address: { governorate: 'cairo', area: 'Nasr City', street: 'Test Street', building: '12' },
    now: NOW,
    ...overrides,
  };
  return cmd;
}

async function count(db: Db, table: string): Promise<number> {
  const [row] = await db.query<{ n: number }>(`select count(*)::int as n from ${table}`);
  return row?.n ?? -1;
}

function placed(outcome: CheckoutOutcome): Extract<CheckoutOutcome, { ok: true }> {
  if (!outcome.ok) throw new Error(`expected an order, got ${JSON.stringify(outcome)}`);
  return outcome;
}

test('places an order, reserves stock and writes order.placed', async () => {
  const { app, owner, variants } = await arrange([{ pricePiastres: 150_000 }]);
  const [v] = variants;
  if (v === undefined) throw new Error('no variant');
  const outcome = placed(await placeCodOrder(app, await command(app, [{ sku: v.sku, quantity: 2 }])));

  expect(outcome.orderNumber).toMatch(/^D\d{5,}$/);
  expect(outcome).toMatchObject({ total: 2 * 150_000 + DELIVERY, replayed: false });

  const [order] = await owner.query(`select * from orders where number = $1`, [outcome.orderNumber]);
  expect(order).toMatchObject({
    order_state: 'pending',
    payment_state: 'awaiting_collection',
    fulfilment_state: 'unfulfilled',
    version: 1,
    channel: 'web',
    payment_method: 'cod',
    lang: 'en',
    direction: 'd0-baseline',
    governorate: 'cairo',
    recipient_name: 'Test Customer',
    recipient_phone: '+201012345678',
    subtotal: 300_000,
    discount_total: 0,
    delivery_fee: DELIVERY,
    total: 307_000,
  });
  const orderId = order?.['id'];

  expect(await owner.query(`select sku, name_ar, name_en, unit_price, quantity, line_discount, line_total from order_lines where order_id = $1`, [orderId])).toEqual([
    { sku: v.sku, name_ar: 'جنة', name_en: 'Paradise', unit_price: 150_000, quantity: 2, line_discount: 0, line_total: 300_000 },
  ]);
  expect(await owner.query(`select method, amount, state, attempt from payments where order_id = $1`, [orderId])).toEqual([
    { method: 'cod', amount: 307_000, state: 'awaiting_collection', attempt: 1 },
  ]);
  const reservations = await owner.query<{ variant_id: string; quantity: number; status: string; expires_at: Date }>(
    `select variant_id, quantity, status, expires_at from reservations where order_id = $1`,
    [orderId],
  );
  expect(reservations).toEqual([
    { variant_id: v.id, quantity: 2, status: 'held', expires_at: new Date(NOW.getTime() + 48 * 3_600_000) },
  ]);
  expect(await getStock(app, v.id)).toEqual({ onHand: 10, reserved: 2, available: 8 });
  expect(
    await owner.query(`select reason, reserved_delta, source_key, actor_type, actor_id from stock_movements where reason = 'reserved'`),
  ).toEqual([
    {
      reason: 'reserved',
      reserved_delta: 2,
      source_key: `reserve:${String(orderId)}:${v.id}`,
      actor_type: 'customer',
      actor_id: '+201012345678',
    },
  ]);

  expect(await owner.query(`select actor_type, actor_id, action, entity, entity_id, entity_version from audit_events`)).toEqual([
    {
      actor_type: 'customer',
      actor_id: '+201012345678',
      action: 'order.placed',
      entity: 'order',
      entity_id: outcome.orderNumber,
      entity_version: 1,
    },
  ]);
});

test('returns the same order for a repeated idempotency key', async () => {
  const { app, variants } = await arrange();
  const [v] = variants;
  if (v === undefined) throw new Error('no variant');
  const cmd = await command(app, [{ sku: v.sku, quantity: 3 }]);
  const first = placed(await placeCodOrder(app, cmd));
  const second = placed(await placeCodOrder(app, cmd));
  expect(second).toEqual({ ...first, replayed: true });
  expect(await count(app, 'orders')).toBe(1);
  expect((await getStock(app, v.id)).reserved).toBe(3);
});

test('parallel duplicate submissions create one order', async () => {
  const { app, variants } = await arrange();
  const [v] = variants;
  if (v === undefined) throw new Error('no variant');
  const cmd = await command(app, [{ sku: v.sku, quantity: 1 }]);
  const outcomes = (await Promise.all(Array.from({ length: 10 }, () => placeCodOrder(app, cmd)))).map(placed);
  expect(new Set(outcomes.map((o) => o.orderNumber)).size).toBe(1);
  expect(outcomes.filter((o) => !o.replayed)).toHaveLength(1);
  expect(await count(app, 'orders')).toBe(1);
  expect((await getStock(app, v.id)).reserved).toBe(1);
});

test('a duplicate submission that loses the last unit to its twin still gets the order', async () => {
  const { app, variants } = await arrange([{ stock: 1 }]);
  const [v] = variants;
  if (v === undefined) throw new Error('no variant');
  const cmd = await command(app, [{ sku: v.sku, quantity: 1 }]);
  const outcomes = (await Promise.all(Array.from({ length: 10 }, () => placeCodOrder(app, cmd)))).map(placed);
  expect(new Set(outcomes.map((o) => o.orderNumber)).size).toBe(1);
  expect(await count(app, 'orders')).toBe(1);
  expect(await getStock(app, v.id)).toEqual({ onHand: 1, reserved: 1, available: 0 });
});

test('price_changed when the quoted total is stale', async () => {
  const { app, owner, variants } = await arrange([{ pricePiastres: 150_000 }]);
  const [v] = variants;
  if (v === undefined) throw new Error('no variant');
  const cmd = await command(app, [{ sku: v.sku, quantity: 1 }]);
  await owner.query(`update variants set price_piastres = 165_000 where id = $1`, [v.id]);

  const outcome = await placeCodOrder(app, cmd);
  expect(outcome).toMatchObject({ ok: false, code: 'price_changed' });
  if (outcome.ok || outcome.code !== 'price_changed') throw new Error('unreachable');
  expect(outcome.quote.total).toBe(165_000 + DELIVERY);
  expect(outcome.quote.lines).toMatchObject([{ sku: v.sku, unitPrice: 165_000, quantity: 1 }]);

  expect(await count(app, 'orders')).toBe(0);
  expect(await count(app, 'reservations')).toBe(0);
  expect(await getStock(app, v.id)).toEqual({ onHand: 10, reserved: 0, available: 10 });

  // Confirming the new total goes through.
  placed(await placeCodOrder(app, { ...cmd, quotedTotal: outcome.quote.total }));
});

test('out_of_stock names the short SKUs and reserves nothing', async () => {
  const { app, owner, variants } = await arrange([{ stock: 5 }, { stock: 1 }]);
  const [first, second] = variants;
  if (first === undefined || second === undefined) throw new Error('no variants');
  const cmd = await command(app, [
    { sku: first.sku, quantity: 2 },
    { sku: second.sku, quantity: 2 },
  ]);
  expect(await placeCodOrder(app, cmd)).toEqual({ ok: false, code: 'out_of_stock', skus: [second.sku] });
  expect(await getStock(app, first.id)).toEqual({ onHand: 5, reserved: 0, available: 5 });
  expect(await getStock(app, second.id)).toEqual({ onHand: 1, reserved: 0, available: 1 });
  expect(await owner.query(`select 1 from stock_movements where reason = 'reserved'`)).toHaveLength(0);
  expect(await count(owner, 'orders')).toBe(0);
  expect(await count(owner, 'customers')).toBe(0);
});

test('out_of_stock names a SKU that is no longer sold', async () => {
  const { app, owner, variants } = await arrange([{}, {}]);
  const [kept, archived] = variants;
  if (kept === undefined || archived === undefined) throw new Error('no variants');
  const cmd = await command(app, [
    { sku: kept.sku, quantity: 1 },
    { sku: archived.sku, quantity: 1 },
  ]);
  await owner.query(`update variants set status = 'archived' where id = $1`, [archived.id]);
  expect(await placeCodOrder(app, { ...cmd, lines: [...cmd.lines, { sku: 'NO-SUCH-SKU', quantity: 1 }] })).toEqual({
    ok: false,
    code: 'out_of_stock',
    skus: [archived.sku, 'NO-SUCH-SKU'],
  });
  expect(await count(owner, 'orders')).toBe(0);
});

test('refuses in the studio', async () => {
  const { app, owner, variants } = await arrange();
  const [v] = variants;
  if (v === undefined) throw new Error('no variant');
  const cmd = await command(app, [{ sku: v.sku, quantity: 1 }], { surface: 'studio' });
  const untouchable: Db = {
    query: () => Promise.reject(new Error('the database was touched')),
    transaction: () => Promise.reject(new Error('the database was touched')),
    close: () => Promise.resolve(),
  };
  expect(await placeCodOrder(untouchable, cmd)).toEqual({ ok: false, code: 'checkout_disabled' });
  expect(await placeCodOrder(app, cmd)).toEqual({ ok: false, code: 'checkout_disabled' });
  for (const table of ['orders', 'customers', 'reservations', 'audit_events']) expect(await count(owner, table)).toBe(0);
  expect((await getStock(app, v.id)).reserved).toBe(0);
});

describe('invalid input', () => {
  test('invalid lists the bad fields', async () => {
    const { app, owner, variants } = await arrange();
    const [v] = variants;
    if (v === undefined) throw new Error('no variant');
    const cmd = await command(app, [{ sku: v.sku, quantity: 1 }], {
      customer: { name: 'Test Customer', phone: '0223456789' },
      address: { governorate: 'cairo', area: 'Nasr City', street: '  ', building: '12' },
    });
    const outcome = await placeCodOrder(app, cmd);
    expect(outcome).toMatchObject({ ok: false, code: 'invalid' });
    if (outcome.ok || outcome.code !== 'invalid') throw new Error('unreachable');
    expect(outcome.fields).toEqual(expect.arrayContaining(['customer.phone', 'address.street']));
    expect(outcome.fields).toHaveLength(2);
    expect(await count(owner, 'orders')).toBe(0);
  });

  test('refuses bags outside the limits, duplicate SKUs, and a bad key, name or governorate', async () => {
    const { app, variants } = await arrange();
    const [v] = variants;
    if (v === undefined) throw new Error('no variant');
    const cmd = await command(app, [{ sku: v.sku, quantity: 1 }]);
    const fieldsOf = async (overrides: Partial<CheckoutCommand>) => {
      const outcome = await placeCodOrder(app, { ...cmd, ...overrides });
      if (outcome.ok || outcome.code !== 'invalid') throw new Error(`expected invalid, got ${JSON.stringify(outcome)}`);
      return outcome.fields;
    };
    expect(await fieldsOf({ lines: [] })).toEqual(['lines']);
    expect(await fieldsOf({ lines: Array.from({ length: 11 }, (_, i) => ({ sku: `S-${String(i)}`, quantity: 1 })) })).toEqual([
      'lines',
    ]);
    expect(await fieldsOf({ lines: [{ sku: v.sku, quantity: 1 }, { sku: v.sku, quantity: 2 }] })).toEqual(['lines']);
    expect(await fieldsOf({ lines: [{ sku: v.sku, quantity: 11 }] })).toEqual(['lines.0.quantity']);
    expect(await fieldsOf({ lines: [{ sku: v.sku, quantity: 0 }] })).toEqual(['lines.0.quantity']);
    expect(await fieldsOf({ lines: [{ sku: '', quantity: 1 }] })).toEqual(['lines.0.sku']);
    expect(await fieldsOf({ idempotencyKey: 'not-a-uuid' })).toEqual(['idempotencyKey']);
    expect(await fieldsOf({ quotedTotal: 1.5 })).toEqual(['quotedTotal']);
    expect(await fieldsOf({ customer: { name: ' ', phone: '01012345678' } })).toEqual(['customer.name']);
    expect(await fieldsOf({ customer: { name: 'x'.repeat(101), phone: '01012345678' } })).toEqual(['customer.name']);
    expect(await fieldsOf({ address: { ...cmd.address, governorate: 'atlantis' } })).toEqual(['address.governorate']);
    expect(await count(app, 'orders')).toBe(0);
  });

  test('refuses a governorate where cash on delivery is off', async () => {
    const { app, owner, variants } = await arrange();
    const [v] = variants;
    if (v === undefined) throw new Error('no variant');
    await owner.query(`update governorate_delivery set cod_enabled = false where governorate = 'aswan'`);
    const cmd = await command(app, [{ sku: v.sku, quantity: 1 }], {
      address: { governorate: 'aswan', area: 'Centre', street: 'Corniche', building: '3' },
    });
    expect(await placeCodOrder(app, cmd)).toEqual({ ok: false, code: 'invalid', fields: ['address.governorate'] });
    expect(await count(owner, 'orders')).toBe(0);
  });
});

test('same customer for differently typed phones', async () => {
  const { app, owner, variants } = await arrange();
  const [v] = variants;
  if (v === undefined) throw new Error('no variant');
  const lines = [{ sku: v.sku, quantity: 1 }];
  const a = placed(await placeCodOrder(app, await command(app, lines, { customer: { name: 'Mona', phone: '01012345678' } })));
  const b = placed(
    await placeCodOrder(app, await command(app, lines, { customer: { name: 'Mona A.', phone: '+20 10 1234 5678' } })),
  );
  expect(a.orderNumber).not.toBe(b.orderNumber);
  expect(await owner.query(`select phone_e164 from customers`)).toEqual([{ phone_e164: '+201012345678' }]);
  const rows = await owner.query<{ n: number }>(`select count(distinct customer_id)::int as n from orders`);
  expect(rows).toEqual([{ n: 1 }]);
});

test('quoteBag prices from the database and reports unknown SKUs', async () => {
  const { app, variants } = await arrange([{ pricePiastres: 120_000 }, { pricePiastres: 30_000 }]);
  const [a, b] = variants;
  if (a === undefined || b === undefined) throw new Error('no variants');
  const quote = await quoteBag(app, [
    { sku: a.sku, quantity: 1 },
    { sku: b.sku, quantity: 3 },
  ]);
  expect(quote).toMatchObject({ subtotal: 210_000, discountTotal: 0, deliveryFee: DELIVERY, total: 217_000 });
  expect(await quoteBag(app, [{ sku: a.sku, quantity: 1 }, { sku: 'NOPE', quantity: 1 }], 'giza')).toEqual({
    unknownSkus: ['NOPE'],
  });
});
