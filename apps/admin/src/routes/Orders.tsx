import { ORDER_STATES, type OrderState } from '@dose/contract';
import { formatEgp } from '@dose/contract/money';
import { Button } from '@dose/ui';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { AdminApi } from '../api';
import { formatWhen } from '../format';
import { useLoad, usePageTitle } from '../hooks';
import { ORDER_STATE_LABEL, s } from '../i18n';
import { LoadGate, StateBadge } from '../parts';

/** The state in the address bar, if it is one we know. */
function stateOf(value: string | null): OrderState | undefined {
  return ORDER_STATES.find((state) => state === value);
}

/**
 * The order list, newest first. The search (a phone number as typed, or an order number) and the
 * state filter live in the address (`?q=…&state=…`), so the back button returns to the same list.
 */
export function Orders({ api }: { api: AdminApi }) {
  usePageTitle(`${s.ordersTitle} · ${s.brand}`);
  const [params, setParams] = useSearchParams();
  const q = params.get('q')?.trim() ?? '';
  const state = stateOf(params.get('state'));
  const [draft, setDraft] = useState(q);
  // The back and forward buttons change the search without the form.
  useEffect(() => {
    setDraft(q);
  }, [q]);

  const { state: loaded, reload } = useLoad(
    () => api.orders({ ...(q === '' ? {} : { q }), ...(state === undefined ? {} : { state }) }),
    `${q}|${state ?? ''}`,
  );

  const change = (next: { q?: string; state?: OrderState | undefined }) => {
    const query = next.q ?? q;
    const filter = 'state' in next ? next.state : state;
    setParams({ ...(query === '' ? {} : { q: query }), ...(filter === undefined ? {} : { state: filter }) });
  };

  const search = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    change({ q: draft.trim() });
  };

  return (
    <>
      <h1>{s.ordersTitle}</h1>
      <form className="admin-filter" role="search" onSubmit={search}>
        <div className="dose-field">
          <label className="dose-field__label" htmlFor="order-search">
            {s.searchLabel}
          </label>
          <input
            id="order-search"
            className="dose-field__control"
            type="search"
            inputMode="search"
            autoComplete="off"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
        </div>
        <Button type="submit">{s.searchButton}</Button>
        <div className="dose-field">
          <label className="dose-field__label" htmlFor="order-state-filter">
            {s.stateFilterLabel}
          </label>
          <select
            id="order-state-filter"
            className="dose-field__control"
            value={state ?? ''}
            onChange={(event) => {
              change({ state: stateOf(event.target.value) });
            }}
          >
            <option value="">{s.allStates}</option>
            {ORDER_STATES.map((value) => (
              <option key={value} value={value}>
                {ORDER_STATE_LABEL[value]}
              </option>
            ))}
          </select>
        </div>
      </form>

      <LoadGate state={loaded} retry={() => void reload()}>
        {(orders) =>
          orders.length === 0 ? (
            <p>{s.noOrders}</p>
          ) : (
            <table className="admin-table" aria-label={s.ordersTitle}>
              <thead>
                <tr>
                  <th scope="col">{s.columnOrder}</th>
                  <th scope="col">{s.columnPlaced}</th>
                  <th scope="col">{s.columnCustomer}</th>
                  <th scope="col">{s.columnTotal}</th>
                  <th scope="col">{s.columnState}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.number}>
                    <th scope="row" data-label={s.columnOrder}>
                      <Link to={`/orders/${encodeURIComponent(order.number)}`}>{order.number}</Link>
                    </th>
                    <td data-label={s.columnPlaced}>{formatWhen(order.createdAt)}</td>
                    <td data-label={s.columnCustomer}>
                      <span>{order.customerName}</span>
                      <span className="admin-muted admin-block">{order.customerPhone}</span>
                    </td>
                    <td data-label={s.columnTotal}>{formatEgp(order.total, 'en')}</td>
                    <td data-label={s.columnState}>
                      <StateBadge state={order.orderState} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </LoadGate>
    </>
  );
}
