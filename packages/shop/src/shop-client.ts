import type { BagLine, BagView, CheckoutInput, CheckoutResult, CommerceActions, Lang } from '@dose/contract';
import { sharedBagStore, type BagStore } from './bag-store';

export type ShopClientOptions = {
  /** Where the page is shown. The studio previews a direction but never takes an order. */
  surface: 'storefront' | 'studio';
  /** The design direction that renders the page (stored on the order). */
  direction: string;
  fetch?: typeof fetch;
  store?: BagStore;
};

/** `CommerceActions`, plus the one thing a finished order needs. */
export type ShopClient = CommerceActions & {
  /** Empties the bag, after an order is placed. */
  clearBag(): void;
};

const EMPTY_BAG: BagView = { lines: [], subtotal: 0, deliveryFee: 0, total: 0, unavailable: [] };

/** A response that is not what the API promises (a 5xx, an HTML error page, a lost connection). */
export class ShopApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ShopApiError';
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ShopApiError(`The shop answered ${String(response.status)} with something other than JSON`, response.status);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * What a direction's UI calls. The bag lives in the browser (`bag-store.ts`); pricing and orders
 * are the API's: `quote` asks it what the bag costs today and `checkout` places the order. In
 * the studio, `checkout` answers `checkout_disabled` without calling the API at all.
 */
export function createShopClient(options: ShopClientOptions): ShopClient {
  const store = options.store ?? sharedBagStore();
  const send = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  const post = (path: string, body: unknown): Promise<Response> =>
    send(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  return {
    addToBag(sku, quantity = 1) {
      store.set([...store.lines(), { sku, quantity }]);
    },
    updateLine(sku, quantity) {
      store.set(store.lines().map((line) => (line.sku === sku ? { sku, quantity } : line)));
    },
    removeLine(sku) {
      store.set(store.lines().filter((line) => line.sku !== sku));
    },
    clearBag() {
      store.set([]);
    },
    lines: () => store.lines(),
    subscribe: (fn) => store.subscribe(fn),

    async quote(lang: Lang, governorate?: string): Promise<BagView> {
      const lines: BagLine[] = store.lines();
      if (lines.length === 0) return EMPTY_BAG;
      const response = await post('/api/bag/quote', { lang, lines, ...(governorate === undefined ? {} : { governorate }) });
      const body = await readJson(response);
      if (!response.ok || !isRecord(body) || !Array.isArray(body['lines'])) {
        throw new ShopApiError(`Pricing the bag failed with ${String(response.status)}`, response.status);
      }
      return body as BagView;
    },

    async checkout(input: Omit<CheckoutInput, 'lines' | 'direction'>): Promise<CheckoutResult> {
      if (options.surface === 'studio') return { ok: false, code: 'checkout_disabled' };
      const lines = store.lines();
      if (lines.length === 0) return { ok: false, code: 'invalid', fields: ['lines'] };
      const response = await post('/api/checkout', { ...input, lines, direction: options.direction });
      const body = await readJson(response);
      // Every answer the API gives to a well-formed order, success or refusal, carries `ok`.
      if (!isRecord(body) || typeof body['ok'] !== 'boolean') {
        throw new ShopApiError(`Placing the order failed with ${String(response.status)}`, response.status);
      }
      return body as CheckoutResult;
    },
  };
}

const clients = new Map<string, ShopClient>();

/** The page's client for a surface and direction, made once so every island shares one bag. */
export function shopClientFor(surface: ShopClientOptions['surface'], direction: string): ShopClient {
  const key = `${surface}:${direction}`;
  let client = clients.get(key);
  if (client === undefined) {
    client = createShopClient({ surface, direction });
    clients.set(key, client);
  }
  return client;
}
