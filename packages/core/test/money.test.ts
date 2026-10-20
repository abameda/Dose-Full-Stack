import { describe, expect, test } from 'vitest';
import { assertPiastres, formatEgp } from '../src/money';

describe('formatEgp', () => {
  test('formats whole pounds without decimals, Western digits in both languages', () => {
    expect(formatEgp(125_000, 'en')).toBe('EGP 1,250');
    expect(formatEgp(125_000, 'ar')).toBe('1,250 ج.م');
  });

  test('shows piastres only when non-zero', () => {
    expect(formatEgp(125_050, 'en')).toBe('EGP 1,250.50');
  });

  test('pads single-digit piastres and formats zero', () => {
    expect(formatEgp(5, 'en')).toBe('EGP 0.05');
    expect(formatEgp(0, 'ar')).toBe('0 ج.م');
  });
});

describe('assertPiastres', () => {
  test('rejects non-integers, negatives and unsafe integers', () => {
    for (const bad of [1.5, -1, Number.MAX_SAFE_INTEGER + 1, NaN]) {
      expect(() => assertPiastres(bad)).toThrow();
    }
  });
});
