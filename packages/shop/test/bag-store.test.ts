import { describe, expect, test } from 'vitest';
import { BAG_STORAGE_KEY, createBagStore } from '../src/bag-store';

/** A working in-memory stand-in for `localStorage`. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

/** What a browser gives when storage is blocked: every call throws. */
const throwingStorage = {
  getItem: () => {
    throw new Error('storage is blocked');
  },
  setItem: () => {
    throw new Error('storage is blocked');
  },
};

describe('the bag store', () => {
  test('bag works when localStorage throws', () => {
    const store = createBagStore(throwingStorage);
    expect(store.lines()).toEqual([]);

    store.set([{ sku: 'PARADISE-50ML', quantity: 1 }]);
    expect(store.lines()).toEqual([{ sku: 'PARADISE-50ML', quantity: 1 }]);

    store.set([{ sku: 'PARADISE-50ML', quantity: 3 }, { sku: 'BLANC-50ML', quantity: 1 }]);
    expect(store.lines()).toEqual([
      { sku: 'PARADISE-50ML', quantity: 3 },
      { sku: 'BLANC-50ML', quantity: 1 },
    ]);
  });

  test('a write that fails after reads work keeps the line in memory', () => {
    const storage = { ...memoryStorage(), setItem: throwingStorage.setItem };
    const store = createBagStore(storage);
    store.set([{ sku: 'BLANC-50ML', quantity: 2 }]);
    expect(store.lines()).toEqual([{ sku: 'BLANC-50ML', quantity: 2 }]);
  });

  test('stored lines survive a new store instance', () => {
    const storage = memoryStorage();
    createBagStore(storage).set([{ sku: 'PARADISE-50ML', quantity: 2 }]);
    expect(storage.data.has(BAG_STORAGE_KEY)).toBe(true);
    expect(createBagStore(storage).lines()).toEqual([{ sku: 'PARADISE-50ML', quantity: 2 }]);
  });

  test('the storage key is versioned', () => {
    expect(BAG_STORAGE_KEY).toBe('dose.bag.v1');
  });

  test.each([
    ['not JSON', '{oops'],
    ['not a list', '{"sku":"A","quantity":1}'],
    ['a list of the wrong things', '[1, "two", null, {"sku": 4}]'],
  ])('malformed stored data (%s) gives an empty bag and does not throw', (_name, stored) => {
    const store = createBagStore(memoryStorage({ [BAG_STORAGE_KEY]: stored }));
    expect(store.lines()).toEqual([]);
  });

  test('well-formed lines are kept and malformed ones are dropped', () => {
    const stored = JSON.stringify([{ sku: 'A', quantity: 2 }, { sku: '', quantity: 1 }, 'x', { sku: 'B' }]);
    expect(createBagStore(memoryStorage({ [BAG_STORAGE_KEY]: stored })).lines()).toEqual([{ sku: 'A', quantity: 2 }]);
  });

  test('quantities clamp to 1-10', () => {
    const store = createBagStore(memoryStorage());
    store.set([
      { sku: 'A', quantity: 0 },
      { sku: 'B', quantity: -4 },
      { sku: 'C', quantity: 11 },
      { sku: 'D', quantity: 2.7 },
      { sku: 'E', quantity: Number.NaN },
    ]);
    expect(store.lines()).toEqual([
      { sku: 'A', quantity: 1 },
      { sku: 'B', quantity: 1 },
      { sku: 'C', quantity: 10 },
      { sku: 'D', quantity: 2 },
      { sku: 'E', quantity: 1 },
    ]);
  });

  test('stored quantities clamp too', () => {
    const stored = JSON.stringify([{ sku: 'A', quantity: 99 }]);
    expect(createBagStore(memoryStorage({ [BAG_STORAGE_KEY]: stored })).lines()).toEqual([{ sku: 'A', quantity: 10 }]);
  });

  test('the same SKU twice becomes one line, clamped, and the bag holds at most 10 lines', () => {
    const store = createBagStore(memoryStorage());
    store.set([{ sku: 'A', quantity: 7 }, { sku: 'A', quantity: 7 }]);
    expect(store.lines()).toEqual([{ sku: 'A', quantity: 10 }]);

    store.set(Array.from({ length: 12 }, (_, i) => ({ sku: `SKU-${String(i)}`, quantity: 1 })));
    expect(store.lines()).toHaveLength(10);
    expect(store.lines()[0]?.sku).toBe('SKU-0');
  });

  test('lines() hands out copies, so callers cannot change the bag', () => {
    const store = createBagStore(memoryStorage());
    store.set([{ sku: 'A', quantity: 1 }]);
    const first = store.lines();
    first.push({ sku: 'B', quantity: 1 });
    first[0] = { sku: 'Z', quantity: 9 };
    expect(store.lines()).toEqual([{ sku: 'A', quantity: 1 }]);
  });

  test('subscribers hear every change until they unsubscribe', () => {
    const store = createBagStore(memoryStorage());
    const heard: number[] = [];
    const unsubscribe = store.subscribe((lines) => heard.push(lines.length));

    store.set([{ sku: 'A', quantity: 1 }]);
    store.set([{ sku: 'A', quantity: 1 }, { sku: 'B', quantity: 1 }]);
    unsubscribe();
    store.set([]);

    expect(heard).toEqual([1, 2]);
  });

  test('a subscriber that throws does not stop the others or the change', () => {
    const store = createBagStore(memoryStorage());
    let heard = 0;
    store.subscribe(() => {
      throw new Error('a broken listener');
    });
    store.subscribe(() => (heard += 1));
    store.set([{ sku: 'A', quantity: 1 }]);
    expect(heard).toBe(1);
    expect(store.lines()).toEqual([{ sku: 'A', quantity: 1 }]);
  });
});
