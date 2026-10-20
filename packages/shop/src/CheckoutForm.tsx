import type { BagView, CheckoutResult, Lang } from '@dose/contract';
import { formatEgp } from '@dose/contract/money';
import { Button, Field, LinkButton } from '@dose/ui';
import { useEffect, useRef, useState, type ChangeEvent, type SyntheticEvent } from 'react';
import { fill, t } from './i18n';
import { ShopApiError, shopClientFor } from './shop-client';
import { skuKey, useBag } from './use-bag';

export type GovernorateOption = { code: string; name: string };

export type CheckoutFormProps = {
  lang: Lang;
  /** The design direction that renders the page (stored on the order). */
  direction: string;
  surface?: 'storefront' | 'studio';
  /** The 27 governorates, named in the page's language. */
  governorates: GovernorateOption[];
};

type Values = {
  name: string;
  phone: string;
  governorate: string;
  area: string;
  street: string;
  building: string;
  landmark: string;
};
type FieldName = keyof Values;
type Errors = Partial<Record<FieldName, string>>;

const EMPTY: Values = { name: '', phone: '', governorate: '', area: '', street: '', building: '', landmark: '' };
const REQUIRED: readonly FieldName[] = ['name', 'phone', 'governorate', 'area', 'street', 'building'];

/** The API's body paths for the fields of this form. */
const FIELD_OF_PATH: Readonly<Record<string, FieldName>> = {
  'customer.name': 'name',
  'customer.phone': 'phone',
  'address.governorate': 'governorate',
  'address.area': 'area',
  'address.street': 'street',
  'address.building': 'building',
  'address.landmark': 'landmark',
};

type Quote = { status: 'loading' } | { status: 'error' } | { status: 'ready'; view: BagView };
type Notice = { kind: 'fields' | 'price' | 'stock' | 'failure'; text: string };

/** Keeps a price in one piece inside a sentence of the other direction (first-strong isolate, pop). */
function isolated(text: string): string {
  return `⁨${text}⁩`;
}

/**
 * A fresh idempotency key. `crypto.randomUUID` exists only on secure pages (HTTPS or localhost),
 * and a shop opened on a plain-HTTP address (a phone testing a LAN build) must still order.
 */
function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The checkout: customer, address and a plain note that payment is cash on delivery, beside the
 * bag priced by the API. The order is placed with an idempotency key made when the form mounts
 * and kept until it succeeds, so a double tap, a retry after a dropped connection, or a second
 * tab of the same form can place only one order. If prices moved, the new total is shown and
 * the button asks for confirmation; if stock ran short, the short lines are marked and can be
 * removed. On success the bag is cleared and the customer goes to the thanks page.
 */
export function CheckoutForm({ lang, direction, surface = 'storefront', governorates }: CheckoutFormProps) {
  const s = t(lang);
  const client = shopClientFor(surface, direction);
  const { lines, ready } = useBag(client);
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [quote, setQuote] = useState<Quote>({ status: 'loading' });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [shortSkus, setShortSkus] = useState<readonly string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [idempotencyKey] = useState(newIdempotencyKey);
  const form = useRef<HTMLFormElement>(null);
  const submittingNow = useRef(false);
  const focusFirstError = useRef(false);
  const key = skuKey(lines);

  // Price the bag when the form opens, and again when the items or the governorate change.
  useEffect(() => {
    if (!ready || key === '' || placed) return undefined;
    let current = true;
    setQuote((before) => (before.status === 'ready' ? before : { status: 'loading' }));
    client
      .quote(lang, values.governorate === '' ? undefined : values.governorate)
      .then((view) => {
        if (current) setQuote({ status: 'ready', view });
      })
      .catch(() => {
        if (current) setQuote({ status: 'error' });
      });
    return () => {
      current = false;
    };
  }, [ready, key, lang, client, values.governorate, attempt, placed]);

  // After a refused submit, move to the first field that is marked.
  useEffect(() => {
    if (!focusFirstError.current) return;
    focusFirstError.current = false;
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  const change = (field: FieldName) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = event.target.value;
    setValues((before) => ({ ...before, [field]: value }));
    if (errors[field] === undefined) return;
    const rest = Object.fromEntries(Object.entries(errors).filter(([name]) => name !== field)) as Errors;
    setErrors(rest);
    if (Object.keys(rest).length === 0) setNotice((before) => (before?.kind === 'fields' ? null : before));
  };

  const markErrors = (found: Errors) => {
    focusFirstError.current = true;
    setErrors(found);
    setNotice({ kind: 'fields', text: s.errorSummary });
  };

  const messageFor = (field: FieldName, value: string): string => {
    if (field === 'phone') return s.errorPhone;
    if (field === 'governorate') return value.trim() === '' ? s.errorChooseGovernorate : s.errorGovernorateUnavailable;
    return value.trim() === '' ? s.errorRequired : s.errorInvalidField;
  };

  const onRefused = (result: Exclude<CheckoutResult, { ok: true }>) => {
    switch (result.code) {
      case 'price_changed':
        setQuote({ status: 'ready', view: result.quote });
        setNeedsConfirmation(true);
        setNotice({ kind: 'price', text: fill(s.priceChanged, { total: isolated(formatEgp(result.quote.total, lang)) }) });
        return;
      case 'out_of_stock':
        setShortSkus(result.skus);
        setNotice({ kind: 'stock', text: s.outOfStockBanner });
        return;
      case 'invalid': {
        const found: Errors = {};
        for (const path of result.fields) {
          const field = FIELD_OF_PATH[path];
          if (field !== undefined) found[field] = messageFor(field, values[field]);
        }
        // A path that is not a field of this form (the bag, the quoted total) is not the customer's to fix.
        if (Object.keys(found).length === 0) setNotice({ kind: 'failure', text: s.errorUnexpected });
        else markErrors(found);
        return;
      }
      case 'checkout_disabled':
        setNotice({ kind: 'failure', text: s.checkoutDisabled });
    }
  };

  const onSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingNow.current || placed || quote.status !== 'ready') return;

    const missing: Errors = {};
    for (const field of REQUIRED) {
      if (values[field].trim() === '') missing[field] = messageFor(field, values[field]);
    }
    if (Object.keys(missing).length > 0) {
      markErrors(missing);
      return;
    }

    // A ref, not state: the second tap of a double tap lands before React redraws the button.
    submittingNow.current = true;
    setSubmitting(true);
    setNotice(null);
    setNeedsConfirmation(false);
    try {
      const landmark = values.landmark.trim();
      const result = await client.checkout({
        idempotencyKey,
        lang,
        quotedTotal: quote.view.total,
        customer: { name: values.name.trim(), phone: values.phone },
        address: {
          governorate: values.governorate,
          area: values.area.trim(),
          street: values.street.trim(),
          building: values.building.trim(),
          ...(landmark === '' ? {} : { landmark }),
        },
      });
      if (result.ok) {
        // Stay "placing" until the next page loads: the empty bag must not flash an empty form.
        setPlaced(true);
        client.clearBag();
        window.location.assign(`/${lang}/orders/${result.orderNumber}/thanks`);
        return;
      }
      onRefused(result);
    } catch (error) {
      setNotice({ kind: 'failure', text: error instanceof ShopApiError ? s.errorUnexpected : s.errorNetwork });
    }
    submittingNow.current = false;
    setSubmitting(false);
  };

  const removeShortLine = (sku: string) => {
    client.removeLine(sku);
    setShortSkus((before) => before.filter((other) => other !== sku));
    setNotice((before) => (before?.kind === 'stock' ? null : before));
  };

  if (ready && lines.length === 0 && !placed) {
    return (
      <div className="dose-checkout__empty">
        <p>{s.checkoutEmpty}</p>
        <LinkButton href={`/${lang}`}>{s.continueShopping}</LinkButton>
      </div>
    );
  }

  const view = quote.status === 'ready' ? quote.view : null;
  const blocked = shortSkus.some((sku) => lines.some((line) => line.sku === sku));
  const buttonLabel = submitting || placed ? s.placingOrder : needsConfirmation ? s.confirmNewTotal : s.placeOrder;

  return (
    <form ref={form} className="dose-checkout" onSubmit={(event) => void onSubmit(event)} noValidate>
      <div className="dose-checkout__fields">
        <fieldset className="dose-checkout__group">
          <legend>{s.contactHeading}</legend>
          <Field label={s.fieldName} error={errors.name}>
            {(control) => (
              <input {...control} name="name" type="text" autoComplete="name" maxLength={100} aria-required="true" value={values.name} onChange={change('name')} />
            )}
          </Field>
          <Field label={s.fieldPhone} hint={s.hintPhone} error={errors.phone}>
            {(control) => (
              <input
                {...control}
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                dir="ltr"
                maxLength={40}
                aria-required="true"
                value={values.phone}
                onChange={change('phone')}
              />
            )}
          </Field>
        </fieldset>

        <fieldset className="dose-checkout__group">
          <legend>{s.addressHeading}</legend>
          <Field label={s.fieldGovernorate} error={errors.governorate}>
            {(control) => (
              <select {...control} name="governorate" autoComplete="address-level1" aria-required="true" value={values.governorate} onChange={change('governorate')}>
                <option value="">{s.chooseGovernorate}</option>
                {governorates.map((governorate) => (
                  <option key={governorate.code} value={governorate.code}>
                    {governorate.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={s.fieldArea} error={errors.area}>
            {(control) => (
              <input {...control} name="area" type="text" autoComplete="address-level2" maxLength={200} aria-required="true" value={values.area} onChange={change('area')} />
            )}
          </Field>
          <Field label={s.fieldStreet} error={errors.street}>
            {(control) => (
              <input {...control} name="street" type="text" autoComplete="address-line1" maxLength={200} aria-required="true" value={values.street} onChange={change('street')} />
            )}
          </Field>
          <Field label={s.fieldBuilding} error={errors.building}>
            {(control) => (
              <input {...control} name="building" type="text" autoComplete="address-line2" maxLength={200} aria-required="true" value={values.building} onChange={change('building')} />
            )}
          </Field>
          <Field label={s.fieldLandmark} hint={s.hintLandmark} error={errors.landmark}>
            {(control) => <input {...control} name="landmark" type="text" maxLength={200} value={values.landmark} onChange={change('landmark')} />}
          </Field>
        </fieldset>

        <section className="dose-checkout__cod" aria-labelledby="dose-cod-heading">
          <h2 id="dose-cod-heading">{s.codHeading}</h2>
          <p>{s.codNote}</p>
        </section>
      </div>

      <section className="dose-checkout__summary" aria-labelledby="dose-summary-heading">
        <h2 id="dose-summary-heading">{s.summaryHeading}</h2>
        {quote.status === 'error' ? (
          <>
            <p role="alert">{s.errorNetwork}</p>
            <Button variant="secondary" onClick={() => { setAttempt((n) => n + 1); }}>
              {s.retry}
            </Button>
          </>
        ) : view === null ? (
          <p role="status">{s.checkoutLoading}</p>
        ) : (
          <>
            <ul className="dose-summary__lines">
              {view.lines.map((line) => {
                const short = shortSkus.includes(line.sku);
                return (
                  <li className={short ? 'dose-summary__line dose-summary__line--short' : 'dose-summary__line'} key={line.sku}>
                    <span className="dose-summary__name">
                      {line.name} <span className="dose-summary__qty">× {line.quantity}</span>
                    </span>
                    <bdi>{formatEgp(line.lineTotal, lang)}</bdi>
                    {short ? (
                      <span className="dose-summary__short">
                        <span>{s.outOfStockLine}</span>
                        <Button variant="secondary" onClick={() => { removeShortLine(line.sku); }}>
                          {fill(s.removeLine, { name: line.name })}
                        </Button>
                      </span>
                    ) : null}
                  </li>
                );
              })}
              {view.unavailable.map((sku) => (
                <li className="dose-summary__line dose-summary__line--short" key={sku}>
                  <span className="dose-summary__name">{sku}</span>
                  <span className="dose-summary__short">
                    <span>{s.lineUnavailable}</span>
                    <Button variant="secondary" onClick={() => { removeShortLine(sku); }}>
                      {fill(s.removeLine, { name: sku })}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
            <dl className="dose-summary__totals">
              <div>
                <dt>{s.subtotal}</dt>
                <dd>
                  <bdi>{formatEgp(view.subtotal, lang)}</bdi>
                </dd>
              </div>
              <div>
                <dt>{s.deliveryFee}</dt>
                <dd>
                  <bdi>{formatEgp(view.deliveryFee, lang)}</bdi>
                </dd>
              </div>
              <div className="dose-summary__total">
                <dt>{s.total}</dt>
                <dd>
                  <bdi>{formatEgp(view.total, lang)}</bdi>
                </dd>
              </div>
            </dl>
          </>
        )}

        {notice === null ? null : (
          <p className={`dose-checkout__notice dose-checkout__notice--${notice.kind}`} role="alert">
            {notice.text}
          </p>
        )}

        <Button type="submit" block disabled={view === null || submitting || placed || blocked}>
          {buttonLabel}
        </Button>
      </section>
    </form>
  );
}
