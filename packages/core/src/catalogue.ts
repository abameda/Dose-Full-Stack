import type { Tx } from './db';

/** What the storefront reads: published products, their live variants, images and free stock. */

export interface ProductImageRow {
  id: string;
  r2Key: string;
  altAr: string;
  altEn: string;
  position: number;
}

export interface VariantRow {
  id: string;
  sku: string;
  kind: 'full' | 'sample' | 'tester';
  sizeMl: number;
  pricePiastres: number;
  /** Units that can still be reserved (on hand minus reserved). */
  available: number;
}

export interface ProductRow {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  storyAr: string;
  storyEn: string;
  labelCopyAr: string;
  labelCopyEn: string;
  /** In `position` order. */
  images: ProductImageRow[];
  /** Active variants only, smallest size first. */
  variants: VariantRow[];
}

interface ProductQueryRow {
  id: string;
  slug: string;
  name_ar: string;
  name_en: string;
  story_ar: string;
  story_en: string;
  label_copy_ar: string;
  label_copy_en: string;
}

async function withDetails(tx: Tx, products: ProductQueryRow[]): Promise<ProductRow[]> {
  if (products.length === 0) return [];
  const ids = products.map((p) => p.id);

  const images = await tx.query<{
    id: string;
    product_id: string;
    r2_key: string;
    alt_ar: string;
    alt_en: string;
    position: number;
  }>(
    `select id, product_id, r2_key, alt_ar, alt_en, position
       from product_images where product_id = any($1::uuid[]) order by position, id`,
    [ids],
  );
  const variants = await tx.query<{
    id: string;
    product_id: string;
    sku: string;
    kind: VariantRow['kind'];
    size_ml: number;
    price_piastres: number;
    available: number;
  }>(
    `select v.id, v.product_id, v.sku, v.kind, v.size_ml, v.price_piastres,
            coalesce(s.on_hand - s.reserved, 0) as available
       from variants v left join stock_levels s on s.variant_id = v.id
      where v.product_id = any($1::uuid[]) and v.status = 'active'
      order by v.size_ml, v.sku`,
    [ids],
  );

  return products.map((p) => ({
    id: p.id,
    slug: p.slug,
    nameAr: p.name_ar,
    nameEn: p.name_en,
    storyAr: p.story_ar,
    storyEn: p.story_en,
    labelCopyAr: p.label_copy_ar,
    labelCopyEn: p.label_copy_en,
    images: images
      .filter((i) => i.product_id === p.id)
      .map((i) => ({ id: i.id, r2Key: i.r2_key, altAr: i.alt_ar, altEn: i.alt_en, position: i.position })),
    variants: variants
      .filter((v) => v.product_id === p.id)
      .map((v) => ({
        id: v.id,
        sku: v.sku,
        kind: v.kind,
        sizeMl: v.size_ml,
        pricePiastres: v.price_piastres,
        available: v.available,
      })),
  }));
}

const PRODUCT_COLUMNS = `id, slug, name_ar, name_en, story_ar, story_en, label_copy_ar, label_copy_en`;

/** Every published product, oldest first. */
export async function listPublishedProducts(tx: Tx): Promise<ProductRow[]> {
  const products = await tx.query<ProductQueryRow>(
    `select ${PRODUCT_COLUMNS} from products where status = 'published' order by created_at, slug`,
  );
  return withDetails(tx, products);
}

/** The published product with this slug, or null (a draft is never returned). */
export async function getPublishedProduct(tx: Tx, slug: string): Promise<ProductRow | null> {
  const products = await tx.query<ProductQueryRow>(
    `select ${PRODUCT_COLUMNS} from products where status = 'published' and slug = $1`,
    [slug],
  );
  return (await withDetails(tx, products))[0] ?? null;
}
