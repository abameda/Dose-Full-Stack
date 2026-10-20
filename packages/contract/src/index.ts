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

// ── Staff (used by the admin API, Task 11) ───────────────────────────────────────────────────

export const ROLES = ['owner', 'operations', 'marketing', 'accountant'] as const;
export type Role = (typeof ROLES)[number];

export type Staff = { id: string; email: string; name: string; role: Role };
