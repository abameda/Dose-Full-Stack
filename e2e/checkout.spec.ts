import { expect, test } from '@playwright/test';
import { formatEgp } from '../packages/contract/src/money';
import { fill } from '../packages/shop/src/i18n';
import { setVariantPrice, variantPrice } from './support/db';
import {
  LANGS,
  PARADISE_SKU,
  fillCheckout,
  hydrated,
  orderDetail,
  orderNumberFromUrl,
  ordersFor,
  seedBag,
  testCustomer,
  words,
} from './support/shop';

// The storefront end to end: a customer finds a perfume, fills the bag, and orders it with cash
// on delivery, in both languages, on both phone projects (playwright.config.ts).

const DELIVERY_FEE = 7_000; // decision 0002: EGP 70 for every governorate until M2

for (const lang of LANGS) {
  const s = words(lang);
  const bagButton = (count: number) => `button:has-text("${fill(s.bagButton, { count })}")`;

  test.describe(`checkout in ${lang}`, () => {
    test('home to product, bag across pages, checkout, thanks, pending in the admin', async ({ page, request }) => {
      const customer = testCustomer();

      await page.goto(`/${lang}`);
      await hydrated(page);
      await page.locator(`a[href="/${lang}/products/paradise"]`).first().click();
      await page.waitForURL(`**/${lang}/products/paradise`);
      await hydrated(page);

      // Everything from here on is client-side navigation: this marker dies with a full page load.
      await page.evaluate(() => {
        (window as unknown as { __spa: boolean }).__spa = true;
      });

      await page.getByRole('button', { name: s.addToBag }).click();
      await expect(page.getByRole('status')).toContainText(s.addedToBag);
      const openBag = page.locator(bagButton(1));
      await expect(openBag).toBeVisible();

      await openBag.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(/Paradise|باراديس/);
      await expect(dialog.getByText(fill(s.quantityOf, { quantity: 1 }))).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      // To Blanc by way of the home page: the bag island persists, so the count survives.
      await page.getByRole('link', { name: s.homeLink }).click();
      await page.waitForURL(`**/${lang}`);
      await hydrated(page);
      await page.locator(`a[href="/${lang}/products/blanc"]`).first().click();
      await page.waitForURL(`**/${lang}/products/blanc`);
      await hydrated(page);
      await expect(page.locator(bagButton(1))).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { __spa?: boolean }).__spa)).toBe(true);

      await page.locator(bagButton(1)).click();
      await page.getByRole('dialog').getByRole('link', { name: s.checkout }).click();
      await page.waitForURL(`**/${lang}/checkout`);
      await hydrated(page);

      await expect(page.getByLabel(s.fieldName)).toBeVisible();
      await expect(page.getByText(s.codNote)).toBeVisible();
      // 1,500 + 70 delivery, with Western digits in both languages.
      await expect(page.locator('bdi', { hasText: formatEgp(150_000 + DELIVERY_FEE, lang) })).toBeVisible();

      await fillCheckout(page, lang, customer);
      await page.getByRole('button', { name: s.placeOrder }).click();

      await page.waitForURL(/\/orders\/D\d{5,}\/thanks$/);
      const number = orderNumberFromUrl(page.url());
      await expect(page.getByRole('heading', { level: 1 })).toContainText(s.thanksHeading);
      await expect(page.getByText(number, { exact: true })).toBeVisible();

      const orders = await ordersFor(request, customer.phone);
      expect(orders.map((o) => o.number)).toEqual([number]);
      const detail = await orderDetail(request, number);
      expect(detail.orderState).toBe('pending');
      expect(detail.lang).toBe(lang);
      expect(detail.direction).toBe('d0-baseline');
      expect(detail.total).toBe(150_000 + DELIVERY_FEE);
      expect(detail.lines.map((l) => l.sku)).toEqual([PARADISE_SKU]);

      // The bag was cleared by the order.
      await page.goto(`/${lang}`);
      await hydrated(page);
      await expect(page.locator(bagButton(0))).toBeVisible();
    });

    test('double tap places one order', async ({ page, request }) => {
      const customer = testCustomer();
      await seedBag(page, [{ sku: PARADISE_SKU, quantity: 1 }]);
      await page.goto(`/${lang}/checkout`);
      await hydrated(page);
      await fillCheckout(page, lang, customer);

      // Two taps in the same instant, faster than the page can redraw.
      const placeOrder = page.getByRole('button', { name: s.placeOrder });
      await expect(placeOrder).toBeEnabled();
      await placeOrder.evaluate((button) => {
        (button as HTMLButtonElement).click();
        (button as HTMLButtonElement).click();
      });

      await page.waitForURL(/\/orders\/D\d{5,}\/thanks$/);
      const orders = await ordersFor(request, customer.phone);
      expect(orders).toHaveLength(1);
      expect(orders[0]?.number).toBe(orderNumberFromUrl(page.url()));
    });

    test('a quantity changed in the bag prices the checkout again', async ({ page }) => {
      await seedBag(page, [{ sku: PARADISE_SKU, quantity: 1 }]);
      await page.goto(`/${lang}/checkout`);
      await hydrated(page);
      await expect(page.locator('bdi', { hasText: formatEgp(150_000 + DELIVERY_FEE, lang) })).toBeVisible();

      await page.locator(bagButton(1)).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: fill(s.increaseQuantity, { name: '' }).trim() }).click();
      await expect(dialog.getByText(fill(s.quantityOf, { quantity: 2 }))).toBeVisible();
      await page.keyboard.press('Escape');

      await expect(page.locator('bdi', { hasText: formatEgp(2 * 150_000 + DELIVERY_FEE, lang) })).toBeVisible();
    });

    test('a line that ran out is marked and can be removed', async ({ page }) => {
      // The API answers as it does when the last unit goes between pricing and ordering.
      await page.route('**/api/checkout', (route) =>
        route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, code: 'out_of_stock', skus: [PARADISE_SKU] }),
        }),
      );
      await seedBag(page, [{ sku: PARADISE_SKU, quantity: 1 }]);
      await page.goto(`/${lang}/checkout`);
      await hydrated(page);
      await fillCheckout(page, lang, testCustomer());
      await page.getByRole('button', { name: s.placeOrder }).click();

      await expect(page.getByRole('alert')).toContainText(s.outOfStockBanner);
      await expect(page.getByText(s.outOfStockLine)).toBeVisible();
      await expect(page.getByRole('button', { name: s.placeOrder })).toBeDisabled();

      await page.getByRole('button', { name: /Paradise|باراديس/ }).click();
      await expect(page.getByText(s.checkoutEmpty)).toBeVisible();
    });
  });
}

// Changes a live price, so it runs alone (see the @serial projects in playwright.config.ts).
test.describe('a stale bag @serial', () => {
  test.describe.configure({ mode: 'serial' });

  for (const lang of LANGS) {
    const s = words(lang);

    test(`stale bag shows the new total (${lang})`, async ({ page, request }) => {
      const customer = testCustomer();
      const original = await variantPrice(PARADISE_SKU);
      const raised = original + 10_000;
      try {
        await seedBag(page, [{ sku: PARADISE_SKU, quantity: 1 }]);
        await page.goto(`/${lang}/checkout`);
        await hydrated(page);
        await expect(page.locator('bdi', { hasText: formatEgp(original + DELIVERY_FEE, lang) })).toBeVisible();

        // Choosing a governorate prices the bag again; let that finish, so the form is showing
        // the price as it is now.
        const repriced = page.waitForResponse((r) => r.url().endsWith('/api/bag/quote'));
        await fillCheckout(page, lang, customer);
        await repriced;
        await expect(page.locator('bdi', { hasText: formatEgp(original + DELIVERY_FEE, lang) }).first()).toBeVisible();

        // The owner raises the price while the customer is still looking at the old total.
        await setVariantPrice(PARADISE_SKU, raised);
        await page.getByRole('button', { name: s.placeOrder }).click();

        await expect(page.getByRole('button', { name: s.confirmNewTotal })).toBeVisible();
        await expect(page.locator('bdi', { hasText: formatEgp(raised + DELIVERY_FEE, lang) }).first()).toBeVisible();
        expect(await ordersFor(request, customer.phone)).toEqual([]);

        await page.getByRole('button', { name: s.confirmNewTotal }).click();
        await page.waitForURL(/\/orders\/D\d{5,}\/thanks$/);
        const orders = await ordersFor(request, customer.phone);
        expect(orders).toHaveLength(1);
        expect(orders[0]?.total).toBe(raised + DELIVERY_FEE);
      } finally {
        await setVariantPrice(PARADISE_SKU, original);
      }
    });
  }
});
