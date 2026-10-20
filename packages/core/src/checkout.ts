import type { Lang } from '@dose/contract';
import { validateAddress, type AddressInput } from './address';
import { writeAudit } from './audit';
import type { Db, Tx } from './db';
import { normalisePhone } from './phone';
import { MAX_LINES, MAX_QUANTITY, priceBag } from './pricing';
import { InsufficientStock, reserveStock, type Actor } from './stock';

/**
 * Cash-on-delivery checkout: one transaction that re-prices the bag from the database, reserves
 * its stock and records the order, its lines, payment, reservations and the `order.placed` audit
 * event. The idempotency key makes a double tap or a retried request return the order already
 * placed (rule 5), and lines are reserved in a fixed order (ascending variant id) so two bags that
 * share items cannot deadlock (rule 3).
 */

export type Quote = ReturnType<typeof priceBag>;

export interface BagLine {
  sku: string;
  quantity: number;
}

export interface CheckoutCommand {
  /** A uuid generated when the checkout page loads, kept until the order is placed. */
  idempotencyKey: string;
  lang: Lang;
  direction: string;
  surface: 'storefront' | 'studio';
  lines: BagLine[];
  /** The total the customer saw, in piastres. */
  quotedTotal: number;
  customer: { name: string; phone: string };
  address: AddressInput;
  now: Date;
}

export type CheckoutOutcome =
  | { ok: true; orderNumber: string; total: number; replayed: boolean }
  | { ok: false; code: 'price_changed'; quote: Quote }
  | { ok: false; code: 'out_of_stock'; skus: string[] }
  | { ok: false; code: 'invalid'; fields: string[] }
  | { ok: false; code: 'checkout_disabled' };

type Refusal = Exclude<CheckoutOutcome, { ok: true }>;

export const MAX_NAME_LENGTH = 100;
/** Checked at run time too: the command arrives from a request body. */
const LANGS: readonly string[] = ['ar', 'en'];
const MAX_SKU_LENGTH = 100;
const MAX_DIRECTION_LENGTH = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = '23505';
const CHECKOUT_KEY_CONSTRAINT = 'orders_checkout_key_key';
const HOUR_MS = 3_600_000;

/** Thrown inside the transaction to roll it back and answer with `outcome`. */
class Refused extends Error {
  constructor(readonly outcome: Refusal) {
    super(`Checkout refused: ${outcome.code}`);
    this.name = 'Refused';
  }
}

/** The fee for `governorate`; with none (or an unknown one), the highest fee of any governorate. */
async function deliveryFee(tx: Tx, governorate: string | undefined): Promise<number> {
  if (governorate !== undefined) {
    const [row] = await tx.query<{ fee_piastres: number }>(
      `select fee_piastres from governorate_delivery where governorate = $1`,
      [governorate],
    );
    if (row !== undefined) return row.fee_piastres;
  }
  const [row] = await tx.query<{ fee: number }>(`select coalesce(max(fee_piastres), 0)::int as fee from governorate_delivery`);
  return row?.fee ?? 0;
}

/**
 * Prices `lines` at today's prices plus delivery. A SKU that is not an active variant of a
 * published product is reported in `unknownSkus` instead. Throws `RangeError` (from `priceBag`)
 * for a bag outside the limits.
 */
export async function quoteBag(tx: Tx, lines: BagLine[], governorate?: string): Promise<Quote | { unknownSkus: string[] }> {
  const rows = await tx.query<{ variant_id: string; sku: string; name_ar: string; name_en: string; price_piastres: number }>(
    `select v.id as variant_id, v.sku, p.name_ar, p.name_en, v.price_piastres
       from variants v join products p on p.id = v.product_id
      where v.sku = any($1::text[]) and v.status = 'active' and p.status = 'published'`,
    [lines.map((l) => l.sku)],
  );
  const bySku = new Map(rows.map((r) => [r.sku, r]));
  const unknownSkus = [...new Set(lines.map((l) => l.sku).filter((sku) => !bySku.has(sku)))];
  if (unknownSkus.length > 0) return { unknownSkus };

  const priced = lines.map((line) => {
    const row = bySku.get(line.sku);
    if (row === undefined) throw new Error(`unreachable: ${line.sku} was found above`);
    return {
      variantId: row.variant_id,
      sku: row.sku,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      unitPrice: row.price_piastres,
      quantity: line.quantity,
    };
  });
  return priceBag(priced, await deliveryFee(tx, governorate));
}

interface CheckedCommand {
  lines: BagLine[];
  name: string;
  phoneE164: string;
  address: AddressInput;
}

/** Everything that can be checked without the database, as field paths (`customer.phone`). */
function check(cmd: CheckoutCommand): { ok: true; value: CheckedCommand } | { ok: false; fields: string[] } {
  const fields: string[] = [];
  if (!UUID.test(cmd.idempotencyKey)) fields.push('idempotencyKey');
  if (!LANGS.includes(cmd.lang)) fields.push('lang');
  if (cmd.direction.length < 1 || cmd.direction.length > MAX_DIRECTION_LENGTH) fields.push('direction');

  const skus = new Set(cmd.lines.map((l) => l.sku));
  if (cmd.lines.length < 1 || cmd.lines.length > MAX_LINES || skus.size !== cmd.lines.length) {
    fields.push('lines');
  } else {
    cmd.lines.forEach((line, i) => {
      if (line.sku.length < 1 || line.sku.length > MAX_SKU_LENGTH) fields.push(`lines.${String(i)}.sku`);
      if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY) {
        fields.push(`lines.${String(i)}.quantity`);
      }
    });
  }
  if (!Number.isSafeInteger(cmd.quotedTotal) || cmd.quotedTotal < 0) fields.push('quotedTotal');

  const name = cmd.customer.name.trim();
  if (name.length < 1 || name.length > MAX_NAME_LENGTH) fields.push('customer.name');
  const phone = normalisePhone(cmd.customer.phone);
  if (!phone.ok) fields.push('customer.phone');
  const address = validateAddress(cmd.address);
  if (!address.ok) fields.push(...address.fields.map((f) => `address.${f}`));

  if (fields.length > 0 || !phone.ok || !address.ok) return { ok: false, fields };
  return { ok: true, value: { lines: cmd.lines, name, phoneE164: phone.e164, address: address.value } };
}

/** The order already placed with this checkout key, as a replayed success. */
async function placedWith(tx: Tx, checkoutKey: string): Promise<CheckoutOutcome | null> {
  const [row] = await tx.query<{ number: string; total: number }>(
    `select number, total from orders where checkout_key = $1`,
    [checkoutKey],
  );
  return row === undefined ? null : { ok: true, orderNumber: row.number, total: row.total, replayed: true };
}

async function confirmationWindowHours(tx: Tx): Promise<number> {
  const [row] = await tx.query<{ value: unknown }>(`select value from settings where key = 'cod_confirmation_window_hours'`);
  const hours = row?.value;
  if (typeof hours !== 'number' || !(hours > 0)) {
    throw new Error(`settings.cod_confirmation_window_hours must be a positive number, got ${JSON.stringify(hours)}`);
  }
  return hours;
}

function isCheckoutKeyClash(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'constraint' in error &&
    error.code === UNIQUE_VIOLATION &&
    error.constraint === CHECKOUT_KEY_CONSTRAINT
  );
}

/**
 * Places a cash-on-delivery order from the storefront. Refuses in the studio before touching the
 * database; refuses invalid input with the bad field paths; returns the existing order for a
 * repeated idempotency key; answers `price_changed` (with the new quote) when the bag's total is
 * no longer `quotedTotal`, and `out_of_stock` (naming the short SKUs, reserving nothing) when any
 * line cannot be held.
 */
export async function placeCodOrder(db: Db, cmd: CheckoutCommand): Promise<CheckoutOutcome> {
  if (cmd.surface === 'studio') return { ok: false, code: 'checkout_disabled' };
  const checked = check(cmd);
  if (!checked.ok) return { ok: false, code: 'invalid', fields: checked.fields };
  const { lines, name, phoneE164, address } = checked.value;
  const actor: Actor = { type: 'customer', id: phoneE164 };

  try {
    return await db.transaction(async (tx): Promise<CheckoutOutcome> => {
      const [delivery] = await tx.query<{ cod_enabled: boolean }>(
        `select cod_enabled from governorate_delivery where governorate = $1`,
        [address.governorate],
      );
      if (delivery?.cod_enabled !== true) {
        throw new Refused({ ok: false, code: 'invalid', fields: ['address.governorate'] });
      }

      const existing = await placedWith(tx, cmd.idempotencyKey);
      if (existing !== null) return existing;

      const quote = await quoteBag(tx, lines, address.governorate);
      if ('unknownSkus' in quote) throw new Refused({ ok: false, code: 'out_of_stock', skus: quote.unknownSkus });
      if (quote.total !== cmd.quotedTotal) throw new Refused({ ok: false, code: 'price_changed', quote });

      // Reserve in ascending variant id order, the one lock order every checkout shares.
      const orderId = crypto.randomUUID();
      const short = new Set<string>();
      for (const line of [...quote.lines].sort((a, b) => (a.variantId < b.variantId ? -1 : 1))) {
        try {
          await reserveStock(tx, {
            variantId: line.variantId,
            quantity: line.quantity,
            sourceKey: `reserve:${orderId}:${line.variantId}`,
            actor,
          });
        } catch (error) {
          if (!(error instanceof InsufficientStock)) throw error;
          short.add(line.sku);
        }
      }
      if (short.size > 0) {
        throw new Refused({ ok: false, code: 'out_of_stock', skus: quote.lines.map((l) => l.sku).filter((s) => short.has(s)) });
      }

      const expiresAt = new Date(cmd.now.getTime() + (await confirmationWindowHours(tx)) * HOUR_MS);
      // The first name given for a phone stays the customer's; each order keeps its own recipient.
      const [customer] = await tx.query<{ id: string }>(
        `insert into customers (phone_e164, name) values ($1, $2)
         on conflict (phone_e164) do update set phone_e164 = excluded.phone_e164
         returning id`,
        [phoneE164, name],
      );
      if (customer === undefined) throw new Error('customer upsert returned no row');

      const [order] = await tx.query<{ number: string }>(
        `insert into orders (id, checkout_key, customer_id, recipient_name, recipient_phone, governorate, area, street,
                             building, landmark, lang, direction, channel, payment_method, subtotal, discount_total,
                             delivery_fee, total, order_state, payment_state, fulfilment_state, version, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'web', 'cod', $13, $14, $15, $16,
                 'pending', 'awaiting_collection', 'unfulfilled', 1, $17)
         returning number`,
        [
          orderId,
          cmd.idempotencyKey,
          customer.id,
          name,
          phoneE164,
          address.governorate,
          address.area,
          address.street,
          address.building,
          address.landmark ?? null,
          cmd.lang,
          cmd.direction,
          quote.subtotal,
          quote.discountTotal,
          quote.deliveryFee,
          quote.total,
          cmd.now,
        ],
      );
      if (order === undefined) throw new Error('order insert returned no row');

      await tx.query(
        `insert into order_lines (order_id, variant_id, sku, name_ar, name_en, unit_price, quantity, line_discount, line_total)
         select $1::uuid, * from unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::int[], $7::int[], $8::int[], $9::int[])`,
        [
          orderId,
          quote.lines.map((l) => l.variantId),
          quote.lines.map((l) => l.sku),
          quote.lines.map((l) => l.nameAr),
          quote.lines.map((l) => l.nameEn),
          quote.lines.map((l) => l.unitPrice),
          quote.lines.map((l) => l.quantity),
          quote.lines.map((l) => l.lineDiscount),
          quote.lines.map((l) => l.lineTotal),
        ],
      );
      await tx.query(
        `insert into payments (order_id, method, amount, state) values ($1, 'cod', $2, 'awaiting_collection')`,
        [orderId, quote.total],
      );
      await tx.query(
        `insert into reservations (order_id, variant_id, quantity, status, expires_at)
         select $1::uuid, variant_id, quantity, 'held', $4::timestamptz from unnest($2::uuid[], $3::int[]) as u(variant_id, quantity)`,
        [orderId, quote.lines.map((l) => l.variantId), quote.lines.map((l) => l.quantity), expiresAt],
      );
      await writeAudit(tx, {
        actor,
        action: 'order.placed',
        entity: 'order',
        entityId: order.number,
        entityVersion: 1,
        data: { total: quote.total, lines: quote.lines.map((l) => ({ sku: l.sku, quantity: l.quantity })) },
      });
      return { ok: true, orderNumber: order.number, total: quote.total, replayed: false };
    });
  } catch (error) {
    // A twin submission with the same key may have committed while this one ran: it holds the
    // order (and perhaps the last unit), so this one answers with that order.
    if (error instanceof Refused) return (await placedWith(db, cmd.idempotencyKey)) ?? error.outcome;
    if (isCheckoutKeyClash(error)) {
      const existing = await placedWith(db, cmd.idempotencyKey);
      if (existing !== null) return existing;
    }
    throw error;
  }
}
