import { expect, test } from 'vitest';
import { normalisePhone } from '../src/phone';

test.each([
  ['01012345678', '+201012345678'],
  ['+20 101 234 5678', '+201012345678'],
  ['0020-1012345678', '+201012345678'],
  ['201512345678', '+201512345678'],
  ['٠١٢٣٤٥٦٧٨٩٠', '+201234567890'],
  ['(011) 2345-6789', '+201123456789'],
])('%s → %s', (input, e164) => {
  expect(normalisePhone(input)).toEqual({ ok: true, e164 });
});

test.each(['0223456789', '0131234567', '010123456', '010123456789', 'abc', ''])('rejects %s', (i) => {
  expect(normalisePhone(i)).toEqual({ ok: false });
});

test.each([
  ['Persian digits', '۰۱۰۱۲۳۴۵۶۷۸', '+201012345678'],
  ['dots', '010.1234.5678', '+201012345678'],
  ['bidi marks pasted from an Arabic chat', '\u200e+20 100 123 4567\u200f', '+201001234567'],
])('accepts %s', (_name, input, e164) => {
  expect(normalisePhone(input)).toEqual({ ok: true, e164 });
});

test.each([
  ['a +20 prefix before a leading 0 (11 digits follow)', '+2001012345678'],
  ['letters mixed in', '0101234567x'],
  ['a 14 prefix', '01412345678'],
])('rejects %s', (_name, input) => {
  expect(normalisePhone(input)).toEqual({ ok: false });
});
