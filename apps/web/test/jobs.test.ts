import { randomUUID } from 'node:crypto';
import { placeCodOrder } from '@dose/core/checkout';
import { enqueue, type OutboxHandler } from '@dose/core/outbox';
import { makeProduct, makeVariant } from '@dose/core/test-factories';
import { withTestDb } from '@dose/core/test-harness';
import { expect, test } from 'vitest';
import { MAX_DELIVERIES_PER_RUN, runCron } from '../src/jobs';

const NOW = new Date('2026-10-20T10:00:00.000Z');
const HOUR_MS = 3_600_000;

function countingHandler(): OutboxHandler & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    lookup: () => Promise.resolve(null),
    send: (_payload, dedupeKey) => {
      sent.push(dedupeKey);
      return Promise.resolve(`ref-${dedupeKey}`);
    },
  };
}

test('cancels orders past their confirmation window', async () => {
  const db = await withTestDb();
  const product = await makeProduct(db.owner, { status: 'published' });
  const variant = await makeVariant(db.owner, product.id);
  const placed = await placeCodOrder(db.app, {
    idempotencyKey: randomUUID(),
    lang: 'en',
    direction: 'd0-baseline',
    surface: 'storefront',
    lines: [{ sku: variant.sku, quantity: 1 }],
    quotedTotal: variant.pricePiastres + 7_000,
    customer: { name: 'Test Customer', phone: '01012345678' },
    address: { governorate: 'cairo', area: 'Nasr City', street: 'Test Street', building: '12' },
    now: NOW,
  });
  if (!placed.ok) throw new Error(`expected an order, got ${JSON.stringify(placed)}`);

  expect(await runCron(db.app, {}, new Date(NOW.getTime() + 47 * HOUR_MS))).toEqual({ expired: [], delivered: 0 });
  expect(await runCron(db.app, {}, new Date(NOW.getTime() + 49 * HOUR_MS))).toEqual({
    expired: [placed.orderNumber],
    delivered: 0,
  });
});

test('delivers waiting messages until none is left', async () => {
  const db = await withTestDb();
  await db.app.transaction(async (tx) => {
    for (const n of [1, 2, 3]) await enqueue(tx, { kind: 'test', dedupeKey: `m${String(n)}`, payload: { n } });
  });
  const handler = countingHandler();

  expect(await runCron(db.app, { test: handler }, NOW)).toEqual({ expired: [], delivered: 3 });
  expect(handler.sent).toEqual(['m1', 'm2', 'm3']);
  expect(await runCron(db.app, { test: handler }, NOW)).toEqual({ expired: [], delivered: 0 });
});

test(`delivers at most ${String(MAX_DELIVERIES_PER_RUN)} messages per run`, async () => {
  const db = await withTestDb();
  const total = MAX_DELIVERIES_PER_RUN + 5;
  await db.app.transaction(async (tx) => {
    for (let n = 0; n < total; n++) await enqueue(tx, { kind: 'test', dedupeKey: `m${String(n)}`, payload: { n } });
  });
  const handler = countingHandler();

  expect((await runCron(db.app, { test: handler }, NOW)).delivered).toBe(MAX_DELIVERIES_PER_RUN);
  expect((await runCron(db.app, { test: handler }, NOW)).delivered).toBe(5);
});

test('stops at once when only messages without a handler are waiting', async () => {
  const db = await withTestDb();
  await db.app.transaction((tx) => enqueue(tx, { kind: 'bosta', dedupeKey: 'b1', payload: {} }));
  expect(await runCron(db.app, {}, NOW)).toEqual({ expired: [], delivered: 0 });
});
