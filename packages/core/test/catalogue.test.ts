import { describe, expect, test } from 'vitest';
import { getPublishedProduct, listPublishedProducts } from '../src/catalogue';
import { receiveStock, reserveStock } from '../src/stock';
import { makeProduct, makeVariant } from './factories';
import { withTestDb } from './harness';

describe('catalogue schema', () => {
  test('slugs must be lowercase Latin words joined by single hyphens', async () => {
    const { owner } = await withTestDb();
    for (const slug of ['Oud', 'oud_noir', 'oud--noir', '-oud', 'oud-', 'عود', 'oud noir', '']) {
      await expect(makeProduct(owner, { slug })).rejects.toThrow(/products_slug_check/);
    }
    await makeProduct(owner, { slug: 'oud-noir-2' });
    await expect(makeProduct(owner, { slug: 'oud-noir-2' })).rejects.toThrow(/products_slug_key/);
  });

  test('status, kind, size and price are constrained', async () => {
    const { owner } = await withTestDb();
    const product = await makeProduct(owner);
    await expect(makeProduct(owner, { status: 'live' as 'draft' })).rejects.toThrow(/products_status_check/);
    await expect(makeVariant(owner, product.id, { kind: 'gift' as 'full' })).rejects.toThrow(/variants_kind_check/);
    await expect(makeVariant(owner, product.id, { status: 'gone' as 'active' })).rejects.toThrow(/variants_status_check/);
    await expect(makeVariant(owner, product.id, { sizeMl: 0 })).rejects.toThrow(/variants_size_ml_check/);
    await expect(makeVariant(owner, product.id, { pricePiastres: 0 })).rejects.toThrow(/variants_price_piastres_check/);
    const sku = 'DUP-1';
    await makeVariant(owner, product.id, { sku });
    await expect(makeVariant(owner, product.id, { sku })).rejects.toThrow(/variants_sku_key/);
  });

  test('copy columns are required', async () => {
    const { owner } = await withTestDb();
    await expect(
      owner.query(`insert into products (slug, name_ar, name_en) values ('no-copy', 'a', 'b')`),
    ).rejects.toThrow(/null value/);
  });
});

describe('published catalogue', () => {
  test('lists only published products, with active variants, images in order, and what is available', async () => {
    const { app, owner } = await withTestDb();
    const live = await makeProduct(owner, { slug: 'oud-noir', status: 'published', nameEn: 'Oud Noir', nameAr: 'عود نوار' });
    await makeProduct(owner, { slug: 'unfinished', status: 'draft' });
    const full = await makeVariant(owner, live.id, { sku: 'ON-50', kind: 'full', sizeMl: 50, pricePiastres: 250_000, stock: 5 });
    await makeVariant(owner, live.id, { sku: 'ON-OLD', status: 'archived', stock: 5 });
    const sample = await makeVariant(owner, live.id, { sku: 'ON-2', kind: 'sample', sizeMl: 2, pricePiastres: 15_000, stock: 0 });
    await owner.query(
      `insert into product_images (product_id, r2_key, alt_ar, alt_en, position) values
         ($1, 'b.jpg', 'ب', 'second', 2), ($1, 'a.jpg', 'أ', 'first', 1)`,
      [live.id],
    );
    await app.transaction((tx) =>
      reserveStock(tx, { variantId: full.id, quantity: 2, sourceKey: 'cart:1', actor: { type: 'customer', id: 'c1' } }),
    );

    const products = await listPublishedProducts(app);
    expect(products).toHaveLength(1);
    expect(products[0]).toEqual({
      id: live.id,
      slug: 'oud-noir',
      nameAr: 'عود نوار',
      nameEn: 'Oud Noir',
      storyAr: 'قصة تجريبية',
      storyEn: 'A test story',
      labelCopyAr: 'نص الملصق',
      labelCopyEn: 'Label copy',
      images: [
        { id: expect.any(String) as string, r2Key: 'a.jpg', altAr: 'أ', altEn: 'first', position: 1 },
        { id: expect.any(String) as string, r2Key: 'b.jpg', altAr: 'ب', altEn: 'second', position: 2 },
      ],
      variants: [
        { id: sample.id, sku: 'ON-2', kind: 'sample', sizeMl: 2, pricePiastres: 15_000, available: 0 },
        { id: full.id, sku: 'ON-50', kind: 'full', sizeMl: 50, pricePiastres: 250_000, available: 3 },
      ],
    });
  });

  test('getPublishedProduct finds a published product by slug and nothing else', async () => {
    const { app, owner } = await withTestDb();
    const live = await makeProduct(owner, { slug: 'amber', status: 'published' });
    await makeProduct(owner, { slug: 'draft-one', status: 'draft' });
    await makeVariant(owner, live.id, { stock: 4 });
    const found = await getPublishedProduct(app, 'amber');
    expect(found?.slug).toBe('amber');
    expect(found?.variants.map((v) => v.available)).toEqual([4]);
    expect(await getPublishedProduct(app, 'draft-one')).toBeNull();
    expect(await getPublishedProduct(app, 'missing')).toBeNull();
  });

  test('available follows stock movements', async () => {
    const { app, owner } = await withTestDb();
    const live = await makeProduct(owner, { slug: 'musk', status: 'published' });
    const variant = await makeVariant(owner, live.id, { stock: 0 });
    expect((await getPublishedProduct(app, 'musk'))?.variants[0]?.available).toBe(0);
    await app.transaction((tx) =>
      receiveStock(tx, { variantId: variant.id, quantity: 7, sourceKey: 'receipt:1', actor: { type: 'staff', id: 's' } }),
    );
    expect((await getPublishedProduct(app, 'musk'))?.variants[0]?.available).toBe(7);
  });

  test('a published product with no variants or images still lists', async () => {
    const { app, owner } = await withTestDb();
    await makeProduct(owner, { slug: 'bare', status: 'published' });
    const [product] = await listPublishedProducts(app);
    expect(product).toMatchObject({ slug: 'bare', variants: [], images: [] });
  });
});
