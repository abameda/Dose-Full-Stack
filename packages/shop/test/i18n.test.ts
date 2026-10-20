import { describe, expect, test } from 'vitest';
import { ar, en, fill } from '../src/i18n';

// The brand name is Latin in both languages, each language names the other one in its own script, and a
// product title is the product's name plus the brand.
const EXEMPT: string[] = ['brand', 'otherLanguageName', 'productTitle'];
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  test('ar and en have identical key sets', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  test('no string is empty and both languages fill the same placeholders', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(ar[key].trim(), key).not.toBe('');
      expect(en[key].trim(), key).not.toBe('');
      expect(placeholders(ar[key]), key).toEqual(placeholders(en[key]));
    }
  });

  test('Arabic strings are Arabic and English strings are not', () => {
    const arabic = /[\u0600-\u06ff]/;
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      if (EXEMPT.includes(key)) continue;
      expect(arabic.test(ar[key]), `ar.${key}`).toBe(true);
      expect(arabic.test(en[key]), `en.${key}`).toBe(false);
    }
  });

  test('fill puts values into placeholders and leaves unknown ones visible', () => {
    expect(fill('Bag ({count})', { count: 2 })).toBe('Bag (2)');
    expect(fill('{a} and {b}', { a: 'x' })).toBe('x and {b}');
  });
});
