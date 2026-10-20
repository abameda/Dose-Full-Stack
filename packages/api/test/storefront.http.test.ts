import { randomUUID } from 'node:crypto';
import type { BagView, CheckoutInput, ProductView } from '@dose/contract';
import type { Db } from '@dose/core/db';
import { makeProduct, makeVariant } from '@dose/core/test-factories';
import { withTestDb } from '@dose/core/test-harness';
import { expect, test } from 'vitest';
import { makeTestApp, postJson } from './support';

async function arrange() {
  const db = await withTestDb();
  const paradise = await makeProduct(db.owner, {
    slug: 'paradise',
    status: 'published',
    nameAr: 'باراديس',
    nameEn: 'Paradise',
    storyAr: 'قصة باراديس',
    storyEn: 'The story of Paradise',
    labelCopyAr: 'ملصق باراديس',
    labelCopyEn: 'Paradise label',
  });
  const blanc = await makeProduct(db.owner, { slug: 'blanc', status: 'published', nameAr: 'بلان', nameEn: 'Blanc' });
  await makeProduct(db.owner, { slug: 'unreleased', status: 'draft', nameAr: 'غير منشور', nameEn: 'Unreleased' });
  await makeVariant(db.owner, paradise.id, { sku: 'PAR-50', pricePiastres: 150_000, stock: 5 });
  await makeVariant(db.owner, paradise.id, { sku: 'PAR-5', kind: 'sample', sizeMl: 5, pricePiastres: 25_000, stock: 0 });
  await makeVariant(db.owner, blanc.id, { sku: 'BLA-50', pricePiastres: 120_000, stock: 1 });
  await db.owner.query(
    `insert into product_images (product_id, r2_key, alt_ar, alt_en, position) values ($1, $2, $3, $4, 0)`,
    [paradise.id, 'products/paradise/abc123.jpg', 'زجاجة باراديس', 'The Paradise bottle'],
  );
  return { owner: db.owner, app: makeTestApp(db) };
}

function checkoutBody(sku: string, quotedTotal: number, overrides: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    idempotencyKey: randomUUID(),
    lang: 'en',
    direction: 'd0-baseline',
    lines: [{ sku, quantity: 1 }],
    quotedTotal,
    customer: { name: 'Test Customer', phone: '01012345678' },
    address: { governorate: 'cairo', area: 'Nasr City', street: 'Test Street', building: '12' },
    ...overrides,
  };
}

async function orderCount(owner: Db): Promise<number> {
  const [row] = await owner.query<{ n: number }>(`select count(*)::int as n from orders`);
  return row?.n ?? -1;
}

test('GET /api/products?lang=ar returns Arabic names, Latin slugs and no drafts', async () => {
  const { app } = await arrange();
  const res = await app.request('/api/products?lang=ar');
  expect(res.status).toBe(200);
  const products = (await res.json()) as ProductView[];
  expect(products.map((p) => p.slug).sort()).toEqual(['blanc', 'paradise']);
  for (const p of products) expect(p.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  expect(products.find((p) => p.slug === 'paradise')).toEqual({
    slug: 'paradise',
    name: 'باراديس',
    story: 'قصة باراديس',
    labelCopy: 'ملصق باراديس',
    images: [{ src: '/media/products/paradise/abc123.jpg', alt: 'زجاجة باراديس', width: 1200, height: 1500 }],
    variants: [
      { sku: 'PAR-5', kind: 'sample', sizeMl: 5, price: 25_000, available: false },
      { sku: 'PAR-50', kind: 'full', sizeMl: 50, price: 150_000, available: true },
    ],
  });
  expect(products.find((p) => p.slug === 'blanc')?.name).toBe('بلان');
});

test('GET /api/products?lang=en returns English copy', async () => {
  const { app } = await arrange();
  const products = (await (await app.request('/api/products?lang=en')).json()) as ProductView[];
  expect(products.map((p) => p.name).sort()).toEqual(['Blanc', 'Paradise']);
  expect(products.find((p) => p.slug === 'paradise')?.images[0]?.alt).toBe('The Paradise bottle');
});

test('GET /api/products/:slug returns the product, and 404 for a draft or unknown slug', async () => {
  const { app } = await arrange();
  const found = await app.request('/api/products/paradise?lang=en');
  expect(found.status).toBe(200);
  expect(((await found.json()) as ProductView).name).toBe('Paradise');
  expect((await app.request('/api/products/unreleased?lang=en')).status).toBe(404);
  expect((await app.request('/api/products/nope?lang=en')).status).toBe(404);
});

test('a missing or unknown lang is a 400, not a guess', async () => {
  const { app } = await arrange();
  for (const path of ['/api/products', '/api/products?lang=fr', '/api/products/paradise', '/api/products/paradise?lang=']) {
    const res = await app.request(path);
    expect(res.status, path).toBe(400);
  }
});

test('POST /api/bag/quote prices the bag, and reports unknown SKUs as unavailable', async () => {
  const { app } = await arrange();
  const res = await app.request(
    postJson('/api/bag/quote', {
      lang: 'ar',
      governorate: 'cairo',
      lines: [
        { sku: 'PAR-50', quantity: 2 },
        { sku: 'NO-SUCH-SKU', quantity: 1 },
      ],
    }),
  );
  expect(res.status).toBe(200);
  expect((await res.json()) as BagView).toEqual({
    lines: [{ sku: 'PAR-50', name: 'باراديس', unitPrice: 150_000, quantity: 2, lineTotal: 300_000 }],
    subtotal: 300_000,
    deliveryFee: 7_000,
    total: 307_000,
    unavailable: ['NO-SUCH-SKU'],
  });

  const onlyUnknown = await app.request(postJson('/api/bag/quote', { lang: 'en', lines: [{ sku: 'NO-SUCH-SKU', quantity: 1 }] }));
  expect(await onlyUnknown.json()).toEqual({ lines: [], subtotal: 0, deliveryFee: 0, total: 0, unavailable: ['NO-SUCH-SKU'] });
});

test('POST /api/bag/quote refuses a body that fails the schema with 422', async () => {
  const { app } = await arrange();
  const res = await app.request(postJson('/api/bag/quote', { lang: 'en', lines: [{ sku: 'PAR-50', quantity: 11 }] }));
  expect(res.status).toBe(422);
  expect(await res.json()).toEqual({ ok: false, code: 'invalid', fields: ['lines.0.quantity'] });
  const notJson = await app.request(
    new Request('http://dose.test/api/bag/quote', { method: 'POST', body: 'not json', headers: { 'content-type': 'application/json' } }),
  );
  expect(notJson.status).toBe(422);
});

test('POST /api/checkout with a valid body places the order: 201 and an order number', async () => {
  const { app, owner } = await arrange();
  const res = await app.request(postJson('/api/checkout', checkoutBody('PAR-50', 157_000)));
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ ok: true, orderNumber: 'D10001', total: 157_000 });
  expect(await orderCount(owner)).toBe(1);
});

test('the same idempotency key returns the order already placed', async () => {
  const { app, owner } = await arrange();
  const body = checkoutBody('PAR-50', 157_000);
  const first = await app.request(postJson('/api/checkout', body));
  const second = await app.request(postJson('/api/checkout', body));
  expect(second.status).toBe(201);
  expect(await second.json()).toEqual(await first.json());
  expect(await orderCount(owner)).toBe(1);
});

test('a stale quotedTotal is a 409 price_changed carrying the new quote', async () => {
  const { app, owner } = await arrange();
  const res = await app.request(postJson('/api/checkout', checkoutBody('PAR-50', 100_000, { lang: 'ar' })));
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({
    ok: false,
    code: 'price_changed',
    quote: {
      lines: [{ sku: 'PAR-50', name: 'باراديس', unitPrice: 150_000, quantity: 1, lineTotal: 150_000 }],
      subtotal: 150_000,
      deliveryFee: 7_000,
      total: 157_000,
      unavailable: [],
    },
  });
  expect(await orderCount(owner)).toBe(0);
});

test('more than the stock is a 409 out_of_stock naming the SKU', async () => {
  const { app } = await arrange();
  const res = await app.request(
    postJson('/api/checkout', checkoutBody('BLA-50', 2 * 120_000 + 7_000, { lines: [{ sku: 'BLA-50', quantity: 2 }] })),
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ ok: false, code: 'out_of_stock', skus: ['BLA-50'] });
});

test('a request that came from the studio is refused with 403 checkout_disabled and places nothing', async () => {
  const { app, owner } = await arrange();
  const res = await app.request(
    postJson('/api/checkout', checkoutBody('PAR-50', 157_000), { referer: 'https://x/studio/en/products/paradise' }),
  );
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ ok: false, code: 'checkout_disabled' });
  expect(await orderCount(owner)).toBe(0);
});

test('only a /studio/ path counts as the studio', async () => {
  const { app } = await arrange();
  for (const referer of ['https://x/en/products/paradise', 'https://x/studios/en', 'https://x/en/?next=/studio/', 'not a url']) {
    const res = await app.request(postJson('/api/checkout', checkoutBody('PAR-50', 157_000), { referer }));
    expect(res.status, referer).toBe(201);
  }
});

test('a body that fails the schema is a 422 naming the fields, and places nothing', async () => {
  const { app, owner } = await arrange();
  const tooMany = await app.request(
    postJson('/api/checkout', checkoutBody('PAR-50', 157_000, { lines: [{ sku: 'PAR-50', quantity: 11 }] })),
  );
  expect(tooMany.status).toBe(422);
  expect(await tooMany.json()).toEqual({ ok: false, code: 'invalid', fields: ['lines.0.quantity'] });

  const badKey = await app.request(postJson('/api/checkout', { ...checkoutBody('PAR-50', 157_000), idempotencyKey: 'abc' }));
  expect(badKey.status).toBe(422);
  expect(await badKey.json()).toEqual({ ok: false, code: 'invalid', fields: ['idempotencyKey'] });
  expect(await orderCount(owner)).toBe(0);
});

test('a phone number the core rejects is a 422 too', async () => {
  const { app } = await arrange();
  const res = await app.request(
    postJson('/api/checkout', checkoutBody('PAR-50', 157_000, { customer: { name: 'Test Customer', phone: '12345' } })),
  );
  expect(res.status).toBe(422);
  expect(await res.json()).toEqual({ ok: false, code: 'invalid', fields: ['customer.phone'] });
});

test('a body field cannot claim the storefront surface to dodge the studio refusal', async () => {
  const { app } = await arrange();
  const res = await app.request(
    postJson('/api/checkout', { ...checkoutBody('PAR-50', 157_000), surface: 'storefront' }, { referer: 'https://x/studio/ar/' }),
  );
  expect(res.status).toBe(403);
});

test('unknown routes are JSON 404s', async () => {
  const { app } = await arrange();
  const res = await app.request('/api/nope');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'not_found' });
});
