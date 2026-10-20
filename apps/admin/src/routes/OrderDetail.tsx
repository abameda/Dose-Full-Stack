import { ORDER_ACTOR_ROLES, type OrderActionResult, type OrderDetail as OrderDetailView, type Staff } from '@dose/contract';
import { formatEgp } from '@dose/contract/money';
import { Button } from '@dose/ui';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { AdminApi } from '../api';
import { CancelDialog, type CancelValues } from '../CancelDialog';
import { ConfirmDialog, type ConfirmValues } from '../ConfirmDialog';
import { formatWhen, governorateName, timelineSentence } from '../format';
import { useLoad, usePageTitle } from '../hooks';
import {
  FULFILMENT_STATE_EXPLANATION,
  FULFILMENT_STATE_LABEL,
  ORDER_STATE_EXPLANATION,
  PAYMENT_STATE_EXPLANATION,
  PAYMENT_STATE_LABEL,
  fill,
  s,
} from '../i18n';
import { LoadGate, StateBadge } from '../parts';

type Notice = { kind: 'done' | 'conflict'; text: string };

/** The order page for the number in the address. Keyed by the number so one order's notice never shows on another. */
export function OrderDetail({ api, staff }: { api: AdminApi; staff: Staff }) {
  const { number = '' } = useParams();
  return <OrderPage key={number} api={api} staff={staff} number={number} />;
}

function OrderPage({ api, staff, number }: { api: AdminApi; staff: Staff; number: string }) {
  usePageTitle(`${fill(s.orderHeading, { number })} · ${s.brand}`);
  const { state, reload } = useLoad(() => api.order(number), number);
  const [dialog, setDialog] = useState<'confirm' | 'cancel' | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  /**
   * Runs a confirm or cancel at the version the page showed. Answers the message for the dialog
   * when it should stay open, or null when it is done with: either way the order is read again, so
   * the page shows what is true now (a 409 says what the order is now, and the buttons follow).
   */
  const perform = async (run: () => Promise<OrderActionResult>, done: string): Promise<string | null> => {
    let result: OrderActionResult;
    try {
      result = await run();
    } catch {
      return s.actionFailed;
    }
    if (!result.ok && result.code === 'invalid') return s.actionInvalid;
    setDialog(null);
    if (result.ok) setNotice({ kind: 'done', text: done });
    else if (result.code === 'conflict') setNotice({ kind: 'conflict', text: fill(s.conflict, { state: result.current.orderState }) });
    else setNotice({ kind: 'conflict', text: s.vanished });
    await reload();
    return null;
  };

  return (
    <LoadGate state={state} retry={() => void reload()}>
      {(order, refreshFailed) => {
        if (order === null) {
          return (
            <>
              <p>
                <Link to="/orders">{s.backToOrders}</Link>
              </p>
              <p>{fill(s.orderNotFound, { number })}</p>
            </>
          );
        }
        const mayAct = (ORDER_ACTOR_ROLES as readonly string[]).includes(staff.role);
        const pending = order.orderState === 'pending';

        const confirm = (values: ConfirmValues) =>
          perform(() => api.confirm(order.number, { expectedVersion: order.version, ...values }), s.confirmedNotice);
        const cancel = (values: CancelValues) =>
          perform(() => api.cancel(order.number, { expectedVersion: order.version, ...values }), s.cancelledNotice);

        return (
          <article>
            <p>
              <Link to="/orders">{s.backToOrders}</Link>
            </p>
            <h1>{fill(s.orderHeading, { number: order.number })}</h1>

            {notice === null ? null : (
              <p className={`admin-notice${notice.kind === 'conflict' ? ' admin-notice--error' : ''}`} role={notice.kind === 'conflict' ? 'alert' : 'status'}>
                {notice.text}
              </p>
            )}
            {refreshFailed ? (
              <p className="admin-notice" role="status">
                {s.orderRefreshFailed}
              </p>
            ) : null}

            {mayAct && pending ? (
              <div className="admin-actions">
                <Button
                  ref={confirmButton}
                  onClick={() => {
                    setDialog('confirm');
                  }}
                >
                  {s.confirmButton}
                </Button>
                <Button
                  ref={cancelButton}
                  variant="secondary"
                  onClick={() => {
                    setDialog('cancel');
                  }}
                >
                  {s.cancelButton}
                </Button>
              </div>
            ) : null}
            {mayAct && !pending ? <p className="admin-muted">{fill(s.noMoreActions, { state: order.orderState })}</p> : null}

            <States order={order} />
            <Customer order={order} />
            <Items order={order} />
            <Timeline order={order} />

            {dialog === 'confirm' ? (
              <ConfirmDialog
                order={order}
                onClose={() => {
                  setDialog(null);
                }}
                onSubmit={confirm}
                returnFocusTo={confirmButton}
              />
            ) : null}
            {dialog === 'cancel' ? (
              <CancelDialog
                order={order}
                onClose={() => {
                  setDialog(null);
                }}
                onSubmit={cancel}
                returnFocusTo={cancelButton}
              />
            ) : null}
          </article>
        );
      }}
    </LoadGate>
  );
}

/** The three states, each named and explained in plain words. */
function States({ order }: { order: OrderDetailView }) {
  return (
    <section aria-labelledby="states-heading">
      <h2 id="states-heading">{s.statesHeading}</h2>
      <dl className="admin-states">
        <div>
          <dt>{s.orderStateLabel}</dt>
          <dd>
            <span data-testid="order-state">
              <StateBadge state={order.orderState} />
            </span>
            <p className="admin-muted" data-testid="order-state-explanation">
              {ORDER_STATE_EXPLANATION[order.orderState]}
            </p>
          </dd>
        </div>
        <div>
          <dt>{s.paymentStateLabel}</dt>
          <dd>
            <span data-testid="payment-state">{PAYMENT_STATE_LABEL[order.paymentState]}</span>
            <p className="admin-muted" data-testid="payment-state-explanation">
              {PAYMENT_STATE_EXPLANATION[order.paymentState]}
            </p>
          </dd>
        </div>
        <div>
          <dt>{s.fulfilmentStateLabel}</dt>
          <dd>
            <span data-testid="fulfilment-state">{FULFILMENT_STATE_LABEL[order.fulfilmentState]}</span>
            <p className="admin-muted" data-testid="fulfilment-state-explanation">
              {FULFILMENT_STATE_EXPLANATION[order.fulfilmentState]}
            </p>
          </dd>
        </div>
      </dl>
    </section>
  );
}

function Customer({ order }: { order: OrderDetailView }) {
  const { address } = order;
  const where = [address.building, address.street, address.area, governorateName(address.governorate)];
  return (
    <section aria-labelledby="customer-heading">
      <h2 id="customer-heading">{s.customerHeading}</h2>
      <p className="admin-strong">{order.customerName}</p>
      <p>
        <a href={`tel:${order.customerPhone}`}>{order.customerPhone}</a>
      </p>
      <h3>{s.addressHeading}</h3>
      <p>{where.join(', ')}</p>
      {address.landmark === undefined || address.landmark === '' ? null : <p className="admin-muted">{address.landmark}</p>}
    </section>
  );
}

function Items({ order }: { order: OrderDetailView }) {
  return (
    <section aria-labelledby="items-heading">
      <h2 id="items-heading">{s.itemsHeading}</h2>
      <table className="admin-table" aria-label={s.itemsLabel}>
        <thead>
          <tr>
            <th scope="col">{s.columnItem}</th>
            <th scope="col">{s.columnUnitPrice}</th>
            <th scope="col">{s.columnQuantity}</th>
            <th scope="col">{s.columnLineTotal}</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => (
            <tr key={line.sku}>
              <th scope="row" data-label={s.columnItem}>
                <span>{line.nameEn}</span>
                <span className="admin-muted admin-block">{line.sku}</span>
              </th>
              <td data-label={s.columnUnitPrice}>{formatEgp(line.unitPrice, 'en')}</td>
              <td data-label={s.columnQuantity}>{line.quantity}</td>
              <td data-label={s.columnLineTotal}>{formatEgp(line.lineTotal, 'en')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div role="group" aria-label={s.totalsHeading}>
        <dl className="admin-totals">
          <div>
            <dt>{s.subtotal}</dt>
            <dd>{formatEgp(order.subtotal, 'en')}</dd>
          </div>
          {order.discountTotal > 0 ? (
            <div>
              <dt>{s.discount}</dt>
              <dd>−{formatEgp(order.discountTotal, 'en')}</dd>
            </div>
          ) : null}
          <div>
            <dt>{s.delivery}</dt>
            <dd>{formatEgp(order.deliveryFee, 'en')}</dd>
          </div>
          <div className="admin-totals__total">
            <dt>{s.total}</dt>
            <dd>{formatEgp(order.total, 'en')}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function Timeline({ order }: { order: OrderDetailView }) {
  return (
    <section aria-labelledby="timeline-heading">
      <h2 id="timeline-heading">{s.timelineHeading}</h2>
      <ol className="admin-timeline" aria-label={s.timelineHeading}>
        {order.timeline.map((entry, index) => (
          <li key={`${entry.at}-${String(index)}`}>
            <p className="admin-strong">{timelineSentence(entry)}</p>
            <p className="admin-muted">
              <time dateTime={entry.at}>{formatWhen(entry.at)}</time>
            </p>
            {entry.note === undefined ? null : <p>“{entry.note}”</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
