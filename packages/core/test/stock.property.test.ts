import fc from 'fast-check';
import { expect, test } from 'vitest';
import {
  adjustStock,
  getStock,
  InsufficientStock,
  NotReserved,
  receiveStock,
  releaseStock,
  reserveStock,
  sellReserved,
  type Actor,
} from '../src/stock';
import { makeProduct, makeVariant } from './factories';
import { withTestDb } from './harness';

const actor: Actor = { type: 'system', id: 'property' };

type Operation =
  | { kind: 'receive' | 'reserve' | 'release' | 'sell'; quantity: number }
  | { kind: 'adjust'; delta: number };

const quantity = fc.integer({ min: 1, max: 6 });
const operation: fc.Arbitrary<Operation> = fc.oneof(
  fc.record({ kind: fc.constantFrom('receive', 'reserve', 'release', 'sell'), quantity }),
  fc.record({
    kind: fc.constant('adjust' as const),
    delta: fc.integer({ min: -6, max: 6 }).filter((n) => n !== 0),
  }),
);

test('stock always equals the sum of its movements and stays within 0 <= reserved <= on hand', async () => {
  const { app, owner } = await withTestDb();
  const product = await makeProduct(owner);
  let runNumber = 0;

  await fc.assert(
    fc.asyncProperty(fc.array(operation, { maxLength: 25 }), async (operations) => {
      // A fresh variant per run keeps runs independent; its sum is over its own movements only.
      const { id: variantId } = await makeVariant(owner, product.id, { stock: 0 });
      const run = `run${String(++runNumber)}`;
      // The model says which operations the rules must refuse.
      let onHand = 0;
      let reserved = 0;

      for (const [index, op] of operations.entries()) {
        const sourceKey = `${run}:${String(index)}`;
        const attempt = (fn: Parameters<typeof app.transaction>[0]) => app.transaction(fn).then(() => 'ok', (e: unknown) => e);
        let outcome: unknown;
        let allowed: boolean;
        switch (op.kind) {
          case 'receive':
            allowed = true; // receiving is never refused
            outcome = await attempt((tx) => receiveStock(tx, { variantId, quantity: op.quantity, sourceKey, actor }));
            onHand += op.quantity;
            break;
          case 'reserve':
            allowed = onHand - reserved >= op.quantity;
            outcome = await attempt((tx) => reserveStock(tx, { variantId, quantity: op.quantity, sourceKey, actor }));
            if (allowed) reserved += op.quantity;
            break;
          case 'release':
            allowed = reserved >= op.quantity;
            outcome = await attempt((tx) => releaseStock(tx, { variantId, quantity: op.quantity, sourceKey, actor }));
            if (allowed) reserved -= op.quantity;
            break;
          case 'sell':
            allowed = reserved >= op.quantity;
            outcome = await attempt((tx) => sellReserved(tx, { variantId, quantity: op.quantity, sourceKey, actor }));
            if (allowed) {
              onHand -= op.quantity;
              reserved -= op.quantity;
            }
            break;
          case 'adjust':
            allowed = onHand + op.delta >= reserved;
            outcome = await attempt((tx) => adjustStock(tx, { variantId, delta: op.delta, sourceKey, actor }));
            if (allowed) onHand += op.delta;
            break;
        }
        if (allowed) {
          expect(outcome).toBe('ok');
        } else {
          expect(outcome).toSatisfy((e: unknown) => e instanceof InsufficientStock || e instanceof NotReserved);
        }
      }

      const [sums] = await owner.query<{ on_hand: number; reserved: number }>(
        `select coalesce(sum(on_hand_delta), 0)::int as on_hand, coalesce(sum(reserved_delta), 0)::int as reserved
           from stock_movements where variant_id = $1`,
        [variantId],
      );
      const stock = await getStock(app, variantId);
      expect(stock.onHand).toBe(sums?.on_hand);
      expect(stock.reserved).toBe(sums?.reserved);
      expect(stock).toEqual({ onHand, reserved, available: onHand - reserved });
      expect(stock.reserved).toBeGreaterThanOrEqual(0);
      expect(stock.reserved).toBeLessThanOrEqual(stock.onHand);
    }),
    { numRuns: 500 },
  );
}, 120_000);
