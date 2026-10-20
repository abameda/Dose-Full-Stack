import {
  cancelOrderInputSchema,
  confirmOrderInputSchema,
  CONFIRM_METHODS,
  ORDER_STATES,
  type ActorType,
  type AuditEntry,
  type AuditPage,
  type ConfirmMethod,
  type FulfilmentState,
  type Lang,
  type OrderActionResult,
  type OrderDetail,
  type OrderState,
  type OrderSummary,
  type PaymentState,
  type TimelineEntry,
  type TodayView,
} from '@dose/contract';
import type { Tx } from '@dose/core/db';
import { cancelOrder, confirmOrder, type ActionOutcome } from '@dose/core/order-actions';
import { normalisePhone } from '@dose/core/phone';
import type { Actor } from '@dose/core/stock';
import { Hono, type Context, type Handler } from 'hono';
import type { ApiDeps } from './app';
import { ADMIN_ROUTES, adminGuard, type AdminEnv } from './permissions';

/** Orders a list or the Today queue shows at most. */
const LIST_LIMIT = 100;
/** Audit events per page. */
const AUDIT_PAGE_SIZE = 50;
const MINUTE_MS = 60_000;

type AdminContext = Context<AdminEnv>;

// ── Rows and their views ─────────────────────────────────────────────────────────────────────

type SummaryRow = {
  number: string;
  created_at: Date;
  recipient_name: string;
  phone_e164: string;
  governorate: string;
  total: number;
  order_state: OrderState;
  payment_state: PaymentState;
  fulfilment_state: FulfilmentState;
  version: number;
};

const SUMMARY_COLUMNS = `o.number, o.created_at, o.recipient_name, c.phone_e164, o.governorate, o.total,
  o.order_state, o.payment_state, o.fulfilment_state, o.version`;

function toSummary(row: SummaryRow): OrderSummary {
  return {
    number: row.number,
    createdAt: row.created_at.toISOString(),
    customerName: row.recipient_name,
    customerPhone: row.phone_e164,
    governorate: row.governorate,
    total: row.total,
    orderState: row.order_state,
    paymentState: row.payment_state,
    fulfilmentState: row.fulfilment_state,
    version: row.version,
  };
}

/**
 * Who did it, in words: the staff member's name (staff are recorded by email), else the recorded
 * id (the customer's phone, the system job), else the kind of actor.
 */
const ACTOR_LABEL = `coalesce(s.name, a.actor_id, a.actor_type)`;
const STAFF_JOIN = `left join staff s on a.actor_type = 'staff' and s.email = a.actor_id::citext`;

type TimelineRow = {
  at: Date;
  actor_type: ActorType;
  actor_label: string;
  action: string;
  reason: string | null;
  note: string | null;
  method: string | null;
};

function toTimelineEntry(row: TimelineRow): TimelineEntry {
  const method = CONFIRM_METHODS.find((m): m is ConfirmMethod => m === row.method);
  return {
    at: row.at.toISOString(),
    actorType: row.actor_type,
    actorLabel: row.actor_label,
    action: row.action,
    ...(row.reason === null ? {} : { reason: row.reason }),
    ...(row.note === null ? {} : { note: row.note }),
    ...(method === undefined ? {} : { method }),
  };
}

type AuditRow = {
  id: string;
  at: Date;
  actor_type: ActorType;
  actor_id: string | null;
  actor_label: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  entity_version: number | null;
  reason: string | null;
  data: Record<string, unknown>;
};

function toAuditEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    at: row.at.toISOString(),
    actorType: row.actor_type,
    actorId: row.actor_id,
    actorLabel: row.actor_label,
    action: row.action,
    entity: row.entity,
    entityId: row.entity_id,
    entityVersion: row.entity_version,
    reason: row.reason,
    data: row.data,
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────────────────────

async function todayView(db: Tx, now: Date): Promise<TodayView> {
  const [queue] = await db.query<{ count: number; oldest: Date | null }>(
    `select count(*)::int as count, min(created_at) as oldest from orders where order_state = 'pending'`,
  );
  const rows = await db.query<SummaryRow>(
    `select ${SUMMARY_COLUMNS} from orders o join customers c on c.id = o.customer_id
      where o.order_state = 'pending' order by o.created_at, o.id limit $1`,
    [LIST_LIMIT],
  );
  const oldest = queue?.oldest ?? null;
  return {
    toConfirm: {
      count: queue?.count ?? 0,
      oldestWaitingMinutes: oldest === null ? null : Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / MINUTE_MS)),
      orders: rows.map(toSummary),
    },
  };
}

/**
 * Orders newest first, optionally in one state and matching `q`: a phone number as typed
 * (normalised to E.164 and matched against the customer and the recipient), or else an order number.
 */
async function searchOrders(db: Tx, filter: { state?: OrderState; q?: string }): Promise<OrderSummary[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const param = (value: unknown) => {
    params.push(value);
    return `$${String(params.length)}`;
  };
  if (filter.state !== undefined) where.push(`o.order_state = ${param(filter.state)}`);
  if (filter.q !== undefined) {
    const phone = normalisePhone(filter.q);
    if (phone.ok) {
      const p = param(phone.e164);
      where.push(`(c.phone_e164 = ${p} or o.recipient_phone = ${p})`);
    } else {
      where.push(`o.number = ${param(filter.q.toUpperCase())}`);
    }
  }
  const rows = await db.query<SummaryRow>(
    `select ${SUMMARY_COLUMNS} from orders o join customers c on c.id = o.customer_id
      ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
      order by o.created_at desc, o.id desc limit ${param(LIST_LIMIT)}`,
    params,
  );
  return rows.map(toSummary);
}

async function orderDetail(db: Tx, number: string): Promise<OrderDetail | null> {
  const [order] = await db.query<
    SummaryRow & {
      id: string;
      lang: Lang;
      direction: string;
      channel: 'web' | 'manual';
      payment_method: 'cod';
      area: string;
      street: string;
      building: string;
      landmark: string | null;
      subtotal: number;
      discount_total: number;
      delivery_fee: number;
    }
  >(
    `select ${SUMMARY_COLUMNS}, o.id, o.lang, o.direction, o.channel, o.payment_method, o.area, o.street, o.building,
            o.landmark, o.subtotal, o.discount_total, o.delivery_fee
       from orders o join customers c on c.id = o.customer_id
      where o.number = $1`,
    [number],
  );
  if (order === undefined) return null;

  const lines = await db.query<{
    sku: string;
    name_ar: string;
    name_en: string;
    unit_price: number;
    quantity: number;
    line_discount: number;
    line_total: number;
  }>(
    `select sku, name_ar, name_en, unit_price, quantity, line_discount, line_total
       from order_lines where order_id = $1 order by sku, id`,
    [order.id],
  );
  const timeline = await db.query<TimelineRow>(
    `select a.at, a.actor_type, ${ACTOR_LABEL} as actor_label, a.action, a.reason,
            a.data->>'note' as note, a.data->>'method' as method
       from audit_events a ${STAFF_JOIN}
      where a.entity = 'order' and a.entity_id = $1
      order by a.at, a.id`,
    [number],
  );

  return {
    ...toSummary(order),
    lang: order.lang,
    direction: order.direction,
    channel: order.channel,
    paymentMethod: order.payment_method,
    address: {
      governorate: order.governorate,
      area: order.area,
      street: order.street,
      building: order.building,
      ...(order.landmark === null ? {} : { landmark: order.landmark }),
    },
    lines: lines.map((l) => ({
      sku: l.sku,
      nameAr: l.name_ar,
      nameEn: l.name_en,
      unitPrice: l.unit_price,
      quantity: l.quantity,
      lineDiscount: l.line_discount,
      lineTotal: l.line_total,
    })),
    subtotal: order.subtotal,
    discountTotal: order.discount_total,
    deliveryFee: order.delivery_fee,
    timeline: timeline.map(toTimelineEntry),
  };
}

/** The audit log newest first, `AUDIT_PAGE_SIZE` at a time, before the event id `cursor`. */
async function auditPage(db: Tx, cursor: string | undefined): Promise<AuditPage> {
  const rows = await db.query<AuditRow>(
    `select a.id::text as id, a.at, a.actor_type, a.actor_id, ${ACTOR_LABEL} as actor_label, a.action, a.entity,
            a.entity_id, a.entity_version, a.reason, a.data
       from audit_events a ${STAFF_JOIN}
      where $1::bigint is null or a.id < $1::bigint
      order by a.id desc
      limit $2`,
    [cursor ?? null, AUDIT_PAGE_SIZE + 1],
  );
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  const last = page.at(-1);
  return { events: page.map(toAuditEntry), nextCursor: rows.length > AUDIT_PAGE_SIZE && last !== undefined ? last.id : null };
}

// ── Actions ──────────────────────────────────────────────────────────────────────────────────

const ACTION_STATUS = { conflict: 409, invalid: 422, not_found: 404 } as const;

function respond(c: AdminContext, outcome: ActionOutcome | OrderActionResult) {
  if (outcome.ok) return c.json({ ok: true, version: outcome.version } satisfies OrderActionResult, 200);
  if (outcome.code === 'conflict') {
    return c.json({ ok: false, code: 'conflict', current: outcome.current } satisfies OrderActionResult, ACTION_STATUS.conflict);
  }
  if (outcome.code === 'invalid') {
    const fields = 'fields' in outcome ? outcome.fields : [];
    return c.json({ ok: false, code: 'invalid', fields } satisfies OrderActionResult, ACTION_STATUS.invalid);
  }
  return c.json({ ok: false, code: 'not_found' } satisfies OrderActionResult, ACTION_STATUS.not_found);
}

/** Body paths for the admin to mark, once each. */
function invalidFields(error: { issues: readonly { path: readonly PropertyKey[] }[] }): string[] {
  return [...new Set(error.issues.map((issue) => issue.path.map(String).join('.')))];
}

async function jsonBody(c: AdminContext): Promise<unknown> {
  return c.req.json().catch(() => undefined);
}

/** Staff are recorded on stock movements and audit events by email. */
function staffActor(c: AdminContext): Actor {
  return { type: 'staff', id: c.get('staff').email };
}

// ── Routes ───────────────────────────────────────────────────────────────────────────────────

type AdminRouteKey<R = (typeof ADMIN_ROUTES)[number]> = R extends { method: infer M extends string; path: infer P extends string }
  ? `${M} ${P}`
  : never;

/** The `:number` segment. Every route that reads it declares it, so it is always there. */
function orderNumberOf(c: AdminContext): string {
  return c.req.param('number') ?? '';
}

function handlers(deps: ApiDeps): Record<AdminRouteKey, Handler<AdminEnv>> {
  return {
    'GET /api/admin/me': (c) => c.json(c.get('staff')),

    'GET /api/admin/today': async (c) => c.json(await todayView(c.get('db'), deps.now())),

    'GET /api/admin/orders': async (c) => {
      const stateParam = c.req.query('state');
      const state = ORDER_STATES.find((s) => s === stateParam);
      if (stateParam !== undefined && stateParam !== '' && state === undefined) {
        return c.json({ error: `state must be one of ${ORDER_STATES.join(', ')}` }, 400);
      }
      const q = c.req.query('q')?.trim();
      return c.json(
        await searchOrders(c.get('db'), {
          ...(state === undefined ? {} : { state }),
          ...(q === undefined || q === '' ? {} : { q }),
        }),
      );
    },

    'GET /api/admin/orders/:number': async (c) => {
      const detail = await orderDetail(c.get('db'), orderNumberOf(c));
      return detail === null ? c.json({ error: 'not_found' }, 404) : c.json(detail);
    },

    'POST /api/admin/orders/:number/confirm': async (c) => {
      const parsed = confirmOrderInputSchema.safeParse(await jsonBody(c));
      if (!parsed.success) return respond(c, { ok: false, code: 'invalid', fields: invalidFields(parsed.error) });
      const { expectedVersion, method, note } = parsed.data;
      const outcome = await confirmOrder(c.get('db'), {
        orderNumber: orderNumberOf(c),
        expectedVersion,
        method,
        actor: staffActor(c),
        ...(note === undefined ? {} : { note }),
      });
      return respond(c, outcome);
    },

    'POST /api/admin/orders/:number/cancel': async (c) => {
      const parsed = cancelOrderInputSchema.safeParse(await jsonBody(c));
      if (!parsed.success) return respond(c, { ok: false, code: 'invalid', fields: invalidFields(parsed.error) });
      const { expectedVersion, reason, note } = parsed.data;
      const outcome = await cancelOrder(c.get('db'), {
        orderNumber: orderNumberOf(c),
        expectedVersion,
        reason,
        actor: staffActor(c),
        ...(note === undefined ? {} : { note }),
      });
      return respond(c, outcome);
    },

    'GET /api/admin/audit': async (c) => {
      const cursor = c.req.query('cursor');
      if (cursor !== undefined && !/^[1-9]\d{0,17}$/.test(cursor)) return c.json({ error: 'cursor must be an event id' }, 400);
      return c.json(await auditPage(c.get('db'), cursor));
    },
  };
}

/** The admin API: exactly the routes in ADMIN_ROUTES, each behind `adminGuard`. */
export function adminRoutes(deps: ApiDeps): Hono<AdminEnv> {
  const routes = new Hono<AdminEnv>();
  routes.use('/api/admin/*', adminGuard(deps.verifyStaff));
  const byKey = handlers(deps);
  for (const route of ADMIN_ROUTES) {
    // TypeScript crosses every method with every path here; each entry is one real pair.
    routes.on(route.method, route.path, byKey[`${route.method} ${route.path}` as AdminRouteKey]);
  }
  return routes;
}
