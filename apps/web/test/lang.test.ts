import { describe, expect, it } from 'vitest';
import { dirOf, langFromPath, preferredLang } from '../src/lang';

describe('preferredLang', () => {
  it.each([
    ['ar-EG', 'ar'],
    ['ar', 'ar'],
    ['AR-eg,en;q=0.9', 'ar'],
    ['en-US', 'en'],
    ['en-GB,ar;q=0.8', 'en'],
    ['fr-FR,ar;q=0.5', 'ar'],
    ['fr-FR,en;q=0.5,ar;q=0.4', 'en'],
    ['en;q=0.3, ar;q=0.7', 'ar'],
    ['ar;q=0, en', 'en'],
    ['de-DE', 'en'],
    ['*', 'en'],
    ['', 'en'],
    [null, 'en'],
  ] as const)('%s → %s', (header, lang) => {
    expect(preferredLang(header)).toBe(lang);
  });
});

describe('langFromPath', () => {
  it.each([
    ['/ar', 'ar'],
    ['/en/', 'en'],
    ['/ar/products/paradise', 'ar'],
    ['/studio/en/products/paradise', 'en'],
    ['/', null],
    ['/fr', null],
    ['/api/products', null],
    ['/arabic', null],
  ] as const)('%s → %s', (path, lang) => {
    expect(langFromPath(path)).toBe(lang);
  });
});

describe('dirOf', () => {
  it('is rtl only for Arabic', () => {
    expect([dirOf('ar'), dirOf('en'), dirOf(null)]).toEqual(['rtl', 'ltr', 'ltr']);
  });
});
