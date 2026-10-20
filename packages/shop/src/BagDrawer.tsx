import type { BagLine, Lang } from '@dose/contract';
import { MAX_LINE_QUANTITY } from '@dose/contract/limits';
import { formatEgp } from '@dose/contract/money';
import { Button, Dialog, LinkButton } from '@dose/ui';
import { useEffect, useRef, useState } from 'react';
import { fill, t } from './i18n';
import { shopClientFor } from './shop-client';
import { skuKey, useBag } from './use-bag';

export type BagDrawerProps = {
  lang: Lang;
  /** The design direction that renders the page (stored on the order). */
  direction: string;
  surface?: 'storefront' | 'studio';
  /** Where the checkout button goes, e.g. `/en/checkout`. */
  checkoutHref: string;
};

type Priced = { name: string; unitPrice: number };
type Pricing =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; priced: ReadonlyMap<string, Priced>; unavailable: readonly string[] };

function units(lines: readonly BagLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

/**
 * The bag: a button that shows how many units are in it, and the dialog it opens. The lines are
 * kept in the browser; names and prices come from the API each time the dialog opens, so the
 * bag never shows a price from last week. One island, kept alive across page navigations
 * (`transition:persist` in the direction's layout).
 */
export function BagDrawer({ lang, direction, surface = 'storefront', checkoutHref }: BagDrawerProps) {
  const s = t(lang);
  const client = shopClientFor(surface, direction);
  const { lines } = useBag(client);
  const [open, setOpen] = useState(false);
  const [pricing, setPricing] = useState<Pricing>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const key = skuKey(lines);

  // Price the bag whenever the dialog opens or the set of items changes (not for a quantity).
  useEffect(() => {
    if (!open || key === '') return undefined;
    let current = true;
    setPricing((before) => (before.status === 'ready' ? before : { status: 'loading' }));
    client
      .quote(lang)
      .then((view) => {
        if (!current) return;
        const priced = new Map(view.lines.map((line) => [line.sku, { name: line.name, unitPrice: line.unitPrice }]));
        setPricing({ status: 'ready', priced, unavailable: view.unavailable });
      })
      .catch(() => {
        if (current) setPricing({ status: 'error' });
      });
    return () => {
      current = false;
    };
  }, [open, key, lang, client, attempt]);

  const close = () => { setOpen(false); };

  let body;
  if (lines.length === 0) {
    body = (
      <>
        <p>{s.bagEmpty}</p>
        <Button variant="secondary" block onClick={close}>
          {s.continueShopping}
        </Button>
      </>
    );
  } else if (pricing.status === 'error') {
    body = (
      <>
        <p role="alert">{s.bagError}</p>
        <Button variant="secondary" block onClick={() => { setAttempt((n) => n + 1); }}>
          {s.retry}
        </Button>
      </>
    );
  } else if (pricing.status === 'loading' || lines.some((l) => !pricing.priced.has(l.sku) && !pricing.unavailable.includes(l.sku))) {
    body = <p role="status">{s.bagLoading}</p>;
  } else {
    const rows = lines.map((line) => {
      const priced = pricing.priced.get(line.sku);
      return { ...line, priced, name: priced?.name ?? line.sku };
    });
    const subtotal = rows.reduce((sum, row) => sum + (row.priced === undefined ? 0 : row.priced.unitPrice * row.quantity), 0);
    body = (
      <>
        <ul className="dose-bag__lines">
          {rows.map((row) => (
            <li className="dose-bag__line" key={row.sku}>
              <p className="dose-bag__name">{row.name}</p>
              {row.priced === undefined ? (
                <p className="dose-bag__unavailable">{s.lineUnavailable}</p>
              ) : (
                <>
                  <p className="dose-bag__quantity">{fill(s.quantityOf, { quantity: row.quantity })}</p>
                  <div className="dose-bag__stepper">
                    <Button
                      variant="secondary"
                      aria-label={fill(s.decreaseQuantity, { name: row.name })}
                      disabled={row.quantity <= 1}
                      onClick={() => { client.updateLine(row.sku, row.quantity - 1); }}
                    >
                      <span aria-hidden="true">−</span>
                    </Button>
                    <Button
                      variant="secondary"
                      aria-label={fill(s.increaseQuantity, { name: row.name })}
                      disabled={row.quantity >= MAX_LINE_QUANTITY}
                      onClick={() => { client.updateLine(row.sku, row.quantity + 1); }}
                    >
                      <span aria-hidden="true">+</span>
                    </Button>
                  </div>
                  <p className="dose-bag__price">
                    <bdi>{formatEgp(row.priced.unitPrice * row.quantity, lang)}</bdi>
                  </p>
                </>
              )}
              <Button variant="quiet" aria-label={fill(s.removeLine, { name: row.name })} onClick={() => { client.removeLine(row.sku); }}>
                <span aria-hidden="true">×</span>
              </Button>
            </li>
          ))}
        </ul>
        <p className="dose-bag__subtotal">
          <span>{s.subtotal}</span>
          <bdi>{formatEgp(subtotal, lang)}</bdi>
        </p>
        <p className="dose-bag__note">{s.deliveryAtCheckout}</p>
        <LinkButton block href={checkoutHref} onClick={close}>
          {s.checkout}
        </LinkButton>
      </>
    );
  }

  return (
    <>
      <Button ref={button} variant="quiet" className="dose-bag__button" aria-haspopup="dialog" onClick={() => { setOpen(true); }}>
        {fill(s.bagButton, { count: units(lines) })}
      </Button>
      <Dialog open={open} onClose={close} title={s.bagTitle} closeLabel={s.closeBag} returnFocusTo={button}>
        {body}
      </Dialog>
    </>
  );
}
