import { randomBytes, randomInt, randomUUID } from 'node:crypto';
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

export interface CustomerFixture {
  id: string;
  phoneE164: string;
}

/** A customer with a generated Egyptian mobile number (test data only). */
export async function makeCustomer(
  owner: Db,
  overrides: { phoneE164?: string; name?: string } = {},
): Promise<CustomerFixture> {
  const phoneE164 = overrides.phoneE164 ?? `+2010${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  const [row] = await owner.query<{ id: string }>(
    `insert into customers (phone_e164, name, email) values ($1, $2, $3) returning id`,
    [phoneE164, overrides.name ?? 'Test Customer', `${unique()}@example.test`],
  );
  if (row === undefined) throw new Error('makeCustomer: insert returned no row');
  return { id: row.id, phoneE164 };
}

export interface OrderOverrides {
  checkoutKey?: string;
  governorate?: string;
  lang?: string;
  direction?: string;
  channel?: string;
  paymentMethod?: string;
  subtotal?: number;
  discountTotal?: number;
  deliveryFee?: number;
  total?: number;
  orderState?: string;
  paymentState?: string;
  fulfilmentState?: string;
}

export interface OrderFixture {
  id: string;
  number: string;
}

/**
 * An order row inserted directly (no lines): a pending, cash-on-delivery order for EGP 1,500
 * plus EGP 70 delivery in Cairo, unless told otherwise. Overrides are passed through unchecked
 * so a test can break a rule on purpose.
 */
export async function makeOrder(owner: Db, customerId: string, overrides: OrderOverrides = {}): Promise<OrderFixture> {
  const subtotal = overrides.subtotal ?? 150_000;
  const discountTotal = overrides.discountTotal ?? 0;
  const deliveryFee = overrides.deliveryFee ?? 7_000;
  const [row] = await owner.query<{ id: string; number: string }>(
    `insert into orders (checkout_key, customer_id, recipient_name, recipient_phone, governorate, area, street, building,
                         lang, direction, channel, payment_method, subtotal, discount_total, delivery_fee, total,
                         order_state, payment_state, fulfilment_state)
     values ($1, $2, 'Test Recipient', '+201000000000', $3, 'Nasr City', 'Test Street', '1',
             $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     returning id, number`,
    [
      overrides.checkoutKey ?? randomUUID(),
      customerId,
      overrides.governorate ?? 'cairo',
      overrides.lang ?? 'en',
      overrides.direction ?? 'ltr',
      overrides.channel ?? 'web',
      overrides.paymentMethod ?? 'cod',
      subtotal,
      discountTotal,
      deliveryFee,
      overrides.total ?? subtotal - discountTotal + deliveryFee,
      overrides.orderState ?? 'pending',
      overrides.paymentState ?? 'awaiting_collection',
      overrides.fulfilmentState ?? 'unfulfilled',
    ],
  );
  if (row === undefined) throw new Error('makeOrder: insert returned no row');
  return row;
}
