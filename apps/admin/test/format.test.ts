import { expect, test } from 'vitest';
import { formatWaiting, timelineSentence, whatsappLink } from '../src/format';
import { detail } from './support';

test.each([
  [0, 'less than a minute'],
  [1, '1 minute'],
  [59, '59 minutes'],
  [60, '1 hour'],
  [61, '1 hour 1 minute'],
  [135, '2 hours 15 minutes'],
  [24 * 60, '1 day'],
  [24 * 60 + 3 * 60 + 30, '1 day 3 hours'],
  [49 * 60, '2 days 1 hour'],
] as const)('%i minutes waiting reads "%s"', (minutes, words) => {
  expect(formatWaiting(minutes)).toBe(words);
});

test.each([
  [{ actorType: 'customer', actorLabel: '+201012345678', action: 'order.placed' }, 'Placed by customer +201012345678'],
  [{ actorType: 'staff', actorLabel: 'Mona', action: 'order.confirmed', method: 'whatsapp' }, 'Confirmed by Mona · WhatsApp'],
  [{ actorType: 'staff', actorLabel: 'Mona', action: 'order.confirmed', method: 'phone' }, 'Confirmed by Mona · Phone call'],
  [{ actorType: 'staff', actorLabel: 'Mona', action: 'order.cancelled', reason: 'out_of_stock' }, 'Cancelled by Mona · Out of stock'],
  [{ actorType: 'system', actorLabel: 'expiry', action: 'order.cancelled', reason: 'confirmation_window_expired' }, 'Cancelled by the system (expiry) · Confirmation window expired'],
  [{ actorType: 'staff', actorLabel: 'Mona', action: 'order.refunded' }, 'order.refunded by Mona'],
] as const)('timeline entry %#', (entry, sentence) => {
  expect(timelineSentence({ at: '2026-10-20T10:00:00.000Z', ...entry })).toBe(sentence);
});

test('a WhatsApp link has the number as digits only and the text encoded', () => {
  const url = new URL(whatsappLink(detail({ customerPhone: '+201012345678', customerName: 'A & B' })));
  expect(url.href.startsWith('https://wa.me/201012345678?text=')).toBe(true);
  expect(url.searchParams.get('text')).toContain('A & B');
  expect(url.searchParams.get('text')).toContain('D10001');
});
