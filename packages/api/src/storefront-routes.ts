import {
  bagQuoteSchema,
  checkoutInputSchema,
  langSchema,
  type BagLine,
  type BagView,
  type CheckoutResult,
  type Lang,
  type ProductView,
} from '@dose/contract';
import { getPublishedProduct, listPublishedProducts, type ProductRow } from '@dose/core/catalogue';
import { placeCodOrder, quoteBag, type CheckoutOutcome, type Quote } from '@dose/core/checkout';
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiDeps, ApiEnv } from './app';

/**
 * The catalogue stores no image dimensions, so every product image is described as the 4:5
 * portrait 1200x1500. Task 12 owns making that true: its seed re-encodes every image to exactly
 * 1200x1500 JPEG before upload and tests the stored dimensions. Reserving the box keeps the page
 * from shifting; change this and the seed together.
 */
const PRODUCT_IMAGE_SIZE = { width: 1200, height: 1500 };

/** Where the web app serves a stored image from (`GET /media/<key>`, Task 12). */
const MEDIA_PREFIX = '/media/';

const STUDIO_PATH_PREFIX = '/studio/';

const REFUSAL_STATUS = {
  price_changed: 409,
  out_of_stock: 409,
  invalid: 422,
  checkout_disabled: 403,
} as const satisfies Record<Exclude<CheckoutResult, { ok: true }>['code'], ContentfulStatusCode>;

function toProductView(row: ProductRow, lang: Lang): ProductView {
  const ar = lang === 'ar';
  return {
    slug: row.slug,
    name: ar ? row.nameAr : row.nameEn,
    story: ar ? row.storyAr : row.storyEn,
    labelCopy: ar ? row.labelCopyAr : row.labelCopyEn,
    images: row.images.map((image) => ({
      src: `${MEDIA_PREFIX}${image.r2Key}`,
      alt: ar ? image.altAr : image.altEn,
      ...PRODUCT_IMAGE_SIZE,
    })),
    variants: row.variants.map((variant) => ({
      sku: variant.sku,
      kind: variant.kind,
      sizeMl: variant.sizeMl,
      price: variant.pricePiastres,
      available: variant.available > 0,
    })),
  };
}

function toBagView(quote: Quote, lang: Lang, unavailable: string[]): BagView {
  return {
    lines: quote.lines.map((line) => ({
      sku: line.sku,
      name: lang === 'ar' ? line.nameAr : line.nameEn,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      lineTotal: line.lineTotal,
    })),
    subtotal: quote.subtotal,
    deliveryFee: quote.deliveryFee,
    total: quote.total,
    unavailable,
  };
}

/** Body paths for the client to mark, e.g. `lines.0.quantity`, once each. */
function invalidFields(error: { issues: readonly { path: readonly PropertyKey[] }[] }): string[] {
  return [...new Set(error.issues.map((issue) => issue.path.map(String).join('.')))];
}

async function jsonBody(c: Context): Promise<unknown> {
  return c.req.json().catch(() => undefined);
}

/** Whether the request came from a page under `/studio/` (the studio never checks out). */
function cameFromStudio(referer: string | undefined): boolean {
  if (referer === undefined) return false;
  try {
    return new URL(referer).pathname.toLowerCase().startsWith(STUDIO_PATH_PREFIX);
  } catch {
    return false;
  }
}

function toCheckoutResult(outcome: CheckoutOutcome, lang: Lang): CheckoutResult {
  if (outcome.ok) return { ok: true, orderNumber: outcome.orderNumber, total: outcome.total };
  if (outcome.code === 'price_changed') return { ok: false, code: 'price_changed', quote: toBagView(outcome.quote, lang, []) };
  return outcome;
}

export function storefrontRoutes(deps: ApiDeps): Hono<ApiEnv> {
  const routes = new Hono<ApiEnv>();

  const langOf = (c: Context): Lang | null => {
    const parsed = langSchema.safeParse(c.req.query('lang'));
    return parsed.success ? parsed.data : null;
  };
  const badLang = (c: Context) => c.json({ error: 'lang must be "ar" or "en"' }, 400);

  routes.get('/api/products', async (c) => {
    const lang = langOf(c);
    if (lang === null) return badLang(c);
    const products = await listPublishedProducts(c.get('db'));
    return c.json(products.map((product) => toProductView(product, lang)));
  });

  routes.get('/api/products/:slug', async (c) => {
    const lang = langOf(c);
    if (lang === null) return badLang(c);
    const product = await getPublishedProduct(c.get('db'), c.req.param('slug'));
    if (product === null) return c.json({ error: 'not_found' }, 404);
    return c.json(toProductView(product, lang));
  });

  routes.post('/api/bag/quote', async (c) => {
    const parsed = bagQuoteSchema.safeParse(await jsonBody(c));
    if (!parsed.success) return c.json({ ok: false, code: 'invalid', fields: invalidFields(parsed.error) }, 422);
    const { lang, lines, governorate } = parsed.data;

    const db = c.get('db');
    const quote = await quoteBag(db, lines, governorate);
    if (!('unknownSkus' in quote)) return c.json(toBagView(quote, lang, []));

    // Price what is on sale and name the rest, so the bag can show which lines to drop.
    const unavailable = quote.unknownSkus;
    const onSale: BagLine[] = lines.filter((line) => !unavailable.includes(line.sku));
    if (onSale.length === 0) {
      return c.json({ lines: [], subtotal: 0, deliveryFee: 0, total: 0, unavailable } satisfies BagView);
    }
    const rest = await quoteBag(db, onSale, governorate);
    if ('unknownSkus' in rest) return c.json({ error: 'catalogue_changed' }, 409); // a SKU went off sale between the two reads
    return c.json(toBagView(rest, lang, unavailable));
  });

  routes.post('/api/checkout', async (c) => {
    const parsed = checkoutInputSchema.safeParse(await jsonBody(c));
    if (!parsed.success) return c.json({ ok: false, code: 'invalid', fields: invalidFields(parsed.error) }, 422);
    const input = parsed.data;

    // The surface comes from where the request came from, never from the body. The studio client
    // never calls this route; this is the second wall.
    const surface = cameFromStudio(c.req.header('referer')) ? 'studio' : 'storefront';
    const outcome = await placeCodOrder(c.get('db'), {
      idempotencyKey: input.idempotencyKey,
      lang: input.lang,
      direction: input.direction,
      surface,
      lines: input.lines,
      quotedTotal: input.quotedTotal,
      customer: input.customer,
      address: input.address,
      now: deps.now(),
    });
    const result = toCheckoutResult(outcome, input.lang);
    return c.json(result, result.ok ? 201 : REFUSAL_STATUS[result.code]);
  });

  return routes;
}
