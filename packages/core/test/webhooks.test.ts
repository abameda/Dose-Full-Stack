import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { placeCodOrder, quoteBag } from '../src/checkout';
import type { Db, Tx } from '../src/db';
import { confirmOrderInTx } from '../src/order-actions';
import type { Actor } from '../src/stock';
import { ingestEvent } from '../src/webhooks';
import { makeProduct, makeVariant } from './factories';
import { withTestDb } from './harness';

const NOW = new Date('2026-10-20T10:00:00.000Z');
const provider: Actor = { type: 'system', id: 'webhook:test' };

async function arrange() {
  const db = await withTestDb();
  const product = await makeProduct(db.owner, { status: 'published' });
  const variant = await makeVariant(db.owner, product.id, { stock: 10 });

  /** Places a one-unit cash-on-delivery order through the real checkout. */
  async function placeTestOrder(): Promise<{ number: string }> {
    const lines = [{ sku: variant.sku, quantity: 1 }];
    const quote = await quoteBag(db.app, lines, 'cairo');
    if ('unknownSkus' in quote) throw new Error(`unknown SKUs ${quote.unknownSkus.join(', ')}`);
    const outcome = await placeCodOrder(db.app, {
      idempotencyKey: randomUUID(),
      lang: 'en',
      direction: 'd0-baseline',
      surface: 'storefront',
      lines,
      quotedTotal: quote.total,
      customer: { name: 'Test Customer', phone: '01012345678' },
      address: { governorate: 'cairo', area: 'Nasr City', street: 'Test Street', building: '12' },
      now: NOW,
    });
    if (!outcome.ok) throw new Error(`expected an order, got ${JSON.stringify(outcome)}`);
    return { number: outcome.orderNumber };
  }

  return { ...db, placeTestOrder };
}

/** The confirm a provider event would trigger: at the order's current version, inside the event's transaction. */
async function confirmInTx(tx: Tx, orderNumber: string): Promise<void> {
  const [row] = await tx.query<{ version: number }>(`select version from orders where number = $1`, [orderNumber]);
  if (row === undefined) throw new Error(`no order ${orderNumber}`);
  const outcome = await confirmOrderInTx(tx, { orderNumber, expectedVersion: row.version, actor: provider, method: 'phone' });
  if (!outcome.ok) throw new Error(`confirm of ${orderNumber} answered ${outcome.code}`);
}

async function orderVersion(owner: Db, number: string): Promise<number | undefined> {
  const [row] = await owner.query<{ version: number }>(`select version from orders where number = $1`, [number]);
  return row?.version;
}

async function auditCount(owner: Db, number: string, action: string): Promise<number> {
  const rows = await owner.query(`select 1 from audit_events where entity = 'order' and entity_id = $1 and action = $2`, [number, action]);
  return rows.length;
}

async function receipts(owner: Db) {
  return owner.query<{ provider: string; event_id: string; payload: unknown }>(
    `select provider, event_id, payload from webhook_receipts order by id`,
  );
}

test('the same webhook ten times in parallel changes state once', async () => {
  const { app, owner, placeTestOrder } = await arrange();
  const order = await placeTestOrder();
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      ingestEvent(app, { provider: 'test', eventId: 'evt-1', payload: { orderNumber: order.number } }, (tx, p) =>
        confirmInTx(tx, p.orderNumber),
      ),
    ),
  );
  expect(results.filter((r) => r === 'applied')).toHaveLength(1);
  expect(results.filter((r) => r === 'duplicate')).toHaveLength(9);
  expect(await orderVersion(owner, order.number)).toBe(2);
  expect(await auditCount(owner, order.number, 'order.confirmed')).toBe(1);
  expect(await receipts(owner)).toEqual([{ provider: 'test', event_id: 'evt-1', payload: { orderNumber: order.number } }]);
});

test('a failed apply does not record the event, so a retry applies it', async () => {
  const { app, owner, placeTestOrder } = await arrange();
  const order = await placeTestOrder();
  let calls = 0;
  const flaky = async (tx: Tx, p: { orderNumber: string }) => {
    calls += 1;
    // The confirm runs first, so the throw also proves its changes roll back with the receipt.
    await confirmInTx(tx, p.orderNumber);
    if (calls === 1) throw new Error('downstream unavailable');
  };
  const event = { provider: 'test', eventId: 'evt-1', payload: { orderNumber: order.number } };

  await expect(ingestEvent(app, event, flaky)).rejects.toThrow('downstream unavailable');
  expect(await receipts(owner)).toEqual([]);
  expect(await orderVersion(owner, order.number)).toBe(1);
  expect(await auditCount(owner, order.number, 'order.confirmed')).toBe(0);

  expect(await ingestEvent(app, event, flaky)).toBe('applied');
  expect(await ingestEvent(app, event, flaky)).toBe('duplicate');
  expect(calls).toBe(2);
  expect(await orderVersion(owner, order.number)).toBe(2);
  expect(await auditCount(owner, order.number, 'order.confirmed')).toBe(1);
});

test('out-of-order distinct events each apply once', async () => {
  const { app, owner, placeTestOrder } = await arrange();
  const first = await placeTestOrder();
  const second = await placeTestOrder();
  const ingest = (eventId: string, orderNumber: string) =>
    ingestEvent(app, { provider: 'test', eventId, payload: { orderNumber } }, (tx, p) => confirmInTx(tx, p.orderNumber));

  // evt-2 arrives before evt-1, then the provider redelivers both.
  expect(await ingest('evt-2', second.number)).toBe('applied');
  expect(await ingest('evt-1', first.number)).toBe('applied');
  expect(await ingest('evt-2', second.number)).toBe('duplicate');
  expect(await ingest('evt-1', first.number)).toBe('duplicate');

  for (const o of [first, second]) {
    expect(await orderVersion(owner, o.number)).toBe(2);
    expect(await auditCount(owner, o.number, 'order.confirmed')).toBe(1);
  }
  expect((await receipts(owner)).map((r) => r.event_id)).toEqual(['evt-2', 'evt-1']);
});

test('the same event id from two providers is two events', async () => {
  const { app, owner } = await arrange();
  const noop = () => Promise.resolve();
  expect(await ingestEvent(app, { provider: 'paymob', eventId: 'evt-1', payload: {} }, noop)).toBe('applied');
  expect(await ingestEvent(app, { provider: 'bosta', eventId: 'evt-1', payload: {} }, noop)).toBe('applied');
  expect(await receipts(owner)).toHaveLength(2);
});

test('the app role can record and read webhook receipts but never change or delete them', async () => {
  const { app, owner } = await arrange();
  const [p] = await owner.query<Record<string, boolean>>(
    `select has_table_privilege('dose_app', 'webhook_receipts', 'SELECT') as sel,
            has_table_privilege('dose_app', 'webhook_receipts', 'INSERT') as ins,
            has_table_privilege('dose_app', 'webhook_receipts', 'UPDATE') as upd,
            has_table_privilege('dose_app', 'webhook_receipts', 'DELETE') as del,
            has_table_privilege('dose_app', 'webhook_receipts', 'TRUNCATE') as trunc,
            has_sequence_privilege('dose_app', 'webhook_receipts_id_seq', 'USAGE') as seq`,
  );
  expect(p).toEqual({ sel: true, ins: true, upd: false, del: false, trunc: false, seq: true });
  await expect(app.query(`update webhook_receipts set payload = '{}'::jsonb`)).rejects.toThrow(/permission denied/);
  await expect(app.query(`delete from webhook_receipts`)).rejects.toThrow(/permission denied/);
});
