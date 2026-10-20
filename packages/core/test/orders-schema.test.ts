import { describe, expect, test } from 'vitest';
import { writeAudit } from '../src/audit';
import { GOVERNORATES } from '../src/governorates';
import { FULFILMENT_STATES, ORDER_STATES, PAYMENT_STATES } from '../src/states';
import { makeCustomer, makeOrder, makeProduct, makeVariant, type OrderOverrides } from './factories';
import { withTestDb } from './harness';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

/** The Postgres error a rejected query carries: its SQLSTATE and the constraint that fired. */
function violation(code: string, constraint: string): unknown {
  return expect.objectContaining({ code, constraint });
}

describe('rule 1: the order row refuses figures that do not add up', () => {
  const cases: [string, OrderOverrides, string][] = [
    ['a total that is not subtotal - discount + delivery', { total: 1 }, 'orders_total_matches'],
    ['a negative delivery fee', { subtotal: 1000, deliveryFee: -100, total: 900 }, 'orders_delivery_fee_check'],
    ['a negative discount', { subtotal: 1000, discountTotal: -5, deliveryFee: 0, total: 1005 }, 'orders_discount_total_check'],
    [
      'a discount above the subtotal',
      { subtotal: 1000, discountTotal: 1500, deliveryFee: 700, total: 200 },
      'orders_discount_within_subtotal',
    ],
    ['an unknown order state', { orderState: 'shipped' }, 'orders_order_state_check'],
    ['an unknown payment state', { paymentState: 'collected' }, 'orders_payment_state_check'],
    ['an unknown fulfilment state', { fulfilmentState: 'shipped' }, 'orders_fulfilment_state_check'],
    ['an unknown language', { lang: 'fr' }, 'orders_lang_check'],
    ['an unknown channel', { channel: 'phone' }, 'orders_channel_check'],
    ['an unknown payment method', { paymentMethod: 'card' }, 'orders_payment_method_check'],
  ];

  test.each(cases)('refuses %s', async (_name, overrides, constraint) => {
    const { owner } = await withTestDb();
    const customer = await makeCustomer(owner);
    await expect(makeOrder(owner, customer.id, overrides)).rejects.toEqual(violation(CHECK_VIOLATION, constraint));
  });

  test('accepts every state the code defines (the database and states.ts agree)', async () => {
    const { owner } = await withTestDb();
    const customer = await makeCustomer(owner);
    for (const orderState of ORDER_STATES) await makeOrder(owner, customer.id, { orderState });
    for (const paymentState of PAYMENT_STATES) await makeOrder(owner, customer.id, { paymentState });
    for (const fulfilmentState of FULFILMENT_STATES) await makeOrder(owner, customer.id, { fulfilmentState });
  });

  test('accepts a discount equal to the subtotal', async () => {
    const { owner } = await withTestDb();
    const customer = await makeCustomer(owner);
    await makeOrder(owner, customer.id, { subtotal: 1000, discountTotal: 1000, deliveryFee: 7000, total: 7000 });
  });

  test('refuses a governorate that is not one of the 27, and a repeated checkout key', async () => {
    const { owner } = await withTestDb();
    const customer = await makeCustomer(owner);
    await expect(makeOrder(owner, customer.id, { governorate: 'atlantis' })).rejects.toThrow(/orders_governorate_fkey/);
    const checkoutKey = '5f0c1f0e-7a55-4a52-9a5d-0e6f5a0b9c11'; // gitleaks:allow: a test UUID, not a secret
    await makeOrder(owner, customer.id, { checkoutKey });
    await expect(makeOrder(owner, customer.id, { checkoutKey })).rejects.toEqual(
      violation(UNIQUE_VIOLATION, 'orders_checkout_key_key'),
    );
  });
});

describe('order lines', () => {
  interface LineInput {
    unitPrice?: number;
    quantity?: number;
    lineDiscount?: number;
    lineTotal: number;
  }

  async function arrange() {
    const db = await withTestDb();
    const customer = await makeCustomer(db.owner);
    const order = await makeOrder(db.owner, customer.id);
    const product = await makeProduct(db.owner);
    const variant = await makeVariant(db.owner, product.id);
    const insertLine = (l: LineInput) =>
      db.owner.query(
        `insert into order_lines (order_id, variant_id, sku, name_ar, name_en, unit_price, quantity, line_discount, line_total)
         values ($1, $2, $3, 'عطر', 'Fragrance', $4, $5, $6, $7)`,
        [order.id, variant.id, variant.sku, l.unitPrice ?? 1000, l.quantity ?? 2, l.lineDiscount ?? 0, l.lineTotal],
      );
    return { ...db, insertLine };
  }

  const cases: [string, LineInput, string][] = [
    ['a line total that does not match', { lineTotal: 1999 }, 'order_lines_total_matches'],
    ['a line total that ignores the discount', { lineDiscount: 100, lineTotal: 2000 }, 'order_lines_total_matches'],
    ['a discount above the line price', { lineDiscount: 2500, lineTotal: -500 }, 'order_lines_discount_range'],
    ['a negative discount', { lineDiscount: -1, lineTotal: 2001 }, 'order_lines_discount_range'],
    ['quantity 0', { quantity: 0, lineTotal: 0 }, 'order_lines_quantity_check'],
    ['quantity 11', { quantity: 11, lineTotal: 11_000 }, 'order_lines_quantity_check'],
  ];

  test.each(cases)('refuses %s', async (_name, line, constraint) => {
    const { insertLine } = await arrange();
    await expect(insertLine(line)).rejects.toEqual(violation(CHECK_VIOLATION, constraint));
  });

  test('accepts matching lines at the quantity limits', async () => {
    const { insertLine } = await arrange();
    await insertLine({ quantity: 1, lineTotal: 1000 });
    await insertLine({ quantity: 10, lineDiscount: 500, lineTotal: 9500 });
  });
});

describe('customers, payments and reservations', () => {
  test.each(['+201012345678', '+201112345678', '+201212345678', '+201512345678'])('accepts %s', async (phoneE164) => {
    const { owner } = await withTestDb();
    await makeCustomer(owner, { phoneE164 });
  });

  test.each(['01012345678', '+2010123456', '+20101234567890', '+201312345678', '+971501234567', '+20 1012345678', ''])(
    'refuses the phone number "%s"',
    async (phoneE164) => {
      const { owner } = await withTestDb();
      await expect(makeCustomer(owner, { phoneE164 })).rejects.toEqual(
        violation(CHECK_VIOLATION, 'customers_phone_e164_check'),
      );
    },
  );

  test('a phone number identifies one customer', async () => {
    const { owner } = await withTestDb();
    await makeCustomer(owner, { phoneE164: '+201000000001' });
    await expect(makeCustomer(owner, { phoneE164: '+201000000001' })).rejects.toEqual(
      violation(UNIQUE_VIOLATION, 'customers_phone_e164_key'),
    );
  });

  test('payments: one row per order attempt, whole non-negative amounts, known states', async () => {
    const { owner } = await withTestDb();
    const customer = await makeCustomer(owner);
    const order = await makeOrder(owner, customer.id);
    const insertPayment = (amount: number, state: string, attempt: number) =>
      owner.query(`insert into payments (order_id, method, amount, state, attempt) values ($1, 'cod', $2, $3, $4)`, [
        order.id,
        amount,
        state,
        attempt,
      ]);
    await insertPayment(157_000, 'awaiting_collection', 1);
    await expect(insertPayment(157_000, 'awaiting_collection', 1)).rejects.toEqual(
      violation(UNIQUE_VIOLATION, 'payments_order_id_attempt_key'),
    );
    await insertPayment(157_000, 'voided', 2);
    await expect(insertPayment(-1, 'awaiting_collection', 3)).rejects.toEqual(
      violation(CHECK_VIOLATION, 'payments_amount_check'),
    );
    await expect(insertPayment(1, 'refunded', 3)).rejects.toEqual(violation(CHECK_VIOLATION, 'payments_state_check'));
  });

  test('payment attempt defaults to 1', async () => {
    const { owner } = await withTestDb();
    const order = await makeOrder(owner, (await makeCustomer(owner)).id);
    await owner.query(`insert into payments (order_id, method, amount, state) values ($1, 'cod', 5, 'awaiting_collection')`, [
      order.id,
    ]);
    expect(await owner.query(`select attempt from payments`)).toEqual([{ attempt: 1 }]);
  });

  test('reservations: positive quantity and a known status', async () => {
    const { owner } = await withTestDb();
    const customer = await makeCustomer(owner);
    const order = await makeOrder(owner, customer.id);
    const variant = await makeVariant(owner, (await makeProduct(owner)).id);
    const insertReservation = (quantity: number, status: string) =>
      owner.query(
        `insert into reservations (order_id, variant_id, quantity, status, expires_at)
         values ($1, $2, $3, $4, now() + interval '48 hours')`,
        [order.id, variant.id, quantity, status],
      );
    await insertReservation(1, 'held');
    await insertReservation(2, 'consumed');
    await insertReservation(2, 'released');
    await expect(insertReservation(0, 'held')).rejects.toEqual(violation(CHECK_VIOLATION, 'reservations_quantity_check'));
    await expect(insertReservation(1, 'lost')).rejects.toEqual(violation(CHECK_VIOLATION, 'reservations_status_check'));
  });
});

describe('seed data', () => {
  test('every governorate has a delivery fee of EGP 70, marked placeholder, matching GOVERNORATES', async () => {
    const { app } = await withTestDb();
    const rows = await app.query<{ governorate: string; fee_piastres: number; cod_enabled: boolean; placeholder: boolean }>(
      `select governorate, fee_piastres, cod_enabled, placeholder from governorate_delivery order by governorate`,
    );
    expect(rows).toHaveLength(27);
    expect(rows.map((r) => r.governorate)).toEqual(GOVERNORATES.map((g) => g.code).sort());
    for (const r of rows) {
      expect(r).toMatchObject({ fee_piastres: 7000, cod_enabled: true, placeholder: true });
    }
  });

  test('the cash-on-delivery confirmation window is 48 hours', async () => {
    const { app } = await withTestDb();
    expect(await app.query(`select value from settings where key = 'cod_confirmation_window_hours'`)).toEqual([
      { value: 48 },
    ]);
  });
});

describe('order numbers', () => {
  test('start at D10001 and count up, one per order, for the owner and the app role alike', async () => {
    const { app, owner } = await withTestDb();
    const customer = await makeCustomer(owner);
    const first = await makeOrder(owner, customer.id);
    const second = await makeOrder(owner, customer.id);
    expect([first.number, second.number]).toEqual(['D10001', 'D10002']);
    const viaApp = await app.query<{ number: string }>(
      `insert into orders (checkout_key, customer_id, recipient_name, recipient_phone, governorate, area, street, building,
                           lang, direction, channel, payment_method, subtotal, discount_total, delivery_fee, total,
                           order_state, payment_state, fulfilment_state)
       select gen_random_uuid(), customer_id, recipient_name, recipient_phone, governorate, area, street, building,
              lang, direction, channel, payment_method, subtotal, discount_total, delivery_fee, total,
              order_state, payment_state, fulfilment_state
         from orders where id = $1 returning number`,
      [first.id],
    );
    expect(viaApp).toEqual([{ number: 'D10003' }]);
  });

  test('an order starts at version 1', async () => {
    const { owner } = await withTestDb();
    const order = await makeOrder(owner, (await makeCustomer(owner)).id);
    expect(await owner.query(`select version from orders where id = $1`, [order.id])).toEqual([{ version: 1 }]);
  });
});

describe('privileges: the app role never deletes', () => {
  const tables = ['customers', 'orders', 'order_lines', 'payments', 'reservations', 'governorate_delivery', 'settings'];

  test.each(tables)('%s: SELECT, INSERT, UPDATE and no DELETE', async (table) => {
    const { owner } = await withTestDb();
    const [p] = await owner.query<Record<string, boolean>>(
      `select has_table_privilege('dose_app', $1, 'SELECT') as sel,
              has_table_privilege('dose_app', $1, 'INSERT') as ins,
              has_table_privilege('dose_app', $1, 'UPDATE') as upd,
              has_table_privilege('dose_app', $1, 'DELETE') as del,
              has_table_privilege('dose_app', $1, 'TRUNCATE') as trunc`,
      [table],
    );
    expect(p).toEqual({ sel: true, ins: true, upd: true, del: false, trunc: false });
  });

  test('the app role can use the order number sequence but cannot delete orders', async () => {
    const { app, owner } = await withTestDb();
    const [p] = await owner.query<{ usable: boolean }>(
      `select has_sequence_privilege('dose_app', 'order_number_seq', 'USAGE') as usable`,
    );
    expect(p?.usable).toBe(true);
    await expect(app.query(`delete from orders`)).rejects.toThrow(/permission denied/);
  });
});

describe('writeAudit', () => {
  test('appends an order event with its entity, version, reason and data', async () => {
    const { app } = await withTestDb();
    await app.transaction((tx) =>
      writeAudit(tx, {
        actor: { type: 'staff', id: 'staff-1' },
        action: 'order.cancelled',
        entity: 'order',
        entityId: 'D10001',
        entityVersion: 2,
        reason: 'customer_request',
        data: { note: 'called twice' },
      }),
    );
    expect(
      await app.query(
        `select actor_type, actor_id, action, entity, entity_id, entity_version, reason, data from audit_events`,
      ),
    ).toEqual([
      {
        actor_type: 'staff',
        actor_id: 'staff-1',
        action: 'order.cancelled',
        entity: 'order',
        entity_id: 'D10001',
        entity_version: 2,
        reason: 'customer_request',
        data: { note: 'called twice' },
      },
    ]);
  });

  test('version, reason and data are optional', async () => {
    const { app } = await withTestDb();
    await app.transaction((tx) =>
      writeAudit(tx, { actor: { type: 'system', id: 'cron' }, action: 'order.created', entity: 'order', entityId: 'D10002' }),
    );
    expect(await app.query(`select entity_version, reason, data from audit_events`)).toEqual([
      { entity_version: null, reason: null, data: {} },
    ]);
  });

  test('is part of the caller transaction: a rollback removes it', async () => {
    const { app } = await withTestDb();
    await expect(
      app.transaction(async (tx) => {
        await writeAudit(tx, { actor: { type: 'system', id: 'x' }, action: 'a', entity: 'order', entityId: 'D1' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await app.query(`select 1 from audit_events`)).toHaveLength(0);
  });
});
