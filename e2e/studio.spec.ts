import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { formatEgp } from '../packages/contract/src/money';
import type { ProductView } from '../packages/contract/src/index';
import { fill } from '../packages/shop/src/i18n';
import { OWNER_HEADERS } from './support/env';
import { LANGS, hydrated, ordersFor, testCustomer, words } from './support/shop';

// The studio: Direction X1's product page, behind staff sign-in, from the same product the
// storefront shows, with checkout refused. Signed in with the local dev header (`ENVIRONMENT:local`,
// see playwright.config.ts) unless a test says otherwise.

const DELIVERY_FEE = 7_000; // decision 0002: EGP 70 for every governorate until M2

async function product(request: APIRequestContext, slug: string, lang: string): Promise<ProductView> {
  const response = await request.get(`/api/products/${slug}`, { params: { lang } });
  expect(response.status()).toBe(200);
  return (await response.json()) as ProductView;
}

/** The hero canvas, once it has hydrated and given itself an instance id. */
async function heroInstance(page: Page): Promise<string> {
  const canvas = page.locator('canvas.x1-hero__canvas');
  await expect(canvas).toHaveAttribute('data-instance', /^[0-9a-f]{16}$/);
  return (await canvas.getAttribute('data-instance')) ?? '';
}

test.describe('the studio, signed in as the owner', () => {
  test.use({ extraHTTPHeaders: OWNER_HEADERS });

  for (const lang of LANGS) {
    const s = words(lang);
    const bagButton = (count: number) => `button:has-text("${fill(s.bagButton, { count })}")`;

    test.describe(`in ${lang}`, () => {
      test('the storefront and the studio show the same product in different layouts', async ({ page, request }) => {
        const paradise = await product(request, 'paradise', lang);
        const price = formatEgp(paradise.variants[0]?.price ?? 0, lang);

        for (const [path, direction] of [
          [`/${lang}/products/paradise`, 'd0-baseline'],
          [`/studio/${lang}/products/paradise`, 'x1-studio'],
        ] as const) {
          await page.goto(path);
          await hydrated(page);
          await expect(page.locator('html')).toHaveAttribute('data-direction', direction);
          await expect(page.locator('html')).toHaveAttribute('lang', lang);
          await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(paradise.name);
          await expect(page.locator('bdi', { hasText: price }).first()).toBeVisible();
          await expect(page.getByText(paradise.labelCopy, { exact: true })).toBeVisible();
          await expect(page.getByText(paradise.story, { exact: true })).toBeVisible();
          // The same photo, whichever layout shows it.
          await expect(page.locator(`img[src="${paradise.images[0]?.src ?? ''}"]`)).toHaveCount(1);
        }

        // X1 replaced the whole page: its own header and hero, not Direction 0's.
        await expect(page.locator('.x1-bar')).toBeVisible();
        await expect(page.locator('canvas.x1-hero__canvas')).toHaveCount(1);
        await expect(page.locator('.site-header')).toHaveCount(0);
        await page.goto(`/${lang}/products/paradise`);
        await expect(page.locator('.site-header')).toBeVisible();
        await expect(page.locator('canvas')).toHaveCount(0);
        await expect(page.locator('.x1-bar')).toHaveCount(0);
      });

      test('the bag works in the studio but checkout is disabled, with no order request', async ({ page }) => {
        const checkoutPosts: string[] = [];
        page.on('request', (req) => {
          if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/checkout') checkoutPosts.push(req.url());
        });

        await page.goto(`/studio/${lang}/products/paradise`);
        await hydrated(page);
        await page.getByRole('button', { name: s.addToBag }).click();
        await expect(page.getByRole('status').filter({ hasText: s.addedToBag })).toBeVisible();
        await page.locator(bagButton(1)).click();

        const dialog = page.getByRole('dialog');
        await expect(dialog).toContainText(/Paradise|باراديس/);
        // In the studio the checkout control is a button, not a link to a checkout page.
        await expect(dialog.getByRole('link', { name: s.checkout })).toHaveCount(0);
        await dialog.getByRole('button', { name: s.checkout }).click();

        await expect(dialog.getByText(s.studioCheckoutDisabled)).toBeVisible();
        expect(page.url()).toContain(`/studio/${lang}/products/paradise`);
        expect(checkoutPosts).toEqual([]);
      });

      test('moving from Paradise to Blanc keeps the same hero canvas and the bag count', async ({ page }) => {
        await page.goto(`/studio/${lang}/products/paradise`);
        await hydrated(page);
        const instance = await heroInstance(page);
        await expect(page.locator('canvas.x1-hero__canvas')).toHaveAttribute('data-motion', 'running');

        await page.getByRole('button', { name: s.addToBag }).click();
        await expect(page.locator(bagButton(1))).toBeVisible();

        // Client-side navigation: this marker dies with a full page load.
        await page.evaluate(() => {
          (window as unknown as { __spa: boolean }).__spa = true;
        });
        await page.locator(`.x1-nav a[href="/studio/${lang}/products/blanc"]`).click();
        await page.waitForURL(`**/studio/${lang}/products/blanc`);
        await hydrated(page);

        expect(await page.evaluate(() => (window as unknown as { __spa?: boolean }).__spa)).toBe(true);
        expect(await heroInstance(page)).toBe(instance);
        await expect(page.locator('canvas.x1-hero__canvas')).toHaveCount(1);
        await expect(page.locator('canvas.x1-hero__canvas')).toHaveAttribute('data-motion', 'running');
        await expect(page.locator(bagButton(1))).toBeVisible();
        await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(/Paradise|باراديس/);

        // And back again.
        await page.locator(`.x1-nav a[href="/studio/${lang}/products/paradise"]`).click();
        await page.waitForURL(`**/studio/${lang}/products/paradise`);
        expect(await heroInstance(page)).toBe(instance);
      });
    });
  }

  test('the hero draws one still frame under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/studio/en/products/paradise');
    await hydrated(page);
    await heroInstance(page);
    await expect(page.locator('canvas.x1-hero__canvas')).toHaveAttribute('data-motion', 'still');
  });

  test('the hero pauses while the tab is hidden and resumes when it is shown', async ({ page }) => {
    await page.goto('/studio/en/products/paradise');
    await hydrated(page);
    const canvas = page.locator('canvas.x1-hero__canvas');
    await heroInstance(page);
    await expect(canvas).toHaveAttribute('data-motion', 'running');

    const setHidden = (hidden: boolean) =>
      page.evaluate((value) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);
    await setHidden(true);
    await expect(canvas).toHaveAttribute('data-motion', 'paused');
    await setHidden(false);
    await expect(canvas).toHaveAttribute('data-motion', 'running');
  });

  test('every studio response is private and not indexed, an unknown page included', async ({ request }) => {
    for (const [path, status] of [
      ['/studio/en/products/paradise', 200],
      ['/studio/ar/products/paradise', 200],
      ['/studio/en/products/no-such-perfume', 404],
      ['/studio/fr/products/paradise', 404],
      ['/studio', 404],
    ] as const) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(status);
      expect(response.headers()['cache-control'], path).toBe('private, no-store');
      expect(response.headers()['x-robots-tag'], path).toBe('noindex, nofollow');
    }
    // Defence in depth: the page also asks to be left out.
    const html = await (await request.get('/studio/en/products/paradise')).text();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"');
  });

  test('a checkout sent from a studio page is refused with 403 and places nothing', async ({ request, baseURL }) => {
    const paradise = await product(request, 'paradise', 'en');
    const sku = paradise.variants[0]?.sku ?? '';
    const customer = testCustomer();
    const response = await request.post('/api/checkout', {
      headers: { Referer: `${baseURL ?? ''}/studio/en/products/paradise` },
      data: {
        idempotencyKey: randomUUID(),
        lang: 'en',
        direction: 'x1-studio',
        lines: [{ sku, quantity: 1 }],
        quotedTotal: (paradise.variants[0]?.price ?? 0) + DELIVERY_FEE,
        customer: { name: customer.name, phone: customer.phone },
        address: {
          governorate: customer.governorate,
          area: customer.area,
          street: customer.street,
          building: customer.building,
        },
      },
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ ok: false, code: 'checkout_disabled' });
    expect(await ordersFor(request, customer.phone)).toEqual([]);
  });
});

test.describe('the studio, not signed in', () => {
  const PRIVATE = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' };

  test('without the dev header the studio is a 401, private and not indexed', async ({ request }) => {
    for (const path of ['/studio/en/products/paradise', '/studio/ar/products/blanc', '/studio/en/products/no-such-perfume', '/studio']) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(401);
      expect(response.headers()['cache-control'], path).toBe(PRIVATE['cache-control']);
      expect(response.headers()['x-robots-tag'], path).toBe(PRIVATE['x-robots-tag']);
      expect(await response.text(), path).not.toMatch(/paradise|blanc/i);
    }
  });

  test('an encoded or oddly written studio path is refused the same way', async ({ request }) => {
    for (const path of [
      '/%73tudio/en/products/paradise',
      '/%53tudio/en/products/paradise',
      '/%2573tudio/en/products/paradise',
      '/studio%2Fen/products/paradise',
      '/./studio/en/products/paradise',
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(401);
      expect(response.headers()['cache-control'], path).toBe(PRIVATE['cache-control']);
      expect(response.headers()['x-robots-tag'], path).toBe(PRIVATE['x-robots-tag']);
      expect(await response.text(), path).not.toMatch(/paradise|blanc/i);
    }
  });

  test('a browser is shown the refusal, not the page', async ({ page }) => {
    const response = await page.goto('/studio/en/products/paradise');
    expect(response?.status()).toBe(401);
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('a stranger and a made-up Access token are refused', async ({ request }) => {
    for (const headers of [
      { 'X-Dev-Staff-Email': 'nobody@example.test' },
      { 'Cf-Access-Jwt-Assertion': 'not.a.token' },
      { 'X-Dev-Staff-Email': '' },
    ]) {
      const response = await request.get('/studio/en/products/paradise', { headers });
      expect(response.status(), JSON.stringify(headers)).toBe(401);
    }
  });

  test('the storefront is public and robots.txt keeps crawlers out of the studio and the admin', async ({ request }) => {
    expect((await request.get('/en/products/paradise')).status()).toBe(200);
    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    const lines = (await robots.text()).split(/\r?\n/);
    expect(lines).toContain('Disallow: /studio/');
    expect(lines).toContain('Disallow: /admin/');
  });
});
