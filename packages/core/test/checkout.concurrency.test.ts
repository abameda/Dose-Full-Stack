import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { placeCodOrder, type CheckoutCommand } from '../src/checkout';
import { createPoolDb, type Db } from '../src/db';
import { getStock } from '../src/stock';
import { makeProduct, makeVariant, type VariantFixture } from './factories';
import { withTestDb, type TestDb } from './harness';

// Rule 3, the figure in section G of the master plan: 200 simultaneous checkouts for 10 units
// produce exactly 10 orders, repeated 100 times. Each run gets a fresh variant, so runs never share
// stock, and every checkout uses its own key and phone number.

const RUNS = 100;
const CHECKOUTS = 200;
const UNITS = 10;
const PRICE = 150_000;
const DELIVERY = 7_000;

let db: TestDb;
let app: Db;
let productId: string;

beforeAll(async () => {
  db = await withTestDb();
  app = createPoolDb(db.appUrl, { max: 50 });
  productId = (await makeProduct(db.owner, { status: 'published' })).id;
});

afterAll(async () => {
  await app.close();
});

function checkout(variant: VariantFixture, run: number, i: number): CheckoutCommand {
  return {
    idempotencyKey: randomUUID(),
    lang: i % 2 === 0 ? 'ar' : 'en',
    direction: 'd0-baseline',
    surface: 'storefront',
    lines: [{ sku: variant.sku, quantity: 1 }],
    quotedTotal: PRICE + DELIVERY,
    // A distinct generated test number per checkout across all runs: 010 + 8 digits.
    customer: { name: `Load Test ${String(run)}-${String(i)}`, phone: `010${String(run * 1_000 + i).padStart(8, '0')}` },
    address: { governorate: 'cairo', area: 'Nasr City', street: 'Load Street', building: String(i) },
    now: new Date(),
  };
}

async function countOrders(variant: VariantFixture): Promise<number> {
  const [row] = await db.owner.query<{ n: number }>(
    `select count(distinct order_id)::int as n from order_lines where variant_id = $1`,
    [variant.id],
  );
  return row?.n ?? -1;
}

describe('@slow rule 3: 200 simultaneous checkouts for 10 units', () => {
  test.each(Array.from({ length: RUNS }, (_, i) => i + 1))(
    'run %i: exactly 10 orders',
    async (run) => {
      const variant = await makeVariant(db.owner, productId, { stock: UNITS, pricePiastres: PRICE });
      const outcomes = await Promise.all(
        Array.from({ length: CHECKOUTS }, (_, i) => placeCodOrder(app, checkout(variant, run, i))),
      );

      expect(outcomes.filter((o) => o.ok)).toHaveLength(UNITS);
      expect(outcomes.filter((o) => !o.ok && o.code === 'out_of_stock')).toHaveLength(CHECKOUTS - UNITS);
      expect(await countOrders(variant)).toBe(UNITS);
      // Until checkRules exists (Task 9): the counters are exactly the ten held units, and they
      // equal the sum of the variant's movements.
      expect(await getStock(db.owner, variant.id)).toEqual({ onHand: UNITS, reserved: UNITS, available: 0 });
      expect(
        await db.owner.query(
          `select sum(on_hand_delta)::int as on_hand, sum(reserved_delta)::int as reserved
             from stock_movements where variant_id = $1`,
          [variant.id],
        ),
      ).toEqual([{ on_hand: UNITS, reserved: UNITS }]);
    },
    60_000,
  );
});
