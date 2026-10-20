import { LANGS, type Lang } from '@dose/contract';

/**
 * The storefront language a browser prefers: the supported language (`ar`, `en`) that comes first
 * in `Accept-Language` by quality, then by position. English when the header names neither.
 */
export function preferredLang(acceptLanguage: string | null): Lang {
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((entry, position) => {
      const [range = '', ...params] = entry.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const quality = q === undefined ? 1 : Number(q.slice(2));
      return { primary: range.trim().toLowerCase().split('-')[0] ?? '', quality, position };
    })
    .filter((entry) => Number.isFinite(entry.quality) && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.position - b.position);
  const first = ranked.map((entry) => LANGS.find((lang) => lang === entry.primary)).find((lang) => lang !== undefined);
  return first ?? 'en';
}

/** The language a path is in: its first segment (`/ar/...`), or the one after `/studio/`. */
export function langFromPath(pathname: string): Lang | null {
  const segments = pathname.split('/').filter((segment) => segment !== '');
  const candidate = segments[0] === 'studio' ? segments[1] : segments[0];
  return LANGS.find((lang) => lang === candidate) ?? null;
}

export function dirOf(lang: Lang | null): 'rtl' | 'ltr' {
  return lang === 'ar' ? 'rtl' : 'ltr';
}
