import { expect, test } from '@playwright/test';
import {
  LANGS,
  PARADISE_SKU,
  fillCheckout,
  hydrated,
  orderNumberFromUrl,
  ordersFor,
  seedBag,
  testCustomer,
  words,
} from './support/shop';

// What the checkout form accepts and refuses, and how a refusal is announced. The phone rules
// are the server's (one definition, `normalisePhone`); the form shows its answer in the page's
// language.

for (const lang of LANGS) {
  const s = words(lang);

  test.describe(`checkout validation in ${lang}`, () => {
    test.beforeEach(async ({ page }) => {
      await seedBag(page, [{ sku: PARADISE_SKU, quantity: 1 }]);
      await page.goto(`/${lang}/checkout`);
      await hydrated(page);
    });

    test('Arabic-Indic digits are accepted as a phone number', async ({ page, request }) => {
      const customer = testCustomer({ phone: '٠١٠١٢٣٤٥٦٧٨' });
      await fillCheckout(page, lang, customer);
      await page.getByRole('button', { name: s.placeOrder }).click();

      await page.waitForURL(/\/orders\/D\d{5,}\/thanks$/);
      const orders = await ordersFor(request, '01012345678');
      expect(orders.map((o) => o.number)).toContain(orderNumberFromUrl(page.url()));
      expect(orders[0]?.customerPhone).toBe('+201012345678');
    });

    test('a landline number shows the phone error in the page language', async ({ page, request }) => {
      const customer = testCustomer({ phone: '0223456789' });
      await fillCheckout(page, lang, customer);
      await page.getByRole('button', { name: s.placeOrder }).click();

      const phone = page.getByLabel(s.fieldPhone);
      await expect(page.getByText(s.errorPhone)).toBeVisible();
      await expect(phone).toHaveAttribute('aria-invalid', 'true');
      await expect(phone).toBeFocused();
      expect(page.url()).toContain('/checkout');
      expect(await ordersFor(request, '0223456789')).toEqual([]);
    });

    test('an empty street shows its error and announces it', async ({ page }) => {
      await fillCheckout(page, lang, testCustomer({ street: '' }));
      await page.getByRole('button', { name: s.placeOrder }).click();

      const street = page.getByLabel(s.fieldStreet);
      await expect(street).toHaveAttribute('aria-invalid', 'true');
      await expect(street).toBeFocused();

      // The field points at its message, and the message says what is wrong.
      const describedBy = await street.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      const messages = await street.evaluate(
        (field) =>
          (field.getAttribute('aria-describedby') ?? '')
            .split(' ')
            .map((id) => document.getElementById(id)?.textContent ?? ''),
      );
      expect(messages.join(' ')).toContain(s.errorRequired);

      // The fields that are fine are not marked, and a summary is announced to screen readers.
      await expect(page.getByLabel(s.fieldName)).not.toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByRole('alert')).toContainText(s.errorSummary);
    });

    test('an error clears when the field is corrected', async ({ page }) => {
      await fillCheckout(page, lang, testCustomer({ phone: '0223456789' }));
      await page.getByRole('button', { name: s.placeOrder }).click();
      const phone = page.getByLabel(s.fieldPhone);
      await expect(phone).toHaveAttribute('aria-invalid', 'true');

      await phone.fill('01012345678');
      await expect(phone).not.toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByText(s.errorPhone)).toHaveCount(0);
    });
  });
}
