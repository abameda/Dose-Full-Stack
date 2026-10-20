import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { Lang, ProductView } from '../packages/contract/src/index';
import { OWNER_HEADERS } from './support/env';
import { BLANC_SKU, LANGS, fillCheckout, hydrated, orderDetail, orderNumberFromUrl, seedBag, testCustomer, words } from './support/shop';

// Section G, criterion 1: a customer's cash-on-delivery order reaches the admin by itself, staff
// confirm it, and the timeline and the audit log say who did what. Signed in with the local dev
// header (`ENVIRONMENT:local`, see playwright.config.ts): as operations to work the queue, as the
// owner to read the audit log.

const OPERATIONS_HEADERS = { 'X-Dev-Staff-Email': 'operations@example.test' } as const;
const DELIVERY_FEE = 7_000; // decision 0002: EGP 70 for every governorate until M2

/** The customer's phone as the admin shows it: E.164, from a number typed as `010…`. */
const e164 = (typed: string) => `+20${typed.slice(1)}`;

/** Orders the way a customer does: the checkout page, field by field. Blanc, so Paradise stays for the other specs. */
async function orderOnStorefront(page: Page, lang: Lang): Promise<{ number: string; phone: string }> {
  const customer = testCustomer();
  await seedBag(page, [{ sku: BLANC_SKU, quantity: 1 }]);
  await page.goto(`/${lang}/checkout`);
  await hydrated(page);
  await fillCheckout(page, lang, customer);
  await page.getByRole('button', { name: words(lang).placeOrder }).click();
  await page.waitForURL(/\/orders\/D\d{5,}\/thanks$/);
  return { number: orderNumberFromUrl(page.url()), phone: e164(customer.phone) };
}

/** Orders straight through the API, for tests that are about the admin and not the storefront. */
async function orderThroughApi(request: APIRequestContext): Promise<{ number: string; phone: string }> {
  const product = await request.get('/api/products/blanc', { params: { lang: 'en' } });
  const blanc = (await product.json()) as ProductView;
  const price = blanc.variants[0]?.price ?? 0;
  const customer = testCustomer();
  const response = await request.post('/api/checkout', {
    data: {
      idempotencyKey: randomUUID(),
      lang: 'en',
      direction: 'd0-baseline',
      lines: [{ sku: BLANC_SKU, quantity: 1 }],
      quotedTotal: price + DELIVERY_FEE,
      customer: { name: customer.name, phone: customer.phone },
      address: { governorate: customer.governorate, area: customer.area, street: customer.street, building: customer.building },
    },
  });
  expect(response.status()).toBe(201);
  const result = (await response.json()) as { ok: true; orderNumber: string };
  return { number: result.orderNumber, phone: e164(customer.phone) };
}

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.passes.length).toBeGreaterThan(10);
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.map((n) => n.target.join(' ')) }));
}

/** Whether the page is wider than the screen, so that it would scroll sideways. */
async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

test.describe('from the storefront to the admin', () => {
  test.use({ extraHTTPHeaders: OPERATIONS_HEADERS });
  // These tests walk through several pages (WebKit on a busy machine is slow); the 5 s that
  // `expect` waits is for one thing to appear, the minute is for the walk.
  test.setTimeout(90_000);

  for (const lang of LANGS) {
    test(`an order placed in ${lang} appears on Today by itself, is confirmed on WhatsApp, and is in the timeline and the audit log`, async ({
      page,
      context,
      request,
    }) => {
      // Operations opens Today and leaves it alone.
      await page.goto('/admin');
      await expect(page.getByRole('heading', { name: 'Orders to confirm' })).toBeVisible();
      await expect(page.getByTestId('to-confirm-count')).toBeVisible();
      await page.evaluate(() => {
        (window as unknown as { __noReload: boolean }).__noReload = true;
      });
      const nav = page.getByRole('navigation', { name: 'Admin' });
      await expect(nav.getByRole('link', { name: 'Orders' })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Audit log' })).toHaveCount(0);

      // A customer, on another page, places an order.
      const shopper = await context.newPage();
      const { number, phone } = await orderOnStorefront(shopper, lang);
      await shopper.close();

      // Within 10 seconds it is on Today, without a reload.
      await page.bringToFront();
      const row = page.getByRole('link', { name: new RegExp(number) });
      await expect(row).toBeVisible({ timeout: 10_000 });
      expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);

      // Open it.
      await row.click();
      await page.waitForURL(`**/admin/orders/${number}`);
      await expect(page.getByRole('heading', { name: `Order ${number}` })).toBeVisible();
      await expect(page.getByTestId('order-state')).toHaveText('Pending');
      await expect(page.getByText(phone, { exact: true })).toBeVisible();
      const timeline = page.getByRole('list', { name: 'Timeline' }).getByRole('listitem');
      await expect(timeline).toHaveCount(1);
      await expect(timeline.first()).toContainText(`Placed by customer ${phone}`);

      // Confirm it: the method is required, and WhatsApp opens the chat with the message ready.
      await page.getByRole('button', { name: 'Confirm', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: `Confirm order ${number}` });
      const submit = dialog.getByRole('button', { name: 'Confirm order' });
      await expect(submit).toBeDisabled();
      const whatsapp = dialog.getByRole('link', { name: /WhatsApp/ });
      const href = new URL((await whatsapp.getAttribute('href')) ?? '');
      expect(href.origin + href.pathname).toBe(`https://wa.me/${phone.slice(1)}`);
      const text = href.searchParams.get('text') ?? '';
      expect(text).toContain(number);
      if (lang === 'ar') expect(text).toMatch(/\p{Script=Arabic}/u);
      else expect(text).not.toMatch(/\p{Script=Arabic}/u);
      await dialog.getByRole('radio', { name: 'WhatsApp' }).check();
      await expect(submit).toBeEnabled();
      await submit.click();

      // The order is confirmed, and the timeline says who confirmed it and how.
      await expect(dialog).toBeHidden();
      await expect(page.getByTestId('order-state')).toHaveText('Confirmed');
      await expect(timeline).toHaveCount(2);
      await expect(timeline.nth(0)).toContainText(`Placed by customer ${phone}`);
      await expect(timeline.nth(1)).toContainText('Confirmed by Local Operations · WhatsApp');
      await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
      expect((await orderDetail(request, number)).orderState).toBe('confirmed');

      // It has left Today.
      await page.getByRole('link', { name: 'Today' }).click();
      await expect(page.getByRole('heading', { name: 'Orders to confirm' })).toBeVisible();
      await expect(page.getByRole('link', { name: new RegExp(number) })).toHaveCount(0);

      // The owner's audit log shows the same two events, newest first.
      await context.setExtraHTTPHeaders(OWNER_HEADERS);
      await page.goto('/admin/audit');
      const table = page.getByRole('table', { name: 'Audit log' });
      await expect(table).toBeVisible();
      const rowsFor = table.getByRole('row').filter({ hasText: number });
      for (let pages = 0; pages < 40 && (await rowsFor.count()) < 2; pages++) {
        const older = page.getByRole('button', { name: 'Load older events' });
        if (!(await older.isVisible())) break;
        const before = await table.getByRole('row').count();
        await older.click();
        await expect.poll(() => table.getByRole('row').count()).toBeGreaterThan(before);
      }
      await expect(rowsFor).toHaveCount(2);
      await expect(rowsFor.nth(0)).toContainText('Order confirmed · WhatsApp');
      await expect(rowsFor.nth(0)).toContainText('Local Operations');
      await expect(rowsFor.nth(1)).toContainText('Order placed');
      await expect(rowsFor.nth(1)).toContainText(`Customer ${phone}`);
    });
  }

  test('the order list searches by phone and filters by state; cancel needs a reason and a note for Other', async ({ page, request }) => {
    const { number, phone } = await orderThroughApi(request);

    await page.goto('/admin/orders');
    await page.getByRole('searchbox', { name: 'Phone or order number' }).fill(phone.replace('+20', '0'));
    await page.getByRole('button', { name: 'Search' }).click();
    const table = page.getByRole('table', { name: 'Orders' });
    await expect(table.getByRole('row')).toHaveCount(2); // the header and the one order
    await expect(table.getByRole('link', { name: number })).toBeVisible();

    await page.getByLabel('State').selectOption('confirmed');
    await expect(page.getByText('No orders match.')).toBeVisible();
    await page.getByLabel('State').selectOption('pending');
    await table.getByRole('link', { name: number }).click();
    await page.waitForURL(`**/admin/orders/${number}`);

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Cancel order ${number}` });
    const submit = dialog.getByRole('button', { name: 'Cancel order' });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('Reason').selectOption('other');
    await submit.click();
    await expect(dialog.getByText('Add a note: it is required when the reason is Other.')).toBeVisible();
    await dialog.getByLabel('Note (required)').fill('Customer changed their mind on Instagram');
    await submit.click();

    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('order-state')).toHaveText('Cancelled');
    await expect(page.getByTestId('payment-state')).toHaveText('Voided');
    const entries = page.getByRole('list', { name: 'Timeline' }).getByRole('listitem');
    await expect(entries.nth(1)).toContainText('Cancelled by Local Operations · Other');
    await expect(entries.nth(1)).toContainText('Customer changed their mind on Instagram');
  });

  test('a confirm that lost the race says what the order is now', async ({ page, request }) => {
    const { number } = await orderThroughApi(request);
    await page.goto(`/admin/orders/${number}`);
    await expect(page.getByRole('heading', { name: `Order ${number}` })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: 'Phone call' }).check();

    // Someone else cancels it while this dialog is open.
    const version = (await orderDetail(request, number)).version;
    const other = await request.post(`/api/admin/orders/${number}/cancel`, {
      data: { expectedVersion: version, reason: 'duplicate' },
    });
    expect(other.status()).toBe(200);

    await dialog.getByRole('button', { name: 'Confirm order' }).click();
    await expect(page.getByRole('alert')).toHaveText('This order changed while you were looking at it: it is now cancelled.');
    await expect(page.getByTestId('order-state')).toHaveText('Cancelled');
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
  });

  test('operations is told the audit log is the owner’s', async ({ page }) => {
    await page.goto('/admin/audit');
    await expect(page.getByText('Only the owner can see the audit log.')).toBeVisible();
  });

  test('every admin page fits a 375 px phone and has no serious accessibility violation', async ({ page, request, context }) => {
    const { number } = await orderThroughApi(request);
    await page.setViewportSize({ width: 375, height: 812 });

    await page.goto('/admin');
    await expect(page.getByRole('link', { name: new RegExp(number) })).toBeVisible();
    expect(await scrollsSideways(page), 'Today').toBe(false);
    expect(await seriousViolations(page), 'Today').toEqual([]);

    await page.goto(`/admin/orders?q=${number}`);
    await expect(page.getByRole('table', { name: 'Orders' })).toBeVisible();
    expect(await scrollsSideways(page), 'Orders').toBe(false);
    expect(await seriousViolations(page), 'Orders').toEqual([]);

    await page.goto(`/admin/orders/${number}`);
    await expect(page.getByRole('heading', { name: `Order ${number}` })).toBeVisible();
    expect(await scrollsSideways(page), 'Order').toBe(false);
    expect(await seriousViolations(page), 'Order').toEqual([]);

    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await scrollsSideways(page), 'Confirm dialog').toBe(false);
    expect(await seriousViolations(page), 'Confirm dialog').toEqual([]);

    await context.setExtraHTTPHeaders(OWNER_HEADERS);
    await page.goto('/admin/audit');
    await expect(page.getByRole('table', { name: 'Audit log' })).toBeVisible();
    expect(await scrollsSideways(page), 'Audit').toBe(false);
    expect(await seriousViolations(page), 'Audit').toEqual([]);
  });
});

test.describe('the admin page is for staff only', () => {
  const PRIVATE = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' };

  test('without staff every admin page is a 401, private and not indexed', async ({ request }) => {
    for (const path of ['/admin', '/admin/', '/admin/orders', '/admin/orders/D10001', '/admin/audit', '/%61dmin/audit', '/Admin']) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(401);
      expect(response.headers()['cache-control'], path).toBe(PRIVATE['cache-control']);
      expect(response.headers()['x-robots-tag'], path).toBe(PRIVATE['x-robots-tag']);
      expect(await response.text(), path).not.toMatch(/<script|orders/i);
    }
  });

  test('with staff the page is served private and not indexed, deep links included', async ({ request }) => {
    for (const path of ['/admin', '/admin/orders', '/admin/orders/D10001', '/admin/audit']) {
      const response = await request.get(path, { headers: OPERATIONS_HEADERS });
      expect(response.status(), path).toBe(200);
      expect(response.headers()['cache-control'], path).toBe(PRIVATE['cache-control']);
      expect(response.headers()['x-robots-tag'], path).toBe(PRIVATE['x-robots-tag']);
      expect(await response.text(), path).toContain('<meta name="robots" content="noindex, nofollow"');
    }
  });

  test('a browser that is not signed in is shown the refusal, not the app', async ({ page }) => {
    const response = await page.goto('/admin');
    expect(response?.status()).toBe(401);
    await expect(page.getByRole('heading', { name: 'Orders to confirm' })).toHaveCount(0);
  });
});
