import { describe, expect, test } from 'vitest';
import {
  canTransition,
  FULFILMENT_STATES,
  ORDER_STATES,
  ORDER_TRANSITIONS,
  PAYMENT_STATES,
  PAYMENT_TRANSITIONS,
} from '../src/states';

describe('order states', () => {
  test('a pending order can be confirmed or cancelled', () => {
    expect(canTransition(ORDER_TRANSITIONS, 'pending', 'confirmed')).toBe(true);
    expect(canTransition(ORDER_TRANSITIONS, 'pending', 'cancelled')).toBe(true);
  });

  test.each([
    ['confirmed', 'pending'],
    ['cancelled', 'confirmed'],
    ['cancelled', 'cancelled'],
    ['cancelled', 'pending'],
    ['confirmed', 'confirmed'],
    ['confirmed', 'cancelled'],
    ['pending', 'pending'],
  ] as const)('%s -> %s is refused', (from, to) => {
    expect(canTransition(ORDER_TRANSITIONS, from, to)).toBe(false);
  });

  test('every state is a key, and every target is a state', () => {
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...ORDER_STATES].sort());
    for (const targets of Object.values(ORDER_TRANSITIONS)) {
      for (const target of targets) expect(ORDER_STATES).toContain(target);
    }
  });
});

describe('payment states', () => {
  test('awaiting collection can be voided and nothing else moves', () => {
    expect(canTransition(PAYMENT_TRANSITIONS, 'awaiting_collection', 'voided')).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, 'voided', 'awaiting_collection')).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS, 'voided', 'voided')).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS, 'awaiting_collection', 'awaiting_collection')).toBe(false);
  });

  test('every state is a key', () => {
    expect(Object.keys(PAYMENT_TRANSITIONS).sort()).toEqual([...PAYMENT_STATES].sort());
  });
});

test('a state the table does not know is never a valid transition', () => {
  expect(canTransition<string>(ORDER_TRANSITIONS, 'shipped', 'pending')).toBe(false);
  expect(canTransition<string>(ORDER_TRANSITIONS, 'pending', 'shipped')).toBe(false);
  expect(canTransition<string>(ORDER_TRANSITIONS, 'toString', 'pending')).toBe(false);
});

test('fulfilment starts unfulfilled; shipment states arrive in Milestone 3', () => {
  expect(FULFILMENT_STATES).toEqual(['unfulfilled']);
});
