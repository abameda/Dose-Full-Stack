import { expect, test } from 'vitest';
import { bagKey, skuKey } from '../src/use-bag';

const PARADISE = { sku: 'PARADISE-50ML', quantity: 1 };
const BLANC = { sku: 'BLANC-50ML', quantity: 2 };
const BAG = [PARADISE, BLANC];

test('the bag key changes when a quantity changes, so the checkout prices the bag again', () => {
  expect(bagKey([{ ...PARADISE, quantity: 2 }, BLANC])).not.toBe(bagKey(BAG));
});

test('the bag key changes when a line is added or removed', () => {
  expect(bagKey([PARADISE])).not.toBe(bagKey(BAG));
});

test('the bag key does not depend on line order', () => {
  expect(bagKey([BLANC, PARADISE])).toBe(bagKey(BAG));
});

test('the SKU key ignores quantities (the drawer prices quantities itself)', () => {
  expect(skuKey([{ ...PARADISE, quantity: 5 }, BLANC])).toBe(skuKey(BAG));
});
