import { randomBytes } from 'node:crypto';
import type { Db } from '../src/db';

// Test data only: arranged through the owner connection, never through the code under test.

export interface ProductFixture {
  id: string;
  slug: string;
}

export interface ProductOverrides {
  slug?: string;
  status?: 'draft' | 'published';
  nameAr?: string;
  nameEn?: string;
  storyAr?: string;
  storyEn?: string;
  labelCopyAr?: string;
  labelCopyEn?: string;
}

export interface VariantFixture {
  id: string;
  sku: string;
  pricePiastres: number;
}

export interface VariantOverrides {
  sku?: string;
  kind?: 'full' | 'sample' | 'tester';
  sizeMl?: number;
  pricePiastres?: number;
  status?: 'active' | 'archived';
  /** Units on hand to start with, recorded as a `received` movement. Default 10. */
  stock?: number;
}

function unique(): string {
  return randomBytes(6).toString('hex');
}

/** A product with Arabic and English copy. Unpublished (`draft`) unless told otherwise. */
export async function makeProduct(owner: Db, overrides: ProductOverrides = {}): Promise<ProductFixture> {
  const slug = overrides.slug ?? `product-${unique()}`;
  const [row] = await owner.query<{ id: string }>(
    `insert into products (slug, status, name_ar, name_en, story_ar, story_en, label_copy_ar, label_copy_en)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      slug,
      overrides.status ?? 'draft',
      overrides.nameAr ?? 'عطر تجريبي',
      overrides.nameEn ?? 'Test fragrance',
      overrides.storyAr ?? 'قصة تجريبية',
      overrides.storyEn ?? 'A test story',
      overrides.labelCopyAr ?? 'نص الملصق',
      overrides.labelCopyEn ?? 'Label copy',
    ],
  );
  if (row === undefined) throw new Error('makeProduct: insert returned no row');
  return { id: row.id, slug };
}

/** An active 50 ml full-size variant at EGP 1,500 with 10 units on hand, unless told otherwise. */
export async function makeVariant(
  owner: Db,
  productId: string,
  overrides: VariantOverrides = {},
): Promise<VariantFixture> {
  const sku = overrides.sku ?? `SKU-${unique()}`;
  const pricePiastres = overrides.pricePiastres ?? 150_000;
  const stock = overrides.stock ?? 10;
  const id = await owner.transaction(async (tx) => {
    const [row] = await tx.query<{ id: string }>(
      `insert into variants (product_id, sku, kind, size_ml, price_piastres, status)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [productId, sku, overrides.kind ?? 'full', overrides.sizeMl ?? 50, pricePiastres, overrides.status ?? 'active'],
    );
    if (row === undefined) throw new Error('makeVariant: insert returned no row');
    if (stock > 0) {
      await tx.query(
        `insert into stock_movements (variant_id, reason, on_hand_delta, reserved_delta, source_key, actor_type, actor_id)
         values ($1, 'received', $2, 0, $3, 'system', 'factory')`,
        [row.id, stock, `factory:${row.id}`],
      );
      await tx.query(`update stock_levels set on_hand = $2 where variant_id = $1`, [row.id, stock]);
    }
    return row.id;
  });
  return { id, sku, pricePiastres };
}
