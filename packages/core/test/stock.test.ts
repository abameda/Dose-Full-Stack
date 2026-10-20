import { describe, expect, test } from 'vitest';
import {
  adjustStock,
  getStock,
  InsufficientStock,
  NotReserved,
  receiveStock,
  releaseStock,
  reserveStock,
  sellReserved,
  type Actor,
} from '../src/stock';
import { makeProduct, makeVariant } from './factories';
import { withTestDb } from './harness';

const actor: Actor = { type: 'system', id: 'test' };

async function arrange(stock = 0) {
  const db = await withTestDb();
  const product = await makeProduct(db.owner);
  const variant = await makeVariant(db.owner, product.id, { stock });
  return { ...db, v: variant.id, productId: product.id };
}

test('rule 3: cannot reserve more than is free', async () => {
  const { app, v } = await arrange();
  await app.transaction((tx) => receiveStock(tx, { variantId: v, quantity: 2, sourceKey: 'receipt:1', actor }));
  expect(await app.transaction((tx) => reserveStock(tx, { variantId: v, quantity: 2, sourceKey: 'cart:1', actor }))).toBe(
    'reserved',
  );
  await expect(
    app.transaction((tx) => reserveStock(tx, { variantId: v, quantity: 1, sourceKey: 'cart:2', actor })),
  ).rejects.toThrow(InsufficientStock);
  expect(await getStock(app, v)).toEqual({ onHand: 2, reserved: 2, available: 0 });
  // The refused reservation rolled its movement back with it.
  expect(await app.query(`select 1 from stock_movements where source_key = 'cart:2'`)).toHaveLength(0);
});

test('InsufficientStock names the variant', async () => {
  const { app, v } = await arrange(1);
  const error = await app
    .transaction((tx) => reserveStock(tx, { variantId: v, quantity: 2, sourceKey: 'cart:1', actor }))
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(InsufficientStock);
  expect((error as InsufficientStock).variantId).toBe(v);
});

test('rule 5: the same source key moves stock once', async () => {
  const { app, v } = await arrange();
  const receive = () =>
    app.transaction((tx) => receiveStock(tx, { variantId: v, quantity: 5, sourceKey: 'receipt:1', actor }));
  expect(await receive()).toBe('applied');
  expect(await receive()).toBe('duplicate');
  expect((await getStock(app, v)).onHand).toBe(5);
  expect(await app.query(`select 1 from stock_movements where source_key = 'receipt:1'`)).toHaveLength(1);
});

test('rule 5: reserve, sell, release and adjust are each idempotent by source key', async () => {
  const { app, v } = await arrange(10);
  const args = (sourceKey: string, quantity = 3) => ({ variantId: v, quantity, sourceKey, actor });

  expect(await app.transaction((tx) => reserveStock(tx, args('r:1')))).toBe('reserved');
  expect(await app.transaction((tx) => reserveStock(tx, args('r:1')))).toBe('duplicate');
  expect(await getStock(app, v)).toEqual({ onHand: 10, reserved: 3, available: 7 });

  expect(await app.transaction((tx) => sellReserved(tx, args('s:1', 2)))).toBe('applied');
  expect(await app.transaction((tx) => sellReserved(tx, args('s:1', 2)))).toBe('duplicate');
  expect(await getStock(app, v)).toEqual({ onHand: 8, reserved: 1, available: 7 });

  expect(await app.transaction((tx) => releaseStock(tx, args('l:1', 1)))).toBe('applied');
  expect(await app.transaction((tx) => releaseStock(tx, args('l:1', 1)))).toBe('duplicate');
  expect(await getStock(app, v)).toEqual({ onHand: 8, reserved: 0, available: 8 });

  const adjust = () => app.transaction((tx) => adjustStock(tx, { variantId: v, delta: -2, sourceKey: 'a:1', actor }));
  expect(await adjust()).toBe('applied');
  expect(await adjust()).toBe('duplicate');
  expect(await getStock(app, v)).toEqual({ onHand: 6, reserved: 0, available: 6 });
});

test('a movement records the fixed deltas, reason and actor', async () => {
  const { app, owner, v } = await arrange();
  const staff: Actor = { type: 'staff', id: 'staff-1' };
  await app.transaction(async (tx) => {
    await receiveStock(tx, { variantId: v, quantity: 6, sourceKey: 'm:received', actor: staff });
    await reserveStock(tx, { variantId: v, quantity: 4, sourceKey: 'm:reserved', actor });
    await releaseStock(tx, { variantId: v, quantity: 1, sourceKey: 'm:released', actor });
    await sellReserved(tx, { variantId: v, quantity: 2, sourceKey: 'm:sold', actor });
    await adjustStock(tx, { variantId: v, delta: -1, sourceKey: 'm:adjusted', actor: staff });
  });
  const rows = await owner.query(
    `select reason, on_hand_delta, reserved_delta, actor_type, actor_id from stock_movements order by id`,
  );
  expect(rows).toEqual([
    { reason: 'received', on_hand_delta: 6, reserved_delta: 0, actor_type: 'staff', actor_id: 'staff-1' },
    { reason: 'reserved', on_hand_delta: 0, reserved_delta: 4, actor_type: 'system', actor_id: 'test' },
    { reason: 'released', on_hand_delta: 0, reserved_delta: -1, actor_type: 'system', actor_id: 'test' },
    { reason: 'sold', on_hand_delta: -2, reserved_delta: -2, actor_type: 'system', actor_id: 'test' },
    { reason: 'adjusted', on_hand_delta: -1, reserved_delta: 0, actor_type: 'staff', actor_id: 'staff-1' },
  ]);
  expect(await getStock(app, v)).toEqual({ onHand: 3, reserved: 1, available: 2 });
});

test('releasing or selling more than is reserved is refused and leaves no movement', async () => {
  const { app, v } = await arrange(5);
  await app.transaction((tx) => reserveStock(tx, { variantId: v, quantity: 1, sourceKey: 'r:1', actor }));
  await expect(
    app.transaction((tx) => releaseStock(tx, { variantId: v, quantity: 2, sourceKey: 'l:1', actor })),
  ).rejects.toThrow(NotReserved);
  await expect(
    app.transaction((tx) => sellReserved(tx, { variantId: v, quantity: 2, sourceKey: 's:1', actor })),
  ).rejects.toThrow(NotReserved);
  expect(await getStock(app, v)).toEqual({ onHand: 5, reserved: 1, available: 4 });
  expect(await app.query(`select 1 from stock_movements where source_key in ('l:1','s:1')`)).toHaveLength(0);
});

test('an adjustment cannot take on hand below what is reserved', async () => {
  const { app, v } = await arrange(5);
  await app.transaction((tx) => reserveStock(tx, { variantId: v, quantity: 4, sourceKey: 'r:1', actor }));
  await expect(
    app.transaction((tx) => adjustStock(tx, { variantId: v, delta: -2, sourceKey: 'a:1', actor })),
  ).rejects.toThrow(InsufficientStock);
  expect(await app.transaction((tx) => adjustStock(tx, { variantId: v, delta: -1, sourceKey: 'a:2', actor }))).toBe(
    'applied',
  );
  expect(await getStock(app, v)).toEqual({ onHand: 4, reserved: 4, available: 0 });
});

test('quantities must be positive whole numbers', async () => {
  const { app, v } = await arrange(5);
  for (const quantity of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
    await expect(
      app.transaction((tx) => receiveStock(tx, { variantId: v, quantity, sourceKey: `q:${String(quantity)}`, actor })),
    ).rejects.toThrow(RangeError);
  }
  await expect(
    app.transaction((tx) => adjustStock(tx, { variantId: v, delta: 0, sourceKey: 'a:0', actor })),
  ).rejects.toThrow(RangeError);
  expect((await getStock(app, v)).onHand).toBe(5);
});

test('getStock refuses a variant that does not exist', async () => {
  const { app } = await arrange();
  await expect(getStock(app, '00000000-0000-4000-8000-000000000000')).rejects.toThrow(/unknown variant/i);
});

test('buyers racing for the last unit: exactly one wins', async () => {
  const { app, v } = await arrange(1);
  const attempt = (key: string) =>
    app.transaction((tx) => reserveStock(tx, { variantId: v, quantity: 1, sourceKey: key, actor }));
  const results = await Promise.allSettled([attempt('race:1'), attempt('race:2'), attempt('race:3')]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  for (const r of results) {
    if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(InsufficientStock);
  }
  expect(await getStock(app, v)).toEqual({ onHand: 1, reserved: 1, available: 0 });
});

describe('the database enforces the rules without the helpers', () => {
  test('the database refuses reserved > on_hand even without the helpers', async () => {
    const { owner, v } = await arrange(3);
    await expect(owner.query(`update stock_levels set reserved = on_hand + 1 where variant_id = $1`, [v])).rejects.toThrow(
      /check/,
    );
    await expect(owner.query(`update stock_levels set reserved = -1 where variant_id = $1`, [v])).rejects.toThrow(/check/);
  });

  test('a movement must carry the deltas its reason fixes', async () => {
    const { owner, v } = await arrange();
    const insert = (reason: string, onHand: number, reserved: number) =>
      owner.query(
        `insert into stock_movements (variant_id, reason, on_hand_delta, reserved_delta, source_key, actor_type, actor_id)
         values ($1, $2, $3, $4, gen_random_uuid()::text, 'system', 'x')`,
        [v, reason, onHand, reserved],
      );
    await expect(insert('sold', -1, 0)).rejects.toThrow(/check/);
    await expect(insert('reserved', 1, 1)).rejects.toThrow(/check/);
    await expect(insert('released', 0, 1)).rejects.toThrow(/check/);
    await expect(insert('received', -1, 0)).rejects.toThrow(/check/);
    await expect(insert('adjusted', 0, 0)).rejects.toThrow(/check/);
    await expect(insert('lost', 1, 0)).rejects.toThrow(/check/);
    await insert('sold', -1, -1);
  });

  test('the source key is unique across all variants', async () => {
    const { app, owner, v, productId } = await arrange();
    const other = await makeVariant(owner, productId, { stock: 0 });
    await app.transaction((tx) => receiveStock(tx, { variantId: v, quantity: 1, sourceKey: 'shared', actor }));
    expect(
      await app.transaction((tx) => receiveStock(tx, { variantId: other.id, quantity: 1, sourceKey: 'shared', actor })),
    ).toBe('duplicate');
    expect((await getStock(app, other.id)).onHand).toBe(0);
  });

  test('a new variant starts with an empty stock row', async () => {
    const { owner, v } = await arrange();
    expect(await owner.query(`select on_hand, reserved from stock_levels where variant_id = $1`, [v])).toEqual([
      { on_hand: 0, reserved: 0 },
    ]);
  });

  test('the app role can read, insert and update the new tables and cannot delete from them', async () => {
    const { owner } = await withTestDb();
    const tables = ['products', 'product_images', 'variants', 'stock_levels', 'stock_movements'];
    const rows = await owner.query<{ t: string; sel: boolean; ins: boolean; upd: boolean; del: boolean; trunc: boolean }>(
      `select t,
              has_table_privilege('dose_app', t, 'SELECT') as sel,
              has_table_privilege('dose_app', t, 'INSERT') as ins,
              has_table_privilege('dose_app', t, 'UPDATE') as upd,
              has_table_privilege('dose_app', t, 'DELETE') as del,
              has_table_privilege('dose_app', t, 'TRUNCATE') as trunc
         from unnest($1::text[]) with ordinality as u(t, n) order by n`,
      [tables],
    );
    expect(rows.map((r) => r.t)).toEqual(tables);
    for (const r of rows) expect(r).toMatchObject({ sel: true, ins: true, upd: true, del: false, trunc: false });
    const [seq] = await owner.query<{ ok: boolean }>(
      `select has_sequence_privilege('dose_app', 'stock_movements_id_seq', 'USAGE') as ok`,
    );
    expect(seq?.ok).toBe(true);
  });
});
