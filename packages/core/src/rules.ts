// This file is also run directly by Node (scripts/check-rules.ts), which cannot resolve the
// extensionless imports used elsewhere in the package. It therefore imports only erased types.
import type { Db } from './db';

/**
 * A commerce rule (numbered as in section G of docs/master-plan.md) that the data breaks.
 * `ref` names the thing that is wrong: an order number, a SKU or a table.
 */
export type Violation = { rule: number; detail: string; ref?: string };

/** Each row a rule's query returns is one thing that is wrong. */
interface Finding {
  detail: string;
  ref: string;
}

/**
 * Rule 1: an order's figures add up. `total = subtotal - discount_total + delivery_fee`; the
 * subtotal is the gross sum of its lines (unit price x quantity, before discounts) and the discount
 * is the sum of the line discounts, so each discount is subtracted once (an order with no lines has
 * neither).
 */
const RULE_1 = `
  select format('order %s: subtotal %s, discount %s, delivery %s, total %s, but its lines add up to %s before discount %s',
                o.number, o.subtotal, o.discount_total, o.delivery_fee, o.total,
                coalesce(sum(l.unit_price::bigint * l.quantity), 0), coalesce(sum(l.line_discount), 0)) as detail,
         o.number as ref
    from orders o
    left join order_lines l on l.order_id = o.id
   group by o.id
  having o.total <> o.subtotal - o.discount_total + o.delivery_fee
      or o.subtotal <> coalesce(sum(l.unit_price::bigint * l.quantity), 0)
      or o.discount_total <> coalesce(sum(l.line_discount), 0)
   order by o.created_at, o.number`;

/** Rule 3: 0 <= reserved <= on_hand for every variant. */
const RULE_3 = `
  select format('variant %s: reserved %s with %s on hand', v.sku, s.reserved, s.on_hand) as detail,
         v.sku as ref
    from stock_levels s
    join variants v on v.id = s.variant_id
   where s.reserved < 0 or s.reserved > s.on_hand
   order by v.sku`;

/**
 * Rule 4: stock is held only by reservations that are still held. Per variant the held units equal
 * `reserved`; a held reservation belongs to a pending order; a consumed one to a confirmed order.
 */
const RULE_4 = `
  select format('variant %s: %s units in held reservations but %s reserved', v.sku, coalesce(h.units, 0), s.reserved) as detail,
         v.sku as ref
    from stock_levels s
    join variants v on v.id = s.variant_id
    left join (select variant_id, sum(quantity) as units from reservations where status = 'held' group by variant_id) h
      on h.variant_id = s.variant_id
   where coalesce(h.units, 0) <> s.reserved
  union all
  select format('order %s is %s but has %s reservation(s) still held', o.number, o.order_state, count(*)) as detail,
         o.number as ref
    from reservations r
    join orders o on o.id = r.order_id
   where r.status = 'held' and o.order_state <> 'pending'
   group by o.number, o.order_state
  union all
  select format('order %s is %s but has %s consumed reservation(s)', o.number, o.order_state, count(*)) as detail,
         o.number as ref
    from reservations r
    join orders o on o.id = r.order_id
   where r.status = 'consumed' and o.order_state <> 'confirmed'
   group by o.number, o.order_state
   order by 2, 1`;

/** Rule 5: stock on hand and reserved equal the sum of the variant's movements. */
const RULE_5 = `
  select format('variant %s: stock level %s on hand / %s reserved, but its movements add up to %s / %s',
                v.sku, s.on_hand, s.reserved, coalesce(m.on_hand, 0), coalesce(m.reserved, 0)) as detail,
         v.sku as ref
    from stock_levels s
    join variants v on v.id = s.variant_id
    left join (select variant_id, sum(on_hand_delta) as on_hand, sum(reserved_delta) as reserved
                 from stock_movements group by variant_id) m
      on m.variant_id = s.variant_id
   where s.on_hand <> coalesce(m.on_hand, 0) or s.reserved <> coalesce(m.reserved, 0)
   order by v.sku`;

/**
 * Rule 6: an order is in one of the allowed (order, payment, fulfilment) state combinations, its
 * payment row agrees with its payment state, and `orders.version` is the entity version of the
 * latest audit event of that order (every state change bumps the version and writes the event).
 * The combinations are the ones in states.ts that Milestone 1 can reach: an order is paid for
 * only by collection, and a cancelled order's payment is voided.
 */
const RULE_6 = `
  select format('order %s: %s / %s / %s is not an allowed combination', o.number, o.order_state, o.payment_state, o.fulfilment_state) as detail,
         o.number as ref
    from orders o
   where not exists (
     select 1
       from (values ('pending', 'awaiting_collection', 'unfulfilled'),
                    ('confirmed', 'awaiting_collection', 'unfulfilled'),
                    ('cancelled', 'voided', 'unfulfilled')) as allowed(order_state, payment_state, fulfilment_state)
      where allowed.order_state = o.order_state
        and allowed.payment_state = o.payment_state
        and allowed.fulfilment_state = o.fulfilment_state)
  union all
  select format('order %s: payment state is %s but its payment row (attempt %s) is %s', o.number, o.payment_state, p.attempt, p.state) as detail,
         o.number as ref
    from payments p
    join orders o on o.id = p.order_id
   where p.state <> o.payment_state
  union all
  select format('order %s: version %s but its audit events reach version %s', o.number, o.version, coalesce(a.version::text, 'none')) as detail,
         o.number as ref
    from orders o
    left join (select entity_id, max(entity_version) as version
                 from audit_events where entity = 'order' group by entity_id) a
      on a.entity_id = o.number
   where a.version is distinct from o.version
   order by 2, 1`;

/**
 * Whether a unique index on exactly `columns` (in that order) exists on the public table: the
 * constraint that makes the rule hold, read from the catalogue. Returns a row only when it is missing.
 */
const UNIQUE_INDEX_MISSING = `
  select $3::text as detail, $1::text as ref
   where not exists (
     select 1
       from pg_index i
       join pg_class c on c.oid = i.indrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = $1
        and i.indisunique and i.indisvalid
        and i.indpred is null and i.indexprs is null
        and i.indnkeyatts = i.indnatts
        and array(select a.attname::text
                    from unnest(i.indkey::int2[]) with ordinality as k(attnum, position)
                    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
                   order by k.position) = $2::text[])`;

/**
 * An append-only table: the application role holds none of UPDATE (on the table or any column),
 * DELETE and TRUNCATE on the public table `$1`, directly or through PUBLIC (decision 0003). Used for
 * the stock movement ledger (rule 5), webhook receipts (rule 8) and the audit log (rule 12).
 */
const APP_ROLE_CAN_REWRITE = `
  select format('dose_app can %s %s', privilege, $1::text) as detail, $1::text as ref
    from unnest(array['UPDATE', 'DELETE', 'TRUNCATE']) as p(privilege)
   where case privilege
           when 'UPDATE' then has_any_column_privilege('dose_app', ('public.' || $1)::regclass, privilege)
           else has_table_privilege('dose_app', ('public.' || $1)::regclass, privilege)
         end`;

async function violationsOf(db: Db, rule: number, sql: string, params?: unknown[]): Promise<Violation[]> {
  const rows = await db.query<Finding>(sql, params);
  return rows.map((row) => ({ rule, detail: row.detail, ref: row.ref }));
}

/**
 * Checks every commerce rule that exists so far against the data, one query per rule (rules 5 and
 * 8 add a second, for their append-only table), and returns what is broken (an empty list means
 * every rule holds), ordered by rule number. Read-only.
 *
 * Connect as the owner role (`dose_owner`): rules 5, 8 and 12 read the privileges of `dose_app`, and the
 * checker must see every row. A broken rule never throws; only a failing query (the database is
 * unreachable, or `dose_app` does not exist) does. Rules 2, 7, 9 and 10 arrive with the milestones
 * that introduce what they govern.
 */
export async function checkRules(db: Db): Promise<Violation[]> {
  return [
    ...(await violationsOf(db, 1, RULE_1)),
    ...(await violationsOf(db, 3, RULE_3)),
    ...(await violationsOf(db, 4, RULE_4)),
    ...(await violationsOf(db, 5, RULE_5)),
    ...(await violationsOf(db, 5, APP_ROLE_CAN_REWRITE, ['stock_movements'])),
    ...(await violationsOf(db, 6, RULE_6)),
    ...(await violationsOf(db, 8, UNIQUE_INDEX_MISSING, [
      'webhook_receipts',
      ['provider', 'event_id'],
      'webhook_receipts has no unique constraint on (provider, event_id), so a redelivered event would apply twice',
    ])),
    ...(await violationsOf(db, 8, APP_ROLE_CAN_REWRITE, ['webhook_receipts'])),
    ...(await violationsOf(db, 11, UNIQUE_INDEX_MISSING, [
      'outbox',
      ['dedupe_key'],
      'outbox has no unique constraint on (dedupe_key), so a message could be enqueued twice',
    ])),
    ...(await violationsOf(db, 12, APP_ROLE_CAN_REWRITE, ['audit_events'])),
  ];
}
