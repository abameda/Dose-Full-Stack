import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Db, Tx } from '../src/db';
import { receiveStock } from '../src/stock';

/**
 * The launch catalogue for local, preview and staging databases: Paradise and Blanc, one 50 ml
 * full-size variant each, their photos, opening stock and two staff members for local sign-in.
 *
 * Until the owner's copy and photos arrive (O3), every piece of copy that is not the product's
 * English name starts with `PLACEHOLDER —`, the photos are plain-colour files named
 * `PLACEHOLDER-*.jpg`, and the prices are placeholders too. Replace the values here, not in the
 * database: running the seed again brings the database in line with this file.
 */

/**
 * Every product image is stored as a JPEG of exactly this size (4:5 portrait), because the
 * storefront API reports this size for every image without reading it (`PRODUCT_IMAGE_SIZE` in
 * packages/api/src/storefront-routes.ts). Change the two together.
 */
export const PRODUCT_IMAGE_SIZE = { width: 1200, height: 1500 } as const;

const PLACEHOLDER = 'PLACEHOLDER —';

export interface SeedImage {
  /** A file in `seed/images/`. */
  file: string;
  altAr: string;
  altEn: string;
}

export interface SeedProduct {
  slug: string;
  nameAr: string;
  nameEn: string;
  storyAr: string;
  storyEn: string;
  labelCopyAr: string;
  labelCopyEn: string;
  variant: { sku: string; sizeMl: number; pricePiastres: number; openingStock: number };
  /** In display order. */
  images: SeedImage[];
}

export const SEED_PRODUCTS: readonly SeedProduct[] = [
  {
    slug: 'paradise',
    nameAr: `${PLACEHOLDER} باراديس`,
    nameEn: 'Paradise',
    storyAr: `${PLACEHOLDER} قصة باراديس تصل مع نصوص المالك.`,
    storyEn: `${PLACEHOLDER} The story of Paradise arrives with the owner's copy.`,
    labelCopyAr: `${PLACEHOLDER} ماء عطر، 50 مل. نص الملصق يصل مع نصوص المالك.`,
    labelCopyEn: `${PLACEHOLDER} Eau de parfum, 50 ml. The label copy arrives with the owner's copy.`,
    // PLACEHOLDER price (EGP 1,500) until the owner sets it.
    variant: { sku: 'PARADISE-50ML', sizeMl: 50, pricePiastres: 150_000, openingStock: 50 },
    images: [
      {
        file: 'PLACEHOLDER-paradise.jpg',
        altAr: `${PLACEHOLDER} زجاجة باراديس`,
        altEn: `${PLACEHOLDER} A bottle of Paradise`,
      },
    ],
  },
  {
    slug: 'blanc',
    nameAr: `${PLACEHOLDER} بلانك`,
    nameEn: 'Blanc',
    storyAr: `${PLACEHOLDER} قصة بلانك تصل مع نصوص المالك.`,
    storyEn: `${PLACEHOLDER} The story of Blanc arrives with the owner's copy.`,
    labelCopyAr: `${PLACEHOLDER} ماء عطر، 50 مل. نص الملصق يصل مع نصوص المالك.`,
    labelCopyEn: `${PLACEHOLDER} Eau de parfum, 50 ml. The label copy arrives with the owner's copy.`,
    // PLACEHOLDER price (EGP 1,500) until the owner sets it.
    variant: { sku: 'BLANC-50ML', sizeMl: 50, pricePiastres: 150_000, openingStock: 50 },
    images: [
      {
        file: 'PLACEHOLDER-blanc.jpg',
        altAr: `${PLACEHOLDER} زجاجة بلانك`,
        altEn: `${PLACEHOLDER} A bottle of Blanc`,
      },
    ],
  },
];

/** Staff for signing in on a developer's machine (`X-Dev-Staff-Email`); test addresses only. */
export const SEED_STAFF: readonly { email: string; name: string; role: 'owner' | 'operations' }[] = [
  { email: 'owner@example.test', name: 'Local Owner', role: 'owner' },
  { email: 'operations@example.test', name: 'Local Operations', role: 'operations' },
];

/** Where the seed puts image bytes: local R2 (miniflare) or a real bucket, or memory in tests. */
export interface MediaStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export const SEED_IMAGES_DIR = new URL('./images/', import.meta.url);

const SEED_ACTOR = { type: 'system', id: 'seed' } as const;

/**
 * Re-encodes any photo as a JPEG of exactly `PRODUCT_IMAGE_SIZE`: turned upright from its EXIF
 * orientation, scaled to cover the box and cropped from the centre (never stretched), with its
 * metadata stripped. The same input always gives the same bytes, so its key stays the same.
 */
export async function prepareImage(bytes: Uint8Array): Promise<Uint8Array> {
  const output = await sharp(bytes)
    .rotate()
    .resize(PRODUCT_IMAGE_SIZE.width, PRODUCT_IMAGE_SIZE.height, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return new Uint8Array(output);
}

/** `products/<slug>/<sha256 of the bytes>.jpg`: a new photo gets a new key, so it can be cached forever. */
export function imageKey(slug: string, bytes: Uint8Array): string {
  return `products/${slug}/${createHash('sha256').update(bytes).digest('hex')}.jpg`;
}

export interface SeedResult {
  /** The key and stored bytes of every image, in catalogue order. */
  images: { slug: string; key: string; bytes: Uint8Array }[];
  /** Per SKU: whether the opening stock was received now or by an earlier run. */
  stock: Record<string, 'applied' | 'duplicate'>;
}

/**
 * Brings the catalogue, opening stock and local staff in line with this file. Connect as the
 * owner role (`dose_owner`). Images are re-encoded and uploaded first (their keys are content
 * hashes, so an upload that is never referenced is harmless); every row is then written in one
 * transaction. Running it again changes nothing: products, variants and staff are matched by
 * slug, SKU and email, images by key, and the opening stock is received under `seed:<sku>`.
 */
export async function seedCatalogue(owner: Db, media: MediaStore, imagesDir: URL = SEED_IMAGES_DIR): Promise<SeedResult> {
  const images: SeedResult['images'] = [];
  for (const product of SEED_PRODUCTS) {
    for (const image of product.images) {
      const bytes = await prepareImage(await readFile(new URL(image.file, imagesDir)));
      const key = imageKey(product.slug, bytes);
      await media.put(key, bytes, 'image/jpeg');
      images.push({ slug: product.slug, key, bytes });
    }
  }

  const stock = await owner.transaction(async (tx) => {
    const received: SeedResult['stock'] = {};
    for (const product of SEED_PRODUCTS) {
      const productId = await upsertProduct(tx, product);
      const keys = images.filter((i) => i.slug === product.slug).map((i) => i.key);
      await syncImages(tx, productId, product.images, keys);
      const variantId = await upsertVariant(tx, productId, product.variant);
      received[product.variant.sku] = await receiveStock(tx, {
        variantId,
        quantity: product.variant.openingStock,
        sourceKey: `seed:${product.variant.sku}`,
        actor: SEED_ACTOR,
      });
    }
    for (const member of SEED_STAFF) {
      await tx.query(
        `insert into staff (email, name, role) values ($1, $2, $3)
         on conflict (email) do update set name = excluded.name, role = excluded.role, active = true`,
        [member.email, member.name, member.role],
      );
    }
    return received;
  });

  return { images, stock };
}

async function upsertProduct(tx: Tx, p: SeedProduct): Promise<string> {
  const [row] = await tx.query<{ id: string }>(
    `insert into products (slug, status, name_ar, name_en, story_ar, story_en, label_copy_ar, label_copy_en)
     values ($1, 'published', $2, $3, $4, $5, $6, $7)
     on conflict (slug) do update set
       status = 'published', name_ar = excluded.name_ar, name_en = excluded.name_en,
       story_ar = excluded.story_ar, story_en = excluded.story_en,
       label_copy_ar = excluded.label_copy_ar, label_copy_en = excluded.label_copy_en
     returning id`,
    [p.slug, p.nameAr, p.nameEn, p.storyAr, p.storyEn, p.labelCopyAr, p.labelCopyEn],
  );
  if (row === undefined) throw new Error(`seed: upserting product ${p.slug} returned no row`);
  return row.id;
}

/** Makes the product's images exactly `keys`, in order, keeping the rows of keys it already has. */
async function syncImages(tx: Tx, productId: string, images: readonly SeedImage[], keys: string[]): Promise<void> {
  await tx.query(`delete from product_images where product_id = $1 and not (r2_key = any($2::text[]))`, [productId, keys]);
  for (const [position, image] of images.entries()) {
    const key = keys[position];
    if (key === undefined) throw new Error(`seed: no stored key for image ${image.file}`);
    const updated = await tx.query(
      `update product_images set alt_ar = $3, alt_en = $4, position = $5
        where product_id = $1 and r2_key = $2 returning id`,
      [productId, key, image.altAr, image.altEn, position],
    );
    if (updated.length === 0) {
      await tx.query(
        `insert into product_images (product_id, r2_key, alt_ar, alt_en, position) values ($1, $2, $3, $4, $5)`,
        [productId, key, image.altAr, image.altEn, position],
      );
    }
  }
}

async function upsertVariant(tx: Tx, productId: string, v: SeedProduct['variant']): Promise<string> {
  const [row] = await tx.query<{ id: string }>(
    `insert into variants (product_id, sku, kind, size_ml, price_piastres, status)
     values ($1, $2, 'full', $3, $4, 'active')
     on conflict (sku) do update set
       product_id = excluded.product_id, kind = 'full', size_ml = excluded.size_ml,
       price_piastres = excluded.price_piastres, status = 'active'
     returning id`,
    [productId, v.sku, v.sizeMl, v.pricePiastres],
  );
  if (row === undefined) throw new Error(`seed: upserting variant ${v.sku} returned no row`);
  return row.id;
}
