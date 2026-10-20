import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { listPublishedProducts } from '../src/catalogue';
import { checkRules } from '../src/rules';
import { withTestDb } from '../test/harness';
import { imageKey, prepareImage, PRODUCT_IMAGE_SIZE, SEED_PRODUCTS, seedCatalogue, type MediaStore } from './catalogue';

/** Keeps what was uploaded, as R2 would. */
function memoryMedia(): MediaStore & { objects: Map<string, { bytes: Uint8Array; contentType: string }> } {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    objects,
    put(key, bytes, contentType) {
      objects.set(key, { bytes, contentType });
      return Promise.resolve();
    },
  };
}

async function solid(width: number, height: number): Promise<Uint8Array> {
  const png = await sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } } })
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

describe('prepareImage', () => {
  it.each([
    [3000, 1000],
    [500, 900],
    [1200, 1500],
  ])('turns a %ix%i image into a 1200x1500 JPEG', async (width, height) => {
    const meta = await sharp(await prepareImage(await solid(width, height))).metadata();
    expect({ format: meta.format, width: meta.width, height: meta.height }).toEqual({ format: 'jpeg', ...PRODUCT_IMAGE_SIZE });
  });

  it('crops a wide photo from the centre instead of stretching it', async () => {
    // Left third red, middle third green, right third blue: a centre crop to 4:5 keeps only green.
    const third = 1000;
    const wide = await sharp({ create: { width: third * 3, height: 1000, channels: 3, background: { r: 0, g: 255, b: 0 } } })
      .composite([
        { input: { create: { width: third, height: 1000, channels: 3, background: { r: 255, g: 0, b: 0 } } }, left: 0, top: 0 },
        { input: { create: { width: third, height: 1000, channels: 3, background: { r: 0, g: 0, b: 255 } } }, left: third * 2, top: 0 },
      ])
      .png()
      .toBuffer();
    const { channels } = await sharp(await prepareImage(new Uint8Array(wide))).stats();
    const [red, green, blue] = channels;
    expect(green?.min).toBeGreaterThan(200);
    expect(red?.max).toBeLessThan(60);
    expect(blue?.max).toBeLessThan(60);
  });

  it('gives the same bytes, and so the same key, for the same photo', async () => {
    const photo = await solid(800, 800);
    expect(imageKey('paradise', await prepareImage(photo))).toBe(imageKey('paradise', await prepareImage(photo)));
  });
});

describe('seedCatalogue', () => {
  it('publishes Paradise and Blanc with a 50 ml full variant, images and opening stock', async () => {
    const db = await withTestDb();
    await seedCatalogue(db.owner, memoryMedia());

    const products = await listPublishedProducts(db.app);
    expect(products.map((p) => p.slug).sort()).toEqual(['blanc', 'paradise']);
    for (const product of products) {
      const seeded = SEED_PRODUCTS.find((p) => p.slug === product.slug);
      expect(product.variants).toEqual([
        expect.objectContaining({ kind: 'full', sizeMl: 50, sku: seeded?.variant.sku, available: seeded?.variant.openingStock }),
      ]);
      expect(product.images).toHaveLength(seeded?.images.length ?? -1);
      for (const copy of [product.nameAr, product.nameEn, product.storyAr, product.storyEn, product.labelCopyAr, product.labelCopyEn]) {
        expect(copy.trim()).not.toBe('');
      }
    }
    expect(await checkRules(db.owner)).toEqual([]);
  });

  it('stores every image as a 1200x1500 JPEG under products/<slug>/<sha256>.jpg', async () => {
    const db = await withTestDb();
    const media = memoryMedia();
    await seedCatalogue(db.owner, media);

    const rows = await db.owner.query<{ slug: string; r2_key: string }>(
      `select p.slug, i.r2_key from product_images i join products p on p.id = i.product_id order by p.slug, i.position`,
    );
    expect(rows).toHaveLength(SEED_PRODUCTS.reduce((n, p) => n + p.images.length, 0));
    for (const row of rows) {
      const stored = media.objects.get(row.r2_key);
      if (stored === undefined) throw new Error(`${row.r2_key} was never uploaded`);
      const meta = await sharp(stored.bytes).metadata();
      expect({ format: meta.format, width: meta.width, height: meta.height }).toEqual({ format: 'jpeg', ...PRODUCT_IMAGE_SIZE });
      expect(stored.contentType).toBe('image/jpeg');
      const hash = createHash('sha256').update(stored.bytes).digest('hex');
      expect(row.r2_key).toBe(`products/${row.slug}/${hash}.jpg`);
    }
  });

  it('adds an owner and an operations member with test addresses', async () => {
    const db = await withTestDb();
    await seedCatalogue(db.owner, memoryMedia());
    const staff = await db.owner.query<{ email: string; role: string; active: boolean }>(
      `select email::text as email, role, active from staff order by role`,
    );
    expect(staff).toEqual([
      { email: 'operations@example.test', role: 'operations', active: true },
      { email: 'owner@example.test', role: 'owner', active: true },
    ]);
  });

  it('changes nothing when run again', async () => {
    const db = await withTestDb();
    const snapshot = () =>
      db.owner.query(
        `select (select json_agg(p order by p.slug) from products p) as products,
                (select json_agg(v order by v.sku) from variants v) as variants,
                (select json_agg(i order by i.r2_key) from product_images i) as images,
                (select json_agg(s order by s.variant_id) from stock_levels s) as stock,
                (select count(*)::int from stock_movements) as movements,
                (select json_agg(st order by st.email) from staff st) as staff`,
      );

    const first = await seedCatalogue(db.owner, memoryMedia());
    const before = await snapshot();
    const second = await seedCatalogue(db.owner, memoryMedia());

    expect(await snapshot()).toEqual(before);
    expect(Object.values(first.stock)).toEqual(['applied', 'applied']);
    expect(Object.values(second.stock)).toEqual(['duplicate', 'duplicate']);
    expect(second.images.map((i) => i.key)).toEqual(first.images.map((i) => i.key));
  });
});
