import { expect, test } from 'vitest';
import type { Db } from '../src/db';
import { deliverNext, enqueue, type OutboxHandler } from '../src/outbox';
import { withTestDb } from './harness';

const NOW = new Date('2026-10-20T10:00:00.000Z');
const LEASE_MS = 60_000;
const afterLease = (from: Date) => new Date(from.getTime() + LEASE_MS + 1_000);

/**
 * A provider that remembers what it accepted, keyed by dedupe key (as Bosta keeps the order
 * reference), and a handler over it. `failures` decides, per `send` call, whether that call
 * crashes before the provider accepts the message, after it, or not at all.
 */
function fakeProvider(failures: ('before' | 'after' | 'none')[] = []) {
  const accepted = new Map<string, unknown>();
  let sendCalls = 0;
  let lookups = 0;
  const handler: OutboxHandler = {
    lookup(dedupeKey) {
      lookups += 1;
      return Promise.resolve(accepted.has(dedupeKey) ? `ref-${dedupeKey}` : null);
    },
    send(payload, dedupeKey) {
      const failure = failures[sendCalls] ?? 'none';
      sendCalls += 1;
      if (failure === 'before') return Promise.reject(new Error('crashed before sending'));
      accepted.set(dedupeKey, payload);
      if (failure === 'after') return Promise.reject(new Error('crashed after the provider accepted it'));
      return Promise.resolve(`ref-${dedupeKey}`);
    },
  };
  return {
    handler,
    accepted,
    sendCalls: () => sendCalls,
    lookups: () => lookups,
  };
}

async function enqueueOne(app: Db, dedupeKey: string, payload: unknown = { dedupeKey }, kind = 'shipment') {
  await app.transaction((tx) => enqueue(tx, { kind, dedupeKey, payload }));
}

async function rows(owner: Db) {
  return owner.query<{ dedupe_key: string; status: string; attempts: number; provider_ref: string | null; payload: unknown }>(
    `select dedupe_key, status, attempts, provider_ref, payload from outbox order by id`,
  );
}

test('a worker killed between saving and sending sends once', async () => {
  const { app, owner } = await withTestDb();
  const provider = fakeProvider(['after']);
  await enqueueOne(app, 'D10001');

  await expect(deliverNext(app, { shipment: provider.handler }, NOW)).rejects.toThrow('crashed after the provider accepted it');
  expect(await rows(owner)).toMatchObject([{ status: 'claimed', attempts: 1, provider_ref: null }]);
  // While the lease holds, no other worker picks the message up.
  expect(await deliverNext(app, { shipment: provider.handler }, new Date(NOW.getTime() + 30_000))).toBe('idle');

  expect(await deliverNext(app, { shipment: provider.handler }, afterLease(NOW))).toBe('reconciled');
  expect(provider.sendCalls()).toBe(1);
  expect(provider.lookups()).toBe(1);
  expect(await rows(owner)).toMatchObject([{ status: 'done', attempts: 2, provider_ref: 'ref-D10001' }]);
  expect(await deliverNext(app, { shipment: provider.handler }, afterLease(afterLease(NOW)))).toBe('idle');
});

test('a crash before sending retries the send', async () => {
  const { app, owner } = await withTestDb();
  const provider = fakeProvider(['before']);
  await enqueueOne(app, 'D10001');

  await expect(deliverNext(app, { shipment: provider.handler }, NOW)).rejects.toThrow('crashed before sending');
  expect(provider.accepted.size).toBe(0);

  expect(await deliverNext(app, { shipment: provider.handler }, afterLease(NOW))).toBe('delivered');
  expect(provider.sendCalls()).toBe(2);
  expect(provider.lookups()).toBe(1);
  expect([...provider.accepted.keys()]).toEqual(['D10001']);
  expect(await rows(owner)).toMatchObject([{ status: 'done', attempts: 2, provider_ref: 'ref-D10001' }]);
});

test('a first delivery sends without looking up', async () => {
  const { app, owner } = await withTestDb();
  const provider = fakeProvider();
  await enqueueOne(app, 'D10001', { orderNumber: 'D10001', cod: 157_000 });

  expect(await deliverNext(app, { shipment: provider.handler }, NOW)).toBe('delivered');
  expect(provider.lookups()).toBe(0);
  expect(provider.accepted.get('D10001')).toEqual({ orderNumber: 'D10001', cod: 157_000 });
  expect(await rows(owner)).toMatchObject([{ status: 'done', attempts: 1, provider_ref: 'ref-D10001' }]);
});

test('two workers never claim the same message', async () => {
  const { app, owner } = await withTestDb();
  const provider = fakeProvider();
  for (let i = 1; i <= 5; i += 1) await enqueueOne(app, `D1000${String(i)}`);

  const results = await Promise.all(Array.from({ length: 20 }, () => deliverNext(app, { shipment: provider.handler }, NOW)));
  expect(results.filter((r) => r === 'delivered')).toHaveLength(5);
  expect(results.filter((r) => r === 'idle')).toHaveLength(15);
  expect(provider.sendCalls()).toBe(5);
  expect([...provider.accepted.keys()].sort()).toEqual(['D10001', 'D10002', 'D10003', 'D10004', 'D10005']);
  for (const row of await rows(owner)) expect(row).toMatchObject({ status: 'done', attempts: 1 });
});

test('enqueue with the same dedupe key keeps one message', async () => {
  const { app, owner } = await withTestDb();
  await enqueueOne(app, 'D10001', { version: 1 });
  await enqueueOne(app, 'D10001', { version: 2 });
  expect(await rows(owner)).toEqual([{ dedupe_key: 'D10001', status: 'pending', attempts: 0, provider_ref: null, payload: { version: 1 } }]);
});

test('an enqueue rolls back with the transaction it belongs to', async () => {
  const { app, owner } = await withTestDb();
  await expect(
    app.transaction(async (tx) => {
      await enqueue(tx, { kind: 'shipment', dedupeKey: 'D10001', payload: {} });
      throw new Error('the order change failed');
    }),
  ).rejects.toThrow('the order change failed');
  expect(await rows(owner)).toEqual([]);
});

test('a message with no handler is left pending', async () => {
  const { app, owner } = await withTestDb();
  expect(await deliverNext(app, {}, NOW)).toBe('idle');
  await enqueueOne(app, 'D10001');

  expect(await deliverNext(app, {}, NOW)).toBe('no_handler');
  expect(await deliverNext(app, { email: fakeProvider().handler }, NOW)).toBe('no_handler');
  expect(await rows(owner)).toMatchObject([{ status: 'pending', attempts: 0 }]);
});

test('the app role can work the outbox but never delete from it', async () => {
  const { app, owner } = await withTestDb();
  const [p] = await owner.query<Record<string, boolean>>(
    `select has_table_privilege('dose_app', 'outbox', 'SELECT') as sel,
            has_table_privilege('dose_app', 'outbox', 'INSERT') as ins,
            has_table_privilege('dose_app', 'outbox', 'UPDATE') as upd,
            has_table_privilege('dose_app', 'outbox', 'DELETE') as del,
            has_table_privilege('dose_app', 'outbox', 'TRUNCATE') as trunc,
            has_sequence_privilege('dose_app', 'outbox_id_seq', 'USAGE') as seq`,
  );
  expect(p).toEqual({ sel: true, ins: true, upd: true, del: false, trunc: false, seq: true });
  await expect(app.query(`delete from outbox`)).rejects.toThrow(/permission denied/);
});
