/**
 * The three state machines of an order. Order, payment and fulfilment are separate columns
 * (rule 6); each change is a conditional update from an allowed state that bumps `version`
 * and writes an audit event in the same transaction. These tables say which moves are allowed;
 * the migration limits each column to the same sets (orders-schema.test.ts pins the match).
 */

import type { OrderState, PaymentState } from '@dose/contract';

// The state sets live in @dose/contract so the admin can name them; they are re-exported here.
export { FULFILMENT_STATES, ORDER_STATES, PAYMENT_STATES } from '@dose/contract';
export type { FulfilmentState, OrderState, PaymentState } from '@dose/contract';

/** Confirmed and cancelled are final in M1; a cancelled order never comes back. */
export const ORDER_TRANSITIONS: Record<OrderState, readonly OrderState[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: [],
  cancelled: [],
};

export const PAYMENT_TRANSITIONS: Record<PaymentState, readonly PaymentState[]> = {
  awaiting_collection: ['voided'],
  voided: [],
};

/** True when `table` allows moving from `from` to `to`. A state the table does not list is never allowed. */
export function canTransition<S extends string>(table: Record<S, readonly S[]>, from: S, to: S): boolean {
  return Object.hasOwn(table, from) && table[from].includes(to);
}
