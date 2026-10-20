import { expect, test } from '@playwright/test';

// The web app shell, served by `wrangler dev` from the built Worker against the seeded local
// Postgres (see playwright.config.ts): languages, the API mount, the media route and the cron.

type ProductSummary = { slug: string; name: string; images: { src: string }[] };

test.describe('the root redirects by language', () => {
  for (const [acceptLanguage, target] of [
    ['ar-EG', '/ar'],
    ['ar-EG,ar;q=0.9,en;q=0.8', '/ar'],
    ['en-US', '/en'],
    ['fr-FR,en;q=0.5,ar;q=0.4', '/en'],
  ] as const) {
    test(`Accept-Language: ${acceptLanguage} goes to ${target}`, async ({ request }) => {
      const response = await request.get('/', { headers: { 'Accept-Language': acceptLanguage }, maxRedirects: 0 });
      expect(response.status()).toBe(302);
      expect(new URL(response.headers()['location'] ?? '', 'http://x').pathname).toBe(target);
      expect(response.headers()['vary']?.toLowerCase()).toContain('accept-language');
    });
  }
});

test('/ar is Arabic and right-to-left', async ({ page }) => {
  await page.goto('/ar');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});

test('/en is English and left-to-right', async ({ page }) => {
  await page.goto('/en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('an unknown language is not found', async ({ request }) => {
  const response = await request.get('/fr');
  expect(response.status()).toBe(404);
});

test('the API answers through the Worker from the seeded database (B10)', async ({ request }) => {
  const response = await request.get('/api/products?lang=ar');
  expect(response.status()).toBe(200);
  const products = (await response.json()) as ProductSummary[];
  expect(products.map((p) => p.slug).sort()).toEqual(['blanc', 'paradise']);
  for (const product of products) expect(product.images.length).toBeGreaterThan(0);
});

test('a seeded image is served from R2 as an immutable image', async ({ request }) => {
  const products = (await (await request.get('/api/products?lang=en')).json()) as ProductSummary[];
  const src = products[0]?.images[0]?.src;
  expect(src).toMatch(/^\/media\/products\/[a-z0-9-]+\/[0-9a-f]{64}\.jpg$/);

  const response = await request.get(src ?? '');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^image\//);
  expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  expect((await response.body()).length).toBeGreaterThan(0);
});

test('an unknown media key is not found', async ({ request }) => {
  const response = await request.get('/media/products/paradise/0000.jpg');
  expect(response.status()).toBe(404);
});

test('the cron handler runs', async ({ request }) => {
  // `wrangler dev --test-scheduled` exposes the Worker's scheduled handler on this path.
  const response = await request.get('/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*');
  expect(response.status()).toBe(200);
});
