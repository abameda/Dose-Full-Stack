import type { CancelReason, ConfirmMethod, FulfilmentState, OrderState, PaymentState } from '@dose/contract';

// Every word of the admin, in one place. The admin is English-only in Milestone 1 (an Arabic admin
// is not in section G of the master plan); keeping the words here is what makes adding Arabic later
// a translation rather than a hunt through the components. `{name}` marks a value filled in at run
// time with `fill`.

export const s = {
  // ── The frame ─────────────────────────────────────────────────────────────────────────────
  brand: 'DÖSE admin',
  skipToContent: 'Skip to content',
  navLabel: 'Admin',
  navToday: 'Today',
  navOrders: 'Orders',
  navAudit: 'Audit log',
  signedInAs: '{name} ({role})',
  loading: 'Loading…',
  tryAgain: 'Try again',
  notSignedIn: 'You are not signed in. Sign in again, then reload this page.',
  loadFailed: 'Could not load this page. Check your connection and try again.',
  noPagesForRole: 'Your role has no admin pages yet.',
  pageNotFound: 'There is no such page.',
  roleNames: { owner: 'owner', operations: 'operations', marketing: 'marketing', accountant: 'accountant' },

  // ── Today ─────────────────────────────────────────────────────────────────────────────────
  todayTitle: 'Today',
  toConfirmHeading: 'Orders to confirm',
  toConfirmCount: 'Waiting for confirmation',
  oldestWaiting: 'Oldest has waited {time}',
  nothingToConfirm: 'Nothing is waiting for confirmation.',
  refreshFailed: 'Could not refresh. Showing the last list.',
  placedAt: 'Placed {time}',

  // ── Orders ────────────────────────────────────────────────────────────────────────────────
  ordersTitle: 'Orders',
  searchLabel: 'Phone or order number',
  searchButton: 'Search',
  stateFilterLabel: 'State',
  allStates: 'All states',
  noOrders: 'No orders match.',
  columnOrder: 'Order',
  columnPlaced: 'Placed',
  columnCustomer: 'Customer',
  columnTotal: 'Total',
  columnState: 'State',

  // ── One order ─────────────────────────────────────────────────────────────────────────────
  orderHeading: 'Order {number}',
  orderNotFound: 'There is no order {number}.',
  backToOrders: 'Back to orders',
  customerHeading: 'Customer',
  addressHeading: 'Delivery address',
  itemsHeading: 'Items',
  itemsLabel: 'Items',
  columnItem: 'Item',
  columnUnitPrice: 'Price',
  columnQuantity: 'Qty',
  columnLineTotal: 'Total',
  totalsHeading: 'Totals',
  subtotal: 'Subtotal',
  discount: 'Discount',
  delivery: 'Delivery',
  total: 'Total',
  statesHeading: 'Where the order stands',
  orderStateLabel: 'Order',
  paymentStateLabel: 'Payment',
  fulfilmentStateLabel: 'Fulfilment',
  timelineHeading: 'Timeline',
  confirmButton: 'Confirm',
  cancelButton: 'Cancel',
  noMoreActions: 'This order is {state}, so it can no longer be confirmed or cancelled.',
  conflict: 'This order changed while you were looking at it: it is now {state}.',
  confirmedNotice: 'Order confirmed.',
  cancelledNotice: 'Order cancelled.',
  vanished: 'This order no longer exists.',
  orderRefreshFailed: 'Could not refresh this order. What you see may be out of date.',

  // ── Confirm and cancel dialogs ────────────────────────────────────────────────────────────
  close: 'Close',
  confirmTitle: 'Confirm order {number}',
  confirmIntro: 'Reach the customer first, then record how you confirmed the order.',
  whatsappLink: 'Open WhatsApp with the message ready',
  methodLegend: 'How did you confirm it?',
  noteOptional: 'Note (optional)',
  noteRequired: 'Note (required)',
  confirmSubmit: 'Confirm order',
  cancelTitle: 'Cancel order {number}',
  cancelIntro: 'The stock held for this order is released and nothing will be collected.',
  reasonLabel: 'Reason',
  reasonPlaceholder: 'Choose a reason',
  noteNeeded: 'Add a note: it is required when the reason is Other.',
  cancelSubmit: 'Cancel order',
  actionFailed: 'Something went wrong. Nothing was changed. Try again.',
  actionInvalid: 'The server did not accept this. Check the details and try again.',

  // ── Audit ─────────────────────────────────────────────────────────────────────────────────
  auditTitle: 'Audit log',
  auditOwnerOnly: 'Only the owner can see the audit log.',
  auditLoadFailed: 'Could not load the audit log.',
  auditEmpty: 'Nothing has been recorded yet.',
  loadOlder: 'Load older events',
  columnWhen: 'When',
  columnWho: 'Who',
  columnWhat: 'What',
  columnSubject: 'Subject',
} as const;

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = values[key];
    return value === undefined ? whole : String(value);
  });
}

// ── Names for the values the API sends ──────────────────────────────────────────────────────

export const ORDER_STATE_LABEL: Record<OrderState, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
};

export const ORDER_STATE_EXPLANATION: Record<OrderState, string> = {
  pending: 'Waiting for staff to confirm it with the customer. The stock is held for it.',
  confirmed: 'Staff reached the customer and confirmed it. The stock is sold.',
  cancelled: 'Cancelled. The stock it held went back on the shelf.',
};

export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = {
  awaiting_collection: 'Awaiting collection',
  voided: 'Voided',
};

export const PAYMENT_STATE_EXPLANATION: Record<PaymentState, string> = {
  awaiting_collection: 'Cash on delivery: the courier collects the total when the order arrives.',
  voided: 'Nothing will be collected for this order.',
};

export const FULFILMENT_STATE_LABEL: Record<FulfilmentState, string> = {
  unfulfilled: 'Unfulfilled',
};

export const FULFILMENT_STATE_EXPLANATION: Record<FulfilmentState, string> = {
  unfulfilled: 'Not shipped yet. Shipping arrives in a later milestone.',
};

export const CONFIRM_METHOD_LABEL: Record<ConfirmMethod, string> = {
  whatsapp: 'WhatsApp',
  phone: 'Phone call',
};

export const CANCEL_REASON_LABEL: Record<CancelReason, string> = {
  customer_request: 'Customer asked to cancel',
  unreachable: 'Customer unreachable',
  duplicate: 'Duplicate order',
  suspected_fraud: 'Suspected fraud',
  out_of_stock: 'Out of stock',
  confirmation_window_expired: 'Confirmation window expired',
  other: 'Other',
};

/** The actions the admin has a sentence for; anything else is shown by its name. */
export const ACTION_VERB = {
  'order.placed': 'Placed',
  'order.confirmed': 'Confirmed',
  'order.cancelled': 'Cancelled',
} as const;

export const ACTION_AS_EVENT = {
  'order.placed': 'Order placed',
  'order.confirmed': 'Order confirmed',
  'order.cancelled': 'Order cancelled',
} as const;
