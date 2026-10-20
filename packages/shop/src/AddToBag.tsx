import type { Lang, VariantView } from '@dose/contract';
import { formatEgp } from '@dose/contract/money';
import { Button } from '@dose/ui';
import { useState } from 'react';
import { fill, t, type Messages } from './i18n';
import { shopClientFor } from './shop-client';

export type AddToBagProps = {
  lang: Lang;
  direction: string;
  surface?: 'storefront' | 'studio';
  variants: VariantView[];
};

function variantLabel(s: Messages, variant: VariantView): string {
  const kind = { full: s.kindFull, sample: s.kindSample, tester: s.kindTester }[variant.kind];
  return `${kind}, ${fill(s.sizeMl, { ml: variant.sizeMl })}`;
}

/**
 * The price, a choice of size when there is more than one, and the button that puts the chosen
 * one in the bag. The first variant on sale is chosen to begin with.
 */
export function AddToBag({ lang, direction, surface = 'storefront', variants }: AddToBagProps) {
  const s = t(lang);
  const client = shopClientFor(surface, direction);
  const firstOnSale = variants.find((variant) => variant.available) ?? variants[0];
  const [sku, setSku] = useState(firstOnSale?.sku);
  const [announcement, setAnnouncement] = useState('');
  const chosen = variants.find((variant) => variant.sku === sku) ?? firstOnSale;
  if (chosen === undefined) return null;

  return (
    <div className="dose-add">
      <p className="dose-add__price">
        <bdi>{formatEgp(chosen.price, lang)}</bdi>
      </p>
      {variants.length > 1 ? (
        <fieldset className="dose-add__sizes">
          <legend>{s.sizeLabel}</legend>
          {variants.map((variant) => (
            <label className="dose-add__size" key={variant.sku}>
              <input
                type="radio"
                name="variant"
                value={variant.sku}
                checked={variant.sku === chosen.sku}
                disabled={!variant.available}
                onChange={() => {
                  setSku(variant.sku);
                  setAnnouncement('');
                }}
              />
              <span>{variantLabel(s, variant)}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <Button
        block
        disabled={!chosen.available}
        onClick={() => {
          client.addToBag(chosen.sku);
          setAnnouncement(s.addedToBag);
        }}
      >
        {chosen.available ? s.addToBag : s.soldOut}
      </Button>
      <p className="dose-add__status" role="status">
        {announcement}
      </p>
    </div>
  );
}
