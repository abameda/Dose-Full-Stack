import type { Tx } from './db';
import type { Actor } from './stock';

export interface AuditEvent {
  actor: Actor;
  /** What happened, e.g. `order.confirmed`. */
  action: string;
  entity: string;
  /** For orders this is the order number (e.g. `D10001`), not the row id. */
  entityId: string;
  /** For orders, `orders.version` after the change. */
  entityVersion?: number;
  reason?: string;
  data?: Record<string, unknown>;
}

/**
 * Appends one event to the audit log. Call it on the `Tx` of the change it describes, so the
 * event and the change commit or roll back together. The app role can only insert and read
 * audit events (rule 12).
 */
export async function writeAudit(tx: Tx, e: AuditEvent): Promise<void> {
  await tx.query(
    `insert into audit_events (actor_type, actor_id, action, entity, entity_id, entity_version, reason, data)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      e.actor.type,
      e.actor.id,
      e.action,
      e.entity,
      e.entityId,
      e.entityVersion ?? null,
      e.reason ?? null,
      JSON.stringify(e.data ?? {}),
    ],
  );
}
