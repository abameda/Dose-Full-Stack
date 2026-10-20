import { formatEgp } from '@dose/contract/money';
import { useEffect } from 'react';
import { Link } from 'react-router';
import type { AdminApi } from '../api';
import { formatWaiting, formatWhen } from '../format';
import { useLoad, usePageTitle } from '../hooks';
import { fill, s } from '../i18n';
import { LoadGate } from '../parts';

/** How often the queue asks the server again; it also asks when the window gets focus. */
export const TODAY_REFRESH_MS = 5_000;

/**
 * The inbox: the orders waiting to be confirmed, oldest first, with how long the oldest has
 * waited. It refreshes itself every five seconds and whenever the window or tab comes back, so a
 * new order shows up without anyone reloading.
 */
export function Today({ api }: { api: AdminApi }) {
  usePageTitle(`${s.todayTitle} · ${s.brand}`);
  const { state, reload } = useLoad(() => api.today(), 'today');

  useEffect(() => {
    const refresh = () => {
      void reload();
    };
    const refreshWhenShown = () => {
      if (!document.hidden) refresh();
    };
    const timer = window.setInterval(refresh, TODAY_REFRESH_MS);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenShown);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenShown);
    };
  }, [reload]);

  return (
    <>
      <h1>{s.todayTitle}</h1>
      <LoadGate state={state} retry={() => void reload()}>
        {(today, refreshFailed) => {
          const { count, oldestWaitingMinutes, orders } = today.toConfirm;
          return (
            <section aria-labelledby="to-confirm-heading">
              <h2 id="to-confirm-heading">{s.toConfirmHeading}</h2>
              <p className="admin-stat">
                <span className="admin-stat__number" data-testid="to-confirm-count">
                  {count}
                </span>{' '}
                <span>{s.toConfirmCount}</span>
              </p>
              {oldestWaitingMinutes === null ? null : (
                <p className="admin-muted">{fill(s.oldestWaiting, { time: formatWaiting(oldestWaitingMinutes) })}</p>
              )}
              {refreshFailed ? (
                <p className="admin-notice" role="status">
                  {s.refreshFailed}
                </p>
              ) : null}
              {orders.length === 0 ? (
                <p>{s.nothingToConfirm}</p>
              ) : (
                <ul className="admin-queue" aria-label={s.toConfirmHeading}>
                  {orders.map((order) => (
                    <li key={order.number}>
                      <Link className="admin-queue__row" to={`/orders/${encodeURIComponent(order.number)}`}>
                        <span className="admin-queue__number">{order.number}</span>
                        <span>{order.customerName}</span>
                        <span>{formatEgp(order.total, 'en')}</span>
                        <span className="admin-muted">{fill(s.placedAt, { time: formatWhen(order.createdAt) })}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        }}
      </LoadGate>
    </>
  );
}
