import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { LANGS, PARADISE_SKU, hydrated, seedBag, words } from './support/shop';

// Automated accessibility checks (axe) on the four customer pages in both languages, plus the
// bag dialog's keyboard behaviour. Task 14 runs the same checks in CI.

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  // Guards the guard: an axe run that checked nothing would pass every page.
  expect(results.passes.length).toBeGreaterThan(10);
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.map((n) => n.target.join(' ')) }));
}

for (const lang of LANGS) {
  const s = words(lang);

  test.describe(`accessibility in ${lang}`, () => {
    test('home has no serious or critical violations', async ({ page }) => {
      await page.goto(`/${lang}`);
      await hydrated(page);
      expect(await seriousViolations(page)).toEqual([]);
    });

    test('product has no serious or critical violations', async ({ page }) => {
      await page.goto(`/${lang}/products/paradise`);
      await hydrated(page);
      expect(await seriousViolations(page)).toEqual([]);
    });

    test('checkout has no serious or critical violations', async ({ page }) => {
      await seedBag(page, [{ sku: PARADISE_SKU, quantity: 1 }]);
      await page.goto(`/${lang}/checkout`);
      await hydrated(page);
      await expect(page.getByRole('button', { name: s.placeOrder })).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
    });

    test('checkout with errors shown has no serious or critical violations', async ({ page }) => {
      await seedBag(page, [{ sku: PARADISE_SKU, quantity: 1 }]);
      await page.goto(`/${lang}/checkout`);
      await hydrated(page);
      await page.getByRole('button', { name: s.placeOrder }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
    });

    test('thanks has no serious or critical violations', async ({ page }) => {
      await page.goto(`/${lang}/orders/D10001/thanks`);
      await hydrated(page);
      expect(await seriousViolations(page)).toEqual([]);
    });

    test('the bag dialog traps focus, closes on Escape and returns focus to the bag button', async ({ page }) => {
      await seedBag(page, [{ sku: PARADISE_SKU, quantity: 1 }]);
      await page.goto(`/${lang}`);
      await hydrated(page);

      const bagButton = page.getByRole('button', { name: /\(1\)/ });
      await bagButton.focus();
      await bagButton.press('Enter');

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('aria-modal', 'true');
      await expect(dialog.getByRole('link', { name: s.checkout })).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);

      // Tab and Shift+Tab many times: focus never leaves the dialog.
      const insideDialog = () => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);
      expect(await insideDialog()).toBe(true);
      for (let i = 0; i < 12; i += 1) {
        await page.keyboard.press('Tab');
        expect(await insideDialog()).toBe(true);
      }
      for (let i = 0; i < 12; i += 1) {
        await page.keyboard.press('Shift+Tab');
        expect(await insideDialog()).toBe(true);
      }

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(bagButton).toBeFocused();
    });
  });
}
