import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { placeCodOrder, quoteBag } from '@dose/core/checkout';
import type { Db, Tx } from '@dose/core/db';
import { confirmOrderInTx } from '@dose/core/order-actions';
import { makeProduct, makeVariant } from '@dose/core/test-factories';
import { withTestDb } from '@dose/core/test-harness';
import { expect, test, vi } from 'vitest';
import type { WebhookProvider } from '../src/app';
import { makeTestApp, NOW } from './support';

const SECRET = 'test-webhook-secret';
const SIGNATURE_HEADER = 'x-test-signature';

type TestEvent = { eventId: string; orderNumber: string };

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** A provider that signs the raw body with HMAC-SHA256, like a real payment provider would. */
const testProvider: WebhookProvider = {
  verify(req, rawBody) {
    const given = Buffer.from(req.headers.get(SIGNATURE_HEADER) ?? '', 'hex');
    const expected = Buffer.from(sign(rawBody), 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return Promise.resolve(null);
    const event = JSON.parse(rawBody) as TestEvent;
    return Promise.resolve({ eventId: event.eventId, payload: event });
  },
  async apply(tx: Tx, payload: unknown) {
    const { orderNumber } = payload as TestEvent;
    const [row] = await tx.query<{ version: number }>(`select version from orders where number = $1`, [orderNumber]);
    if (row === undefined) throw new Error(`no order ${orderNumber}`);
    const outcome = await confirmOrderInTx(tx, {
      orderNumber,
      expectedVersion: row.version,
      actor: { type: 'system', id: 'webhook:test' },
      method: 'phone',
    });
    if (!outcome.ok) throw new Error(`confirm of ${orderNumber} answered ${outcome.code}`);
  },
};

async function arrange() {
  const db = await withTestDb();
  const product = await makeProduct(db.owner, { status: 'published' });
  const variant = await makeVariant(db.owner, product.id, { stock: 10 });
  const lines = [{ sku: variant.sku, quantity: 1 }];
  const quote = await quoteBag(db.app, lines, 'cairo');
  if ('unknownSkus' in quote) throw new Error('unknown SKUs');
  const placed = await placeCodOrder(db.app, {
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
  if (!placed.ok) throw new Error(`expected an order, got ${JSON.stringify(placed)}`);
  const app = makeTestApp(db, { webhookProviders: { test: testProvider } });
  return { owner: db.owner, orderNumber: placed.orderNumber, app };
}

function signedPost(path: string, body: string, signature = sign(body)): Request {
  return new Request(`http://dose.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: signature },
    body,
  });
}

async function orderVersion(owner: Db, number: string): Promise<number | undefined> {
  const [row] = await owner.query<{ version: number }>(`select version from orders where number = $1`, [number]);
  return row?.version;
}

async function receiptCount(owner: Db): Promise<number> {
  const [row] = await owner.query<{ n: number }>(`select count(*)::int as n from webhook_receipts`);
  return row?.n ?? -1;
}

test('the same signed webhook ten times in parallel is applied once', async () => {
  const { app, owner, orderNumber } = await arrange();
  const body = JSON.stringify({ eventId: 'evt-1', orderNumber });
  const responses = await Promise.all(Array.from({ length: 10 }, async () => app.request(signedPost('/api/webhooks/test', body))));
  expect(responses.map((r) => r.status)).toEqual(Array.from({ length: 10 }, () => 200));
  const results = await Promise.all(responses.map(async (r) => (await r.json()) as { result: string }));
  expect(results.filter((r) => r.result === 'applied')).toHaveLength(1);
  expect(results.filter((r) => r.result === 'duplicate')).toHaveLength(9);
  expect(await orderVersion(owner, orderNumber)).toBe(2);
  expect(await receiptCount(owner)).toBe(1);
});

test('a bad signature is a 401 and records nothing', async () => {
  const { app, owner, orderNumber } = await arrange();
  const body = JSON.stringify({ eventId: 'evt-1', orderNumber });
  const wrong = await app.request(signedPost('/api/webhooks/test', body, sign(body, 'some-other-secret')));
  expect(wrong.status).toBe(401);
  const missing = await app.request(new Request('http://dose.test/api/webhooks/test', { method: 'POST', body }));
  expect(missing.status).toBe(401);
  expect(await receiptCount(owner)).toBe(0);
  expect(await orderVersion(owner, orderNumber)).toBe(1);
});

test('a signature over a different body is a 401', async () => {
  const { app, owner, orderNumber } = await arrange();
  const signed = JSON.stringify({ eventId: 'evt-1', orderNumber });
  const tampered = JSON.stringify({ eventId: 'evt-2', orderNumber });
  expect((await app.request(signedPost('/api/webhooks/test', tampered, sign(signed)))).status).toBe(401);
  expect(await receiptCount(owner)).toBe(0);
});

test('an unknown provider is a 404, including names that exist on every object', async () => {
  const { app, owner, orderNumber } = await arrange();
  const body = JSON.stringify({ eventId: 'evt-1', orderNumber });
  for (const name of ['nope', 'constructor', '__proto__', 'toString']) {
    const res = await app.request(signedPost(`/api/webhooks/${name}`, body));
    expect(res.status, name).toBe(404);
  }
  expect(await receiptCount(owner)).toBe(0);
});

test('when applying throws, the answer is a 500 and nothing is recorded, so the provider retries', async () => {
  const { app, owner } = await arrange();
  const body = JSON.stringify({ eventId: 'evt-1', orderNumber: 'D99999' });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const res = await app.request(signedPost('/api/webhooks/test', body));
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: 'internal' });
  expect(await receiptCount(owner)).toBe(0);
});
