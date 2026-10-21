import { describe, expect, test } from 'vitest';
import { checkRules } from '../src/rules';
import { receiveStockBySku } from '../src/stock-admin';
import { makeProduct, makeVariant } from './factories';
import { withTestDb } from './harness';

describe('receiveStockBySku', () => {
  test('receives the units onto the ledger and returns the stock afterwards', async () => {
    const { owner } = await withTestDb();
    const product = await makeProduct(owner);
    const variant = await makeVariant(owner, product.id, { sku: 'BLANC-50ML', stock: 10 });

    const result = await receiveStockBySku(owner, { sku: 'BLANC-50ML', units: 12, sourceKey: 'staging-topup:1-1' });

    expect(result).toEqual({ outcome: 'applied', stock: { onHand: 22, reserved: 0, available: 22 } });
    expect(
      await owner.query(`select reason, on_hand_delta, actor_type, actor_id from stock_movements where source_key = $1`, ['staging-topup:1-1']),
    ).toEqual([{ reason: 'received', on_hand_delta: 12, actor_type: 'system', actor_id: 'stock:receive' }]);
    expect(await owner.query(`select on_hand from stock_levels where variant_id = $1`, [variant.id])).toEqual([{ on_hand: 22 }]);
    expect(await checkRules(owner)).toEqual([]);
  });

  test('receives once per source key: a repeat is a duplicate and changes nothing', async () => {
    const { owner } = await withTestDb();
    const product = await makeProduct(owner);
    await makeVariant(owner, product.id, { sku: 'BLANC-50ML', stock: 10 });

    await receiveStockBySku(owner, { sku: 'BLANC-50ML', units: 12, sourceKey: 'staging-topup:1-1' });
    const again = await receiveStockBySku(owner, { sku: 'BLANC-50ML', units: 12, sourceKey: 'staging-topup:1-1' });

    expect(again).toEqual({ outcome: 'duplicate', stock: { onHand: 22, reserved: 0, available: 22 } });
    expect(await owner.query(`select count(*)::int as n from stock_movements`)).toEqual([{ n: 2 }]);
  });

  test('trims the SKU and the source key', async () => {
    const { owner } = await withTestDb();
    const product = await makeProduct(owner);
    await makeVariant(owner, product.id, { sku: 'BLANC-50ML', stock: 0 });
    expect((await receiveStockBySku(owner, { sku: ' BLANC-50ML ', units: 3, sourceKey: ' run-7 ' })).stock.onHand).toBe(3);
    expect(await owner.query(`select source_key from stock_movements`)).toEqual([{ source_key: 'run-7' }]);
  });

  test.each([
    [{ sku: 'NO-SUCH-SKU', units: 5, sourceKey: 'k' }, 'no variant has the SKU NO-SUCH-SKU'],
    [{ sku: ' ', units: 5, sourceKey: 'k' }, 'sku must not be empty'],
    [{ sku: 'BLANC-50ML', units: 5, sourceKey: ' ' }, 'source key must not be empty'],
    [{ sku: 'BLANC-50ML', units: 0, sourceKey: 'k' }, /quantity must be a whole number/],
    [{ sku: 'BLANC-50ML', units: 2.5, sourceKey: 'k' }, /quantity must be a whole number/],
    [{ sku: 'BLANC-50ML', units: -1, sourceKey: 'k' }, /quantity must be a whole number/],
  ])('refuses %j and changes nothing', async (input, message) => {
    const { owner } = await withTestDb();
    const product = await makeProduct(owner);
    await makeVariant(owner, product.id, { sku: 'BLANC-50ML', stock: 10 });
    await expect(receiveStockBySku(owner, input)).rejects.toThrow(message);
    expect(await owner.query(`select count(*)::int as n from stock_movements`)).toEqual([{ n: 1 }]);
  });
});
