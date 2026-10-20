import { randomUUID } from 'node:crypto';
import type { AuditPage, CheckoutResult, OrderActionResult, OrderDetail, OrderSummary, TodayView } from '@dose/contract';
import { makeProduct, makeVariant } from '@dose/core/test-factories';
import { withTestDb } from '@dose/core/test-harness';
import { expect, test } from 'vitest';
import { createAccessVerifier, findActiveStaff } from '../src/auth';
import { makeTestApp, NOW, postJson } from './support';

const OPS_EMAIL = 'ops@example.test';
const OWNER_EMAIL = 'owner@example.test';
const ACCOUNTANT_EMAIL = 'accounts@example.test';
const MINUTE_MS = 60_000;

/**
 * A database with one product on sale and three staff, and an app on a clock the test can move.
 * Staff sign in with the local-only `X-Dev-Staff-Email` header through the real verifier and lookup.
 */
async function arrange() {
  const db = await withTestDb();
  const product = await makeProduct(db.owner, { slug: 'paradise', status: 'published', nameAr: 'باراديس', nameEn: 'Paradise' });
  await makeVariant(db.owner, product.id, { sku: 'PAR-50', pricePiastres: 150_000, stock: 5 });
  await db.owner.query(
    `insert into staff (email, name, role) values
       ($1, 'Olivia Operations', 'operations'), ($2, 'Omar Owner', 'owner'), ($3, 'Amal Accounts', 'accountant')`,
    [OPS_EMAIL, OWNER_EMAIL, ACCOUNTANT_EMAIL],
  );

  const clock = { now: NOW };
  const app = makeTestApp(db, {
    env: 'local',
    now: () => clock.now,
    verifyStaff: createAccessVerifier({
      teamDomain: 'dose-test.cloudflareaccess.com',
      audience: 'test-access-audience',
      // Never consulted: these requests carry no Access token.
      jwks: () => Promise.reject(new Error('no Access tokens in this test')),
      env: 'local',
      lookup: (email) => findActiveStaff(db.app, email),
    }),
  });

  const as = (email: string) => ({ 'X-Dev-Staff-Email': email });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the response shape it expects
  const get = async <T>(path: string, email = OPS_EMAIL) => {
    const res = await app.request(path, { headers: as(email) });
    return { res, body: (await res.json()) as T };
  };
  const post = async (path: string, body: unknown, email = OPS_EMAIL) => {
    const res = await app.request(postJson(path, body, as(email)));
    return { res, body: (await res.json()) as OrderActionResult };
  };

  async function placeOrder(phone = '+201012345678'): Promise<string> {
    const res = await app.request(
      postJson('/api/checkout', {
        idempotencyKey: randomUUID(),
        lang: 'ar',
        direction: 'd0-baseline',
        lines: [{ sku: 'PAR-50', quantity: 1 }],
        quotedTotal: 157_000,
        customer: { name: 'Test Customer', phone },
        address: { governorate: 'cairo', area: 'Nasr City', street: 'Test Street', building: '12' },
      }),
    );
    const result = (await res.json()) as CheckoutResult;
    if (!result.ok) throw new Error(`checkout refused: ${result.code}`);
    return result.orderNumber;
  }

  return { db, app, clock, get, post, placeOrder };
}

test('a placed order is on Today, waiting since it was placed', async () => {
  const { clock, get, placeOrder } = await arrange();
  const number = await placeOrder();
  clock.now = new Date(NOW.getTime() + 90 * MINUTE_MS);

  const { res, body } = await get<TodayView>('/api/admin/today');
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('private, no-store');
  expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  expect(body.toConfirm.count).toBe(1);
  expect(body.toConfirm.oldestWaitingMinutes).toBe(90);
  expect(body.toConfirm.orders).toEqual([
    {
      number,
      createdAt: NOW.toISOString(),
      customerName: 'Test Customer',
      customerPhone: '+201012345678',
      governorate: 'cairo',
      total: 157_000,
      orderState: 'pending',
      paymentState: 'awaiting_collection',
      fulfilmentState: 'unfulfilled',
      version: 1,
    } satisfies OrderSummary,
  ]);
});

test('Today with nothing to confirm has no oldest waiting time', async () => {
  const { get } = await arrange();
  const { body } = await get<TodayView>('/api/admin/today');
  expect(body).toEqual({ toConfirm: { count: 0, oldestWaitingMinutes: null, orders: [] } });
});

test('confirming at the current version records who confirmed it, after the customer placed it', async () => {
  const { get, post, placeOrder } = await arrange();
  const number = await placeOrder();

  const confirmed = await post(`/api/admin/orders/${number}/confirm`, { expectedVersion: 1, method: 'whatsapp' });
  expect(confirmed.res.status).toBe(200);
  expect(confirmed.res.headers.get('cache-control')).toBe('private, no-store');
  expect(confirmed.body).toEqual({ ok: true, version: 2 });

  const { res, body } = await get<OrderDetail>(`/api/admin/orders/${number}`);
  expect(res.status).toBe(200);
  expect(body).toMatchObject({
    number,
    orderState: 'confirmed',
    paymentState: 'awaiting_collection',
    version: 2,
    lang: 'ar',
    customerName: 'Test Customer',
    customerPhone: '+201012345678',
    address: { governorate: 'cairo', area: 'Nasr City', street: 'Test Street', building: '12' },
    lines: [{ sku: 'PAR-50', nameAr: 'باراديس', nameEn: 'Paradise', unitPrice: 150_000, quantity: 1, lineDiscount: 0, lineTotal: 150_000 }],
    subtotal: 150_000,
    discountTotal: 0,
    deliveryFee: 7_000,
    total: 157_000,
  });
  expect(body.address).not.toHaveProperty('landmark');
  expect(body.timeline.map(({ actorType, actorLabel, action, method }) => ({ actorType, actorLabel, action, method }))).toEqual([
    { actorType: 'customer', actorLabel: '+201012345678', action: 'order.placed', method: undefined },
    { actorType: 'staff', actorLabel: 'Olivia Operations', action: 'order.confirmed', method: 'whatsapp' },
  ]);
  for (const entry of body.timeline) expect(new Date(entry.at).toISOString()).toBe(entry.at);

  // It has left the queue.
  expect((await get<TodayView>('/api/admin/today')).body.toConfirm.count).toBe(0);
});

test('confirming at a stale version is a 409 with the current state, and changes nothing', async () => {
  const { get, post, placeOrder } = await arrange();
  const number = await placeOrder();
  expect((await post(`/api/admin/orders/${number}/confirm`, { expectedVersion: 1, method: 'phone' })).res.status).toBe(200);

  const stale = await post(`/api/admin/orders/${number}/confirm`, { expectedVersion: 1, method: 'whatsapp' });
  expect(stale.res.status).toBe(409);
  expect(stale.body).toEqual({ ok: false, code: 'conflict', current: { orderState: 'confirmed', version: 2 } });

  const staleCancel = await post(`/api/admin/orders/${number}/cancel`, { expectedVersion: 1, reason: 'duplicate' });
  expect(staleCancel.res.status).toBe(409);
  const detail = await get<OrderDetail>(`/api/admin/orders/${number}`);
  expect(detail.body.timeline.map((e) => e.action)).toEqual(['order.placed', 'order.confirmed']);
});

test('cancelling for "other" without a note is a 422 and the order stays pending', async () => {
  const { get, post, placeOrder } = await arrange();
  const number = await placeOrder();

  for (const body of [
    { expectedVersion: 1, reason: 'other' },
    { expectedVersion: 1, reason: 'other', note: '   ' },
  ]) {
    const refused = await post(`/api/admin/orders/${number}/cancel`, body);
    expect(refused.res.status).toBe(422);
    expect(refused.body).toEqual({ ok: false, code: 'invalid', fields: ['note'] });
  }
  expect((await get<OrderDetail>(`/api/admin/orders/${number}`)).body.orderState).toBe('pending');

  const cancelled = await post(`/api/admin/orders/${number}/cancel`, { expectedVersion: 1, reason: 'other', note: 'Asked by email' });
  expect(cancelled.res.status).toBe(200);
  const detail = (await get<OrderDetail>(`/api/admin/orders/${number}`)).body;
  expect(detail).toMatchObject({ orderState: 'cancelled', paymentState: 'voided', version: 2 });
  expect(detail.timeline[1]).toMatchObject({ actorLabel: 'Olivia Operations', action: 'order.cancelled', reason: 'other', note: 'Asked by email' });
});

test('malformed confirm and cancel bodies are 422 naming the fields; an unknown order is 404', async () => {
  const { post, placeOrder } = await arrange();
  const number = await placeOrder();

  const badConfirm = await post(`/api/admin/orders/${number}/confirm`, { expectedVersion: 0, method: 'carrier-pigeon' });
  expect(badConfirm.res.status).toBe(422);
  expect(badConfirm.body).toEqual({ ok: false, code: 'invalid', fields: ['expectedVersion', 'method'] });

  const badCancel = await post(`/api/admin/orders/${number}/cancel`, { expectedVersion: 1, reason: 'bored' });
  expect(badCancel.res.status).toBe(422);

  const notJson = await post(`/api/admin/orders/${number}/confirm`, undefined);
  expect(notJson.res.status).toBe(422);

  const unknown = await post('/api/admin/orders/D99999/confirm', { expectedVersion: 1, method: 'phone' });
  expect(unknown.res.status).toBe(404);
  expect(unknown.body).toEqual({ ok: false, code: 'not_found' });
});

test('GET /api/admin/orders/:number of an unknown order is 404', async () => {
  const { get } = await arrange();
  expect((await get('/api/admin/orders/D99999')).res.status).toBe(404);
});

test('searching orders by a phone as typed finds the order placed with +20', async () => {
  const { get, placeOrder } = await arrange();
  const number = await placeOrder('+201012345678');
  await placeOrder('+201198765432');

  for (const q of ['01012345678', '٠١٠١٢٣٤٥٦٧٨', '+20 101 234 5678']) {
    const { res, body } = await get<OrderSummary[]>(`/api/admin/orders?q=${encodeURIComponent(q)}`);
    expect(res.status).toBe(200);
    expect(body.map((o) => o.number), q).toEqual([number]);
  }
});

test('searching orders by order number, filtering by state, and listing newest first', async () => {
  const { clock, get, post, placeOrder } = await arrange();
  const first = await placeOrder('+201012345678');
  clock.now = new Date(NOW.getTime() + MINUTE_MS);
  const second = await placeOrder('+201198765432');
  await post(`/api/admin/orders/${second}/confirm`, { expectedVersion: 1, method: 'phone' });

  expect((await get<OrderSummary[]>(`/api/admin/orders?q=${first.toLowerCase()}`)).body.map((o) => o.number)).toEqual([first]);
  expect((await get<OrderSummary[]>('/api/admin/orders?q=nothing-like-this')).body).toEqual([]);
  expect((await get<OrderSummary[]>('/api/admin/orders')).body.map((o) => o.number)).toEqual([second, first]);
  expect((await get<OrderSummary[]>('/api/admin/orders?state=pending')).body.map((o) => o.number)).toEqual([first]);
  expect((await get<OrderSummary[]>('/api/admin/orders?state=confirmed&q=01198765432')).body.map((o) => o.number)).toEqual([second]);
  expect((await get('/api/admin/orders?state=shipped')).res.status).toBe(400);
});

test('an accountant reads orders but cannot confirm them', async () => {
  const { get, post, placeOrder } = await arrange();
  const number = await placeOrder();
  expect((await get<OrderDetail>(`/api/admin/orders/${number}`, ACCOUNTANT_EMAIL)).res.status).toBe(200);
  const refused = await post(`/api/admin/orders/${number}/confirm`, { expectedVersion: 1, method: 'phone' }, ACCOUNTANT_EMAIL);
  expect(refused.res.status).toBe(403);
});

test('GET /api/admin/me is the signed-in staff member', async () => {
  const { get } = await arrange();
  const { res, body } = await get<{ email: string; name: string; role: string }>('/api/admin/me', OWNER_EMAIL);
  expect(res.status).toBe(200);
  expect(body).toMatchObject({ email: OWNER_EMAIL, name: 'Omar Owner', role: 'owner' });
});

test('the owner reads the audit log newest first, a page at a time', async () => {
  const { db, get, post, placeOrder } = await arrange();
  const number = await placeOrder();
  await post(`/api/admin/orders/${number}/confirm`, { expectedVersion: 1, method: 'whatsapp' });

  const firstPage = await get<AuditPage>('/api/admin/audit', OWNER_EMAIL);
  expect(firstPage.res.status).toBe(200);
  expect(firstPage.body.nextCursor).toBeNull();
  expect(firstPage.body.events.map((e) => [e.action, e.actorType, e.actorLabel, e.entityId, e.entityVersion])).toEqual([
    ['order.confirmed', 'staff', 'Olivia Operations', number, 2],
    ['order.placed', 'customer', '+201012345678', number, 1],
  ]);
  expect(firstPage.body.events[0]).toMatchObject({ actorId: OPS_EMAIL, data: { method: 'whatsapp' } });

  // 60 more events: a full page of 50, then the remaining 12.
  await db.owner.query(
    `insert into audit_events (actor_type, actor_id, action, entity, entity_id)
     select 'system', 'test', 'test.event', 'test', g::text from generate_series(1, 60) g`,
  );
  const page1 = await get<AuditPage>('/api/admin/audit', OWNER_EMAIL);
  expect(page1.body.events).toHaveLength(50);
  expect(page1.body.events[0]?.entityId).toBe('60');
  expect(page1.body.nextCursor).not.toBeNull();
  const page2 = await get<AuditPage>(`/api/admin/audit?cursor=${String(page1.body.nextCursor)}`, OWNER_EMAIL);
  expect(page2.body.events).toHaveLength(12);
  expect(page2.body.events.at(-1)?.action).toBe('order.placed');
  expect(page2.body.nextCursor).toBeNull();

  expect((await get('/api/admin/audit?cursor=abc', OWNER_EMAIL)).res.status).toBe(400);
  expect((await get('/api/admin/audit', OPS_EMAIL)).res.status).toBe(403);
});
