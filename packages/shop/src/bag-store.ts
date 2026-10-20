import type { BagLine } from '@dose/contract';
import { MAX_BAG_LINES, MAX_LINE_QUANTITY } from '@dose/contract/limits';

/** Where the bag is kept in the browser. The suffix is the format version. */
export const BAG_STORAGE_KEY = 'dose.bag.v1';

type BagStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface BagStore {
  /** A copy: changing it does not change the bag. */
  lines(): BagLine[];
  /** Replaces the bag. Quantities are clamped to 1-10, repeated SKUs merge, at most 10 lines are kept. */
  set(lines: BagLine[]): void;
  /** `fn` hears the new lines after every change. Returns the way to stop listening. */
  subscribe(fn: (lines: BagLine[]) => void): () => void;
}

function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 1;
  return Math.min(MAX_LINE_QUANTITY, Math.max(1, Math.trunc(quantity)));
}

/** The bag as the rules allow it: whole quantities from 1 to 10, one line per SKU, at most 10 lines. */
function normalise(lines: readonly BagLine[]): BagLine[] {
  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.sku, (totals.get(line.sku) ?? 0) + clampQuantity(line.quantity));
  return [...totals].slice(0, MAX_BAG_LINES).map(([sku, quantity]) => ({ sku, quantity: clampQuantity(quantity) }));
}

function isLine(value: unknown): value is BagLine {
  if (typeof value !== 'object' || value === null) return false;
  const { sku, quantity } = value as Record<string, unknown>;
  return typeof sku === 'string' && sku !== '' && typeof quantity === 'number';
}

/** What storage holds, or an empty bag when it holds nothing usable. Never throws. */
function parse(raw: string | null): BagLine[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? normalise(parsed.filter(isLine)) : [];
  } catch {
    return [];
  }
}

/** The browser's `localStorage`, or undefined where even looking it up throws (blocked site data). */
function browserStorage(): BagStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The bag, kept in memory and mirrored to storage. Memory is the truth while the page is open:
 * storage is read once when the store is made, and written after every change. If storage is
 * missing or throws (private windows, blocked site data, a full disk) the bag keeps working in
 * memory for the life of the page and nothing is reported.
 */
export function createBagStore(storage: BagStorage | undefined = browserStorage()): BagStore {
  const listeners = new Set<(lines: BagLine[]) => void>();

  const read = (): BagLine[] => {
    try {
      return parse(storage?.getItem(BAG_STORAGE_KEY) ?? null);
    } catch {
      return [];
    }
  };
  let current = read();

  const announce = () => {
    for (const listener of [...listeners]) {
      try {
        listener(current.map((line) => ({ ...line })));
      } catch (error) {
        // One broken listener must not stop the others or undo the change.
        console.error('bag: a subscriber threw', error);
      }
    }
  };

  return {
    lines: () => current.map((line) => ({ ...line })),
    set(lines) {
      current = normalise(lines);
      try {
        storage?.setItem(BAG_STORAGE_KEY, JSON.stringify(current));
      } catch {
        // Kept in memory only.
      }
      announce();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}

let shared: BagStore | undefined;

/**
 * The one bag of this page. Every island on a page (the bag button, the add-to-bag button, the
 * checkout form) uses it, so they hear each other. In another tab, a change to the stored bag
 * reaches it too.
 */
export function sharedBagStore(): BagStore {
  if (shared === undefined) {
    const store = createBagStore();
    shared = store;
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (event) => {
        // `key` is null when the whole storage was cleared.
        if (event.key !== BAG_STORAGE_KEY && event.key !== null) return;
        store.set(parse(event.newValue));
      });
    }
  }
  return shared;
}
