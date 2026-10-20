// The typed contract between the storefront, the shop client, the admin and the API: the shapes
// that cross the HTTP boundary, plus a Zod schema for every request body. Nothing here touches the
// database or any commerce rule, so a design direction may import it (boundary rule 1).
import { z } from 'zod';

/** Storefront language. */
export const LANGS = ['ar', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export const langSchema = z.enum(LANGS);

/** Bag limits (decision 0002): 1-10 units per line, at most 10 lines. */
export const MAX_BAG_LINES = 10;
export const MAX_LINE_QUANTITY = 10;

// ── Storefront catalogue ─────────────────────────────────────────────────────────────────────

export type ImageView = { src: string; alt: string; width: number; height: number };

export type VariantView = {
  sku: string;
  kind: 'full' | 'sample' | 'tester';
  sizeMl: number;
  /** Integer piastres. */
  price: number;
  available: boolean;
};

export type ProductView = {
  /** Latin in both languages (`^[a-z0-9]+(-[a-z0-9]+)*$`), so links survive a language switch. */
  slug: string;
  name: string;
  story: string;
  labelCopy: string;
  images: ImageView[];
  variants: VariantView[];
};

// ── Bag and checkout ─────────────────────────────────────────────────────────────────────────

export type BagLine = { sku: string; quantity: number };

/** A bag priced at today's prices. All amounts are integer piastres. */
export type BagView = {
  lines: { sku: string; name: string; unitPrice: number; quantity: number; lineTotal: number }[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  /** SKUs that are not on sale; they are left out of `lines` and the totals. */
  unavailable: string[];
};

export type CheckoutInput = {
  /** A uuid generated when the checkout page loads, kept until the order is placed. */
  idempotencyKey: string;
  lang: Lang;
  /** The design direction that rendered the checkout (stored on the order). */
  direction: string;
  lines: BagLine[];
  /** The total the customer saw, in piastres. */
  quotedTotal: number;
  customer: { name: string; phone: string };
  address: { governorate: string; area: string; street: string; building: string; landmark?: string };
};

export type CheckoutResult =
  | { ok: true; orderNumber: string; total: number }
  | { ok: false; code: 'price_changed'; quote: BagView }
  | { ok: false; code: 'out_of_stock'; skus: string[] }
  /** `fields` are paths into the request body, e.g. `lines.0.quantity`, `customer.phone`. */
  | { ok: false; code: 'invalid'; fields: string[] }
  | { ok: false; code: 'checkout_disabled' };

/** What a direction's UI calls. The shop client (`@dose/shop`) implements it over `/api`. */
export interface CommerceActions {
  addToBag(sku: string, quantity?: number): void;
  updateLine(sku: string, quantity: number): void;
  removeLine(sku: string): void;
  lines(): BagLine[];
  subscribe(fn: (lines: BagLine[]) => void): () => void;
  quote(lang: Lang, governorate?: string): Promise<BagView>;
  checkout(input: Omit<CheckoutInput, 'lines' | 'direction'>): Promise<CheckoutResult>;
}

// ── Request schemas (the trust boundary) ─────────────────────────────────────────────────────

const MAX_SKU_LENGTH = 100;
const MAX_NAME_LENGTH = 100;
const MAX_DIRECTION_LENGTH = 100;
/** Generous: a phone number typed with spaces, dashes and Arabic-Indic digits. */
const MAX_PHONE_LENGTH = 40;
const MAX_ADDRESS_FIELD = 200;

const bagLineSchema = z.object({
  sku: z.string().min(1).max(MAX_SKU_LENGTH),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
});
const bagLinesSchema = z.array(bagLineSchema).min(1).max(MAX_BAG_LINES);
const addressField = z.string().trim().min(1).max(MAX_ADDRESS_FIELD);

export const checkoutInputSchema: z.ZodType<CheckoutInput> = z.object({
  idempotencyKey: z.uuid(),
  lang: langSchema,
  direction: z.string().min(1).max(MAX_DIRECTION_LENGTH),
  lines: bagLinesSchema,
  quotedTotal: z.number().int().min(0),
  customer: z.object({
    name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
    phone: z.string().min(1).max(MAX_PHONE_LENGTH),
  }),
  address: z.object({
    governorate: addressField,
    area: addressField,
    street: addressField,
    building: addressField,
    landmark: z.exactOptional(z.string().max(MAX_ADDRESS_FIELD)),
  }),
});

export const bagQuoteSchema: z.ZodType<{ lang: Lang; lines: BagLine[]; governorate?: string }> = z.object({
  lang: langSchema,
  lines: bagLinesSchema,
  governorate: z.exactOptional(z.string().min(1).max(MAX_ADDRESS_FIELD)),
});

// ── Staff ────────────────────────────────────────────────────────────────────────────────────

export const ROLES = ['owner', 'operations', 'marketing', 'accountant'] as const;
export type Role = (typeof ROLES)[number];

export type Staff = { id: string; email: string; name: string; role: Role };

// ── Orders as the admin sees them ────────────────────────────────────────────────────────────
// The state sets, reasons and methods live here so the admin can name them without importing
// commerce code; `@dose/core` re-exports them and the migrations limit each column to the same set.

export const ORDER_STATES = ['pending', 'confirmed', 'cancelled'] as const;
export type OrderState = (typeof ORDER_STATES)[number];

/** 'collected' arrives with Bosta (M3/M4). */
export const PAYMENT_STATES = ['awaiting_collection', 'voided'] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

/** Shipment states arrive in M3. */
export const FULFILMENT_STATES = ['unfulfilled'] as const;
export type FulfilmentState = (typeof FULFILMENT_STATES)[number];

export const CANCEL_REASONS = [
  'customer_request',
  'unreachable',
  'duplicate',
  'suspected_fraud',
  'out_of_stock',
  'confirmation_window_expired',
  'other',
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

/** How staff reached the customer to confirm a cash-on-delivery order. */
export const CONFIRM_METHODS = ['whatsapp', 'phone'] as const;
export type ConfirmMethod = (typeof CONFIRM_METHODS)[number];

/** The longest note staff may attach to a confirm or cancel (after trimming). */
export const MAX_NOTE_LENGTH = 1000;

export type ActorType = 'customer' | 'staff' | 'system';

/** One row of an order list. Amounts are integer piastres; `createdAt` is ISO 8601. */
export type OrderSummary = {
  number: string;
  createdAt: string;
  customerName: string;
  /** E.164, `+201XXXXXXXXX`. */
  customerPhone: string;
  governorate: string;
  total: number;
  orderState: OrderState;
  paymentState: PaymentState;
  fulfilmentState: FulfilmentState;
  /** Send it back as `expectedVersion` to confirm or cancel. */
  version: number;
};

/** One audit event of an order, as the timeline shows it. */
export type TimelineEntry = {
  at: string;
  actorType: ActorType;
  /** The customer's phone, the staff member's name, or the system job (e.g. `expiry`). */
  actorLabel: string;
  /** e.g. `order.placed`, `order.confirmed`, `order.cancelled`. */
  action: string;
  reason?: string;
  note?: string;
  /** How a confirm was made. */
  method?: ConfirmMethod;
};

export type OrderLineView = {
  sku: string;
  nameAr: string;
  nameEn: string;
  unitPrice: number;
  quantity: number;
  lineDiscount: number;
  lineTotal: number;
};

export type OrderDetail = OrderSummary & {
  lang: Lang;
  direction: string;
  channel: 'web' | 'manual';
  paymentMethod: 'cod';
  address: { governorate: string; area: string; street: string; building: string; landmark?: string };
  lines: OrderLineView[];
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  /** Oldest first. */
  timeline: TimelineEntry[];
};

/** `GET /api/admin/today`. */
export type TodayView = {
  toConfirm: { count: number; oldestWaitingMinutes: number | null; orders: OrderSummary[] };
};

/** One event of the whole audit log (`GET /api/admin/audit`). */
export type AuditEntry = {
  id: string;
  at: string;
  actorType: ActorType;
  actorId: string | null;
  actorLabel: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  entityVersion: number | null;
  reason: string | null;
  data: Record<string, unknown>;
};

/** Newest first. Pass `nextCursor` back as `?cursor=` for the next page; null on the last page. */
export type AuditPage = { events: AuditEntry[]; nextCursor: string | null };

export type ConfirmOrderInput = { expectedVersion: number; method: ConfirmMethod; note?: string };
export type CancelOrderInput = { expectedVersion: number; reason: CancelReason; note?: string };

/** What confirm and cancel answer: 200, 409 (someone changed the order first), 422 or 404. */
export type OrderActionResult =
  | { ok: true; version: number }
  | { ok: false; code: 'conflict'; current: { orderState: OrderState; version: number } }
  | { ok: false; code: 'invalid'; fields: string[] }
  | { ok: false; code: 'not_found' };

const noteSchema = z.exactOptional(z.string().trim().max(MAX_NOTE_LENGTH));
const expectedVersionSchema = z.number().int().min(1);

export const confirmOrderInputSchema: z.ZodType<ConfirmOrderInput> = z.object({
  expectedVersion: expectedVersionSchema,
  method: z.enum(CONFIRM_METHODS),
  note: noteSchema,
});

export const cancelOrderInputSchema: z.ZodType<CancelOrderInput> = z
  .object({ expectedVersion: expectedVersionSchema, reason: z.enum(CANCEL_REASONS), note: noteSchema })
  .refine((input) => input.reason !== 'other' || (input.note ?? '') !== '', {
    message: 'a note is required when the reason is "other"',
    path: ['note'],
  });
