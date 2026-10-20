import { assertPiastres } from './money';

/** Bag limits (decision 0002): 1-10 units per line, at most 10 lines. */
export const MAX_LINES = 10;
export const MAX_QUANTITY = 10;

/** The largest value of the `int` money columns. */
const MAX_COLUMN_INT = 2_147_483_647;

export interface PricedLine {
  variantId: string;
  sku: string;
  nameAr: string;
  nameEn: string;
  unitPrice: number;
  quantity: number;
  lineDiscount: number;
  lineTotal: number;
}

export interface PricedBag {
  lines: PricedLine[];
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  total: number;
}

/** A money amount that is a whole, non-negative piastre count and fits the database column. */
function money(n: number, what: string): number {
  assertPiastres(n);
  if (n > MAX_COLUMN_INT) throw new RangeError(`${what} is too large: ${String(n)} piastres`);
  return n;
}

/**
 * Prices a bag in integer piastres: each line is unit price x quantity less its discount; the
 * subtotal is the gross sum of unit price x quantity (before discounts), `discountTotal` the sum of
 * the line discounts, and `total = subtotal - discountTotal + deliveryFee` (rule 1), which equals
 * the sum of the line totals plus delivery: each discount is subtracted once.
 * Milestone 1 has no discounts, so every `lineDiscount` is 0; the discount fields exist so the
 * order tables and totals do not change when M2 adds them.
 *
 * Throws `RangeError` for an empty or oversized bag, a quantity outside 1-10, or an amount that
 * is not a non-negative whole number that fits the database.
 */
export function priceBag(lines: Omit<PricedLine, 'lineDiscount' | 'lineTotal'>[], deliveryFee: number): PricedBag {
  if (lines.length < 1 || lines.length > MAX_LINES) {
    throw new RangeError(`A bag holds 1 to ${String(MAX_LINES)} lines, got ${String(lines.length)}`);
  }
  money(deliveryFee, 'Delivery fee');

  const priced = lines.map((line): PricedLine => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY) {
      throw new RangeError(`Quantity must be a whole number from 1 to ${String(MAX_QUANTITY)}, got ${String(line.quantity)}`);
    }
    money(line.unitPrice, 'Unit price');
    const lineDiscount = 0;
    const lineTotal = money(line.unitPrice * line.quantity - lineDiscount, 'Line total');
    return { ...line, lineDiscount, lineTotal };
  });

  const subtotal = money(
    priced.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
    'Subtotal',
  );
  const discountTotal = priced.reduce((sum, line) => sum + line.lineDiscount, 0);
  const total = money(subtotal - discountTotal + deliveryFee, 'Total');
  return { lines: priced, subtotal, discountTotal, deliveryFee, total };
}
