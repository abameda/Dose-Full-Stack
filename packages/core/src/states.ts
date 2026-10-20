/**
 * The three state machines of an order. Order, payment and fulfilment are separate columns
 * (rule 6); each change is a conditional update from an allowed state that bumps `version`
 * and writes an audit event in the same transaction. These tables say which moves are allowed;
 * the migration limits each column to the same sets (orders-schema.test.ts pins the match).
 */

export const ORDER_STATES = ['pending', 'confirmed', 'cancelled'] as const;
export type OrderState = (typeof ORDER_STATES)[number];

/** 'collected' arrives with Bosta (M3/M4). */
export const PAYMENT_STATES = ['awaiting_collection', 'voided'] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

/** Shipment states arrive in M3. */
export const FULFILMENT_STATES = ['unfulfilled'] as const;
export type FulfilmentState = (typeof FULFILMENT_STATES)[number];

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
