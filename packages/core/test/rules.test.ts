import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { placeCodOrder, quoteBag, type BagLine } from '../src/checkout';
import type { Db } from '../src/db';
import { cancelOrder, confirmOrder } from '../src/order-actions';
import { checkRules } from '../src/rules';
import type { Actor } from '../src/stock';
import { makeProduct, makeVariant } from './factories';
import { withTestDb } from './harness';

const NOW = new Date('2026-10-20T10:00:00.000Z');
const staff: Actor = { type: 'staff', id: 'ops@example.test' };

/** Places a cash-on-delivery order through the real checkout and returns its number. */
async function place(app: Db, lines: BagLine[]): Promise<string> {
  const quote = await quoteBag(app, lines, 'cairo');
  if ('unknownSkus' in quote) throw new Error(`unknown SKUs ${quote.unknownSkus.join(', ')}`);
  const outcome = await placeCodOrder(app, {
    idempotencyKey: randomUUID(),
    lang: 'en',
    direction: 'd0-baseline',
    surface: 'storefront',
    lines,
    quotedTotal: quote.total,
    customer: { name: 'Test Customer', phone: '01012345678' },
    address: { governorate: 'cairo', area: 'Nasr City', street: 'Test Street', building: '12' },
    now: NOW,
  });
  if (!outcome.ok) throw new Error(`expected an order, got ${JSON.stringify(outcome)}`);
  return outcome.orderNumber;
}

/**
 * A database holding real activity made only through the application code: one pending, one
 * confirmed and one cancelled order over two variants, so every rule has something to check.
 */
async function arrange() {
  const db = await withTestDb();
  const product = await makeProduct(db.owner, { status: 'published' });
  const a = await makeVariant(db.owner, product.id, { stock: 10 });
  const b = await makeVariant(db.owner, product.id, { stock: 5 });

  const pending = await place(db.app, [{ sku: a.sku, quantity: 2 }]);
  const confirmed = await place(db.app, [
    { sku: a.sku, quantity: 1 },
    { sku: b.sku, quantity: 1 },
  ]);
  const cancelled = await place(db.app, [{ sku: b.sku, quantity: 1 }]);
  const confirm = await confirmOrder(db.app, { orderNumber: confirmed, expectedVersion: 1, actor: staff, method: 'phone' });
  const cancel = await cancelOrder(db.app, { orderNumber: cancelled, expectedVersion: 1, actor: staff, reason: 'customer_request' });
  if (!confirm.ok || !cancel.ok) throw new Error('arranging the confirm and cancel failed');

  return { ...db, variants: { a, b }, orders: { pending, confirmed, cancelled } };
}
type Arranged = Awaited<ReturnType<typeof arrange>>;

/** Drops the one check or unique constraint of `table` whose definition contains `like`, so a rule can be broken past it. */
async function dropConstraint(owner: Db, table: string, kind: 'c' | 'u', like: string): Promise<void> {
  const rows = await owner.query<{ conname: string }>(
    `select conname from pg_constraint
      where conrelid = $1::regclass and contype = $2 and pg_get_constraintdef(oid) like $3`,
    [table, kind, `%${like}%`],
  );
  const [row] = rows;
  if (rows.length !== 1 || row === undefined) throw new Error(`expected one ${kind} constraint on ${table} matching ${like}`);
  await owner.query(`alter table ${table} drop constraint ${row.conname}`);
}

function rulesOf(violations: { rule: number }[]): number[] {
  return [...new Set(violations.map((v) => v.rule))].sort((x, y) => x - y);
}

describe('checkRules on a database that follows the rules', () => {
  test('a freshly migrated database has no violations', async () => {
    const { owner } = await withTestDb();
    expect(await checkRules(owner)).toEqual([]);
  });

  test('a database with orders placed, confirmed and cancelled through the code has no violations', async () => {
    const { owner } = await arrange();
    expect(await checkRules(owner)).toEqual([]);
  });
});

interface Corruption {
  name: string;
  /** Breaks the rules from the owner connection, past the database's own checks. */
  corrupt: (ctx: Arranged) => Promise<void>;
  /** Every rule number the corruption is expected to trip, ascending (some corruptions break two). */
  rules: number[];
  /** Part of the violation's `ref` or `detail` that points at the broken thing. */
  mentions: (ctx: Arranged) => string;
}

const corruptions: Corruption[] = [
  {
    name: 'rule 1: an order whose subtotal and total were raised without any line changing',
    corrupt: ({ owner, orders }) =>
      owner
        .query(`update orders set subtotal = subtotal + 100, total = total + 100 where number = $1`, [orders.pending])
        .then(() => undefined),
    rules: [1],
    mentions: ({ orders }) => orders.pending,
  },
  {
    name: 'rule 1: an order whose lines were removed',
    corrupt: ({ owner, orders }) =>
      owner
        .query(`delete from order_lines where order_id = (select id from orders where number = $1)`, [orders.pending])
        .then(() => undefined),
    rules: [1],
    mentions: ({ orders }) => orders.pending,
  },
  {
    name: 'rule 1: an order whose total no longer adds up (constraint removed first)',
    corrupt: async ({ owner, orders }) => {
      await dropConstraint(owner, 'orders', 'c', 'total = ');
      await owner.query(`update orders set total = total + 1 where number = $1`, [orders.pending]);
    },
    rules: [1],
    mentions: ({ orders }) => orders.pending,
  },
  {
    name: 'rule 3: reserved above on hand (constraint removed first)',
    corrupt: async ({ owner, variants }) => {
      await dropConstraint(owner, 'stock_levels', 'c', 'reserved');
      await owner.query(`update stock_levels set reserved = on_hand + 1 where variant_id = $1`, [variants.a.id]);
    },
    // The counters also no longer match the movements or the held reservations.
    rules: [3, 4, 5],
    mentions: ({ variants }) => variants.a.sku,
  },
  {
    name: 'rule 3: reserved below zero (constraint removed first)',
    corrupt: async ({ owner, variants }) => {
      await dropConstraint(owner, 'stock_levels', 'c', 'reserved');
      await owner.query(`update stock_levels set reserved = -1 where variant_id = $1`, [variants.a.id]);
    },
    rules: [3, 4, 5],
    mentions: ({ variants }) => variants.a.sku,
  },
  {
    name: 'rule 4: reserved raised without a held reservation behind it',
    corrupt: ({ owner, variants }) =>
      owner.query(`update stock_levels set reserved = reserved + 1 where variant_id = $1`, [variants.a.id]).then(() => undefined),
    // Also rule 5: no movement backs the extra unit.
    rules: [4, 5],
    mentions: ({ variants }) => variants.a.sku,
  },
  {
    name: 'rule 4: a reservation flipped back to held on a confirmed order',
    corrupt: ({ owner, orders }) =>
      owner
        .query(`update reservations set status = 'held' where order_id = (select id from orders where number = $1)`, [orders.confirmed])
        .then(() => undefined),
    rules: [4],
    mentions: ({ orders }) => orders.confirmed,
  },
  {
    name: 'rule 4: a held reservation on a cancelled order',
    corrupt: ({ owner, orders }) =>
      owner
        .query(`update reservations set status = 'held' where order_id = (select id from orders where number = $1)`, [orders.cancelled])
        .then(() => undefined),
    rules: [4],
    mentions: ({ orders }) => orders.cancelled,
  },
  {
    name: 'rule 4: a consumed reservation on a pending order',
    corrupt: ({ owner, orders }) =>
      owner
        .query(`update reservations set status = 'consumed' where order_id = (select id from orders where number = $1)`, [orders.pending])
        .then(() => undefined),
    rules: [4],
    mentions: ({ orders }) => orders.pending,
  },
  {
    name: 'rule 5: a movement recorded without the stock level following',
    corrupt: ({ owner, variants }) =>
      owner
        .query(
          `insert into stock_movements (variant_id, reason, on_hand_delta, reserved_delta, source_key, actor_type, actor_id)
           values ($1, 'received', 1, 0, $2, 'system', 'test')`,
          [variants.b.id, `corrupt:${randomUUID()}`],
        )
        .then(() => undefined),
    rules: [5],
    mentions: ({ variants }) => variants.b.sku,
  },
  {
    name: 'rule 5: on hand changed without a movement',
    corrupt: ({ owner, variants }) =>
      owner.query(`update stock_levels set on_hand = on_hand + 1 where variant_id = $1`, [variants.b.id]).then(() => undefined),
    rules: [5],
    mentions: ({ variants }) => variants.b.sku,
  },
  {
    name: 'rule 6: a cancelled order whose payment is still awaiting collection',
    corrupt: ({ owner, orders }) =>
      owner
        .query(`update orders set payment_state = 'awaiting_collection' where number = $1`, [orders.cancelled])
        .then(() => undefined),
    // The order and its payment row also disagree.
    rules: [6],
    mentions: ({ orders }) => orders.cancelled,
  },
  {
    name: 'rule 6: a pending order whose payment is already voided',
    corrupt: ({ owner, orders }) =>
      owner.query(`update orders set payment_state = 'voided' where number = $1`, [orders.pending]).then(() => undefined),
    rules: [6],
    mentions: ({ orders }) => orders.pending,
  },
  {
    name: 'rule 6: a payment row that disagrees with its order',
    corrupt: ({ owner, orders }) =>
      owner
        .query(`update payments set state = 'voided' where order_id = (select id from orders where number = $1)`, [orders.pending])
        .then(() => undefined),
    rules: [6],
    mentions: ({ orders }) => orders.pending,
  },
  {
    name: 'rule 6: orders.version bumped without an audit event',
    corrupt: ({ owner, orders }) =>
      owner.query(`update orders set version = version + 1 where number = $1`, [orders.confirmed]).then(() => undefined),
    rules: [6],
    mentions: ({ orders }) => orders.confirmed,
  },
  {
    name: 'rule 6: an order whose audit events were never written',
    corrupt: ({ owner, orders }) =>
      owner
        .query(`delete from audit_events where entity = 'order' and entity_id = $1`, [orders.pending])
        .then(() => undefined),
    rules: [6],
    mentions: ({ orders }) => orders.pending,
  },
  {
    name: 'rule 8: the unique constraint on webhook receipts removed',
    corrupt: ({ owner }) => dropConstraint(owner, 'webhook_receipts', 'u', 'provider, event_id'),
    rules: [8],
    mentions: () => 'webhook_receipts',
  },
  {
    name: 'rule 11: the unique constraint on the outbox dedupe key removed',
    corrupt: ({ owner }) => dropConstraint(owner, 'outbox', 'u', 'dedupe_key'),
    rules: [11],
    mentions: () => 'outbox',
  },
  {
    name: 'rule 12: UPDATE on audit_events granted to dose_app',
    corrupt: ({ owner }) => owner.query(`grant update on audit_events to dose_app`).then(() => undefined),
    rules: [12],
    mentions: () => 'UPDATE',
  },
  {
    name: 'rule 12: DELETE on audit_events granted to dose_app',
    corrupt: ({ owner }) => owner.query(`grant delete on audit_events to dose_app`).then(() => undefined),
    rules: [12],
    mentions: () => 'DELETE',
  },
  {
    name: 'rule 12: TRUNCATE on audit_events granted to dose_app',
    corrupt: ({ owner }) => owner.query(`grant truncate on audit_events to dose_app`).then(() => undefined),
    rules: [12],
    mentions: () => 'TRUNCATE',
  },
  {
    name: 'rule 12: DELETE on audit_events granted to everyone',
    corrupt: ({ owner }) => owner.query(`grant delete on audit_events to public`).then(() => undefined),
    rules: [12],
    mentions: () => 'DELETE',
  },
];

describe('checkRules reports a broken rule', () => {
  test.each(corruptions)('$name', async (c) => {
    const ctx = await arrange();
    await c.corrupt(ctx);

    const violations = await checkRules(ctx.owner);

    expect(rulesOf(violations)).toEqual(c.rules);
    const mention = c.mentions(ctx);
    expect(violations.some((v) => v.detail.includes(mention) || v.ref === mention)).toBe(true);
    for (const v of violations) expect(v.detail).not.toBe('');
  });
});
