/** Storefront language. Moves to `@dose/contract` in Task 10. */
export type Lang = 'ar' | 'en';

const PIASTRES_PER_POUND = 100;

/** Western digits with thousands separators, in both languages by construction. */
const poundsFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Money is integer piastres everywhere: a non-negative safe integer. */
export function assertPiastres(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`Expected a non-negative safe integer of piastres, got ${String(n)}`);
  }
  return n;
}

/** Formats integer piastres as EGP; piastres are shown only when non-zero. */
export function formatEgp(piastres: number, lang: Lang): string {
  const valid = assertPiastres(piastres);
  const pounds = Math.floor(valid / PIASTRES_PER_POUND);
  const rest = valid % PIASTRES_PER_POUND;
  const amount =
    poundsFormat.format(pounds) + (rest === 0 ? '' : `.${String(rest).padStart(2, '0')}`);
  return lang === 'ar' ? `${amount} ج.م` : `EGP ${amount}`;
}
