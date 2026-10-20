import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { priceBag, type PricedLine } from '../src/pricing';

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

type LineInput = Omit<PricedLine, 'lineDiscount' | 'lineTotal'>;

const line: fc.Arbitrary<LineInput> = fc.record({
  variantId: fc.uuid(),
  sku: fc.string({ minLength: 1, maxLength: 12 }),
  nameAr: fc.string({ minLength: 1, maxLength: 20 }),
  nameEn: fc.string({ minLength: 1, maxLength: 20 }),
  unitPrice: fc.integer({ min: 1, max: 10_000_000 }),
  quantity: fc.integer({ min: 1, max: 10 }),
});

describe('priceBag (rule 1: totals add up)', () => {
  test('the total is subtotal - discount + delivery, with whole non-negative amounts', () => {
    fc.assert(
      fc.property(
        fc.array(line, { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 0, max: 50_000 }),
        (lines, deliveryFee) => {
          const r = priceBag(lines, deliveryFee);
          expect(r.total).toBe(r.subtotal - r.discountTotal + r.deliveryFee);
          // The subtotal is gross and the discount is the sum of the line discounts, so the total
          // is what the lines charge plus delivery: no discount is subtracted twice.
          expect(r.subtotal).toBe(sum(r.lines.map((l) => l.unitPrice * l.quantity)));
          expect(r.discountTotal).toBe(sum(r.lines.map((l) => l.lineDiscount)));
          expect(r.total).toBe(sum(r.lines.map((l) => l.lineTotal)) + r.deliveryFee);
          expect(r.discountTotal).toBeLessThanOrEqual(r.subtotal);
          expect(r.deliveryFee).toBe(deliveryFee);
          for (const n of [r.total, r.subtotal, r.discountTotal, ...r.lines.map((l) => l.lineTotal)]) {
            expect(Number.isSafeInteger(n) && n >= 0).toBe(true);
          }
        },
      ),
      { numRuns: 5000 },
    );
  });

  test('each line is priced as unit price x quantity less its discount, and keeps its identity', () => {
    fc.assert(
      fc.property(fc.array(line, { minLength: 1, maxLength: 10 }), (lines) => {
        const r = priceBag(lines, 0);
        expect(r.lines).toHaveLength(lines.length);
        for (const [i, priced] of r.lines.entries()) {
          const input = lines[i];
          expect(priced).toMatchObject(input ?? {});
          expect(priced.lineTotal).toBe(priced.unitPrice * priced.quantity - priced.lineDiscount);
          expect(priced.lineDiscount).toBeGreaterThanOrEqual(0);
          expect(priced.lineDiscount).toBeLessThanOrEqual(priced.unitPrice * priced.quantity);
        }
      }),
      { numRuns: 1000 },
    );
  });
});

describe('priceBag input checks', () => {
  const ok: LineInput = { variantId: 'v', sku: 's', nameAr: 'ا', nameEn: 'a', unitPrice: 1000, quantity: 2 };

  test('a known bag', () => {
    expect(priceBag([ok], 7000)).toEqual({
      lines: [{ ...ok, lineDiscount: 0, lineTotal: 2000 }],
      subtotal: 2000,
      discountTotal: 0,
      deliveryFee: 7000,
      total: 9000,
    });
  });

  test.each([
    ['no lines', [], 0],
    ['eleven lines', Array.from({ length: 11 }, () => ok), 0],
    ['quantity 0', [{ ...ok, quantity: 0 }], 0],
    ['quantity 11', [{ ...ok, quantity: 11 }], 0],
    ['fractional quantity', [{ ...ok, quantity: 1.5 }], 0],
    ['fractional price', [{ ...ok, unitPrice: 10.5 }], 0],
    ['negative price', [{ ...ok, unitPrice: -1 }], 0],
    ['NaN price', [{ ...ok, unitPrice: Number.NaN }], 0],
    ['negative delivery', [ok], -1],
    ['fractional delivery', [ok], 0.5],
    ['a total beyond the database integer', [{ ...ok, unitPrice: 2_000_000_000, quantity: 2 }], 0],
  ] as [string, LineInput[], number][])('refuses %s', (_name, lines, fee) => {
    expect(() => priceBag(lines, fee)).toThrow(RangeError);
  });
});
