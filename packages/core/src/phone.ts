/**
 * Customer identity is the normalised Egyptian mobile number in E.164 (`+201XXXXXXXXX`).
 * Accepts what people actually type or paste on a phone: Arabic-Indic or Persian digits, a
 * `+20`, `0020` or `20` country prefix, a leading 0, and spaces, dashes, dots or parentheses.
 * Landlines, unknown prefixes and wrong lengths are refused.
 */

const ARABIC_INDIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

// Spaces, dashes, dots and parentheses, plus the invisible direction marks that come along when
// a number is copied from Arabic text (LRM, RLM, embeddings, overrides and isolates).
const SEPARATORS = /[\s\-.()\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

const MOBILE = /^1[0125]\d{8}$/;

export function normalisePhone(input: string): { ok: true; e164: string } | { ok: false } {
  let s = input
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - ARABIC_INDIC_ZERO))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - PERSIAN_ZERO))
    .replace(SEPARATORS, '');

  if (/^\+20\d{10}$/.test(s)) s = s.slice(3);
  else if (/^0020\d{10}$/.test(s)) s = s.slice(4);
  else if (/^20\d{10}$/.test(s)) s = s.slice(2);
  if (s.startsWith('0')) s = s.slice(1);

  return MOBILE.test(s) ? { ok: true, e164: `+20${s}` } : { ok: false };
}
