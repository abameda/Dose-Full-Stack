import { AUDIT_READER_ROLES, type AuditEntry, type AuditPage, type Staff } from '@dose/contract';
import { Button } from '@dose/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import type { AdminApi } from '../api';
import { actorName, eventSentence, formatWhen } from '../format';
import { useLoad, usePageTitle } from '../hooks';
import { s } from '../i18n';
import { LoadGate } from '../parts';

/** The audit log, owner only: every recorded event, newest first, a page at a time. */
export function Audit({ api, staff }: { api: AdminApi; staff: Staff }) {
  usePageTitle(`${s.auditTitle} · ${s.brand}`);
  const allowed = (AUDIT_READER_ROLES as readonly string[]).includes(staff.role);
  return (
    <>
      <h1>{s.auditTitle}</h1>
      {allowed ? <AuditLog api={api} /> : <p>{s.auditOwnerOnly}</p>}
    </>
  );
}

function AuditLog({ api }: { api: AdminApi }) {
  const { state, reload } = useLoad(() => api.audit(undefined), 'first');
  // The pages after the first, appended as they are asked for.
  const [older, setOlder] = useState<{ events: AuditEntry[]; nextCursor: string | null } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);

  const loadOlder = async (cursor: string) => {
    setLoadingOlder(true);
    setOlderFailed(false);
    try {
      const page: AuditPage = await api.audit(cursor);
      setOlder((before) => ({ events: [...(before?.events ?? []), ...page.events], nextCursor: page.nextCursor }));
    } catch {
      setOlderFailed(true);
    } finally {
      setLoadingOlder(false);
    }
  };

  return (
    <LoadGate state={state} retry={() => void reload()} errorText={s.auditLoadFailed}>
      {(first) => {
        const events = [...first.events, ...(older?.events ?? [])];
        const nextCursor = older === null ? first.nextCursor : older.nextCursor;
        if (events.length === 0) return <p>{s.auditEmpty}</p>;
        return (
          <>
            <table className="admin-table" aria-label={s.auditTitle}>
              <thead>
                <tr>
                  <th scope="col">{s.columnWhen}</th>
                  <th scope="col">{s.columnWho}</th>
                  <th scope="col">{s.columnWhat}</th>
                  <th scope="col">{s.columnSubject}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td data-label={s.columnWhen}>
                      <time dateTime={event.at}>{formatWhen(event.at)}</time>
                    </td>
                    <td data-label={s.columnWho}>{actorName(event.actorType, event.actorLabel)}</td>
                    <td data-label={s.columnWhat}>{eventSentence(event)}</td>
                    <td data-label={s.columnSubject}>
                      <Subject event={event} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {olderFailed ? (
              <p className="admin-notice admin-notice--error" role="alert">
                {s.auditLoadFailed}
              </p>
            ) : null}
            {nextCursor === null ? null : (
              <Button variant="secondary" disabled={loadingOlder} onClick={() => void loadOlder(nextCursor)}>
                {s.loadOlder}
              </Button>
            )}
          </>
        );
      }}
    </LoadGate>
  );
}

/** What the event is about: an order links to its page. */
function Subject({ event }: { event: AuditEntry }) {
  if (event.entity === null || event.entityId === null) return <span className="admin-muted">—</span>;
  if (event.entity === 'order') return <Link to={`/orders/${encodeURIComponent(event.entityId)}`}>{event.entityId}</Link>;
  return <span>{`${event.entity} ${event.entityId}`}</span>;
}
