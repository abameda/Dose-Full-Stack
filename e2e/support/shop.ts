import { randomInt } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Lang, OrderDetail, OrderSummary } from '../../packages/contract/src/index';
import { messages, type Messages } from '../../packages/shop/src/i18n';
import { OWNER_HEADERS } from './env';

export const LANGS = ['ar', 'en'] as const satisfies readonly Lang[];

/** The words of a language, so a test asserts what a customer reads without copying the strings. */
export function words(lang: Lang): Messages {
  return messages[lang];
}

/** A valid Egyptian mobile number nobody else in the run is using. */
export function testPhone(): string {
  return `010${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
}

export const PARADISE_SKU = 'PARADISE-50ML';
export const BLANC_SKU = 'BLANC-50ML';
const BAG_KEY = 'dose.bag.v1';

/** Puts lines in the bag before the page's own scripts run, as if added on an earlier visit. */
export async function seedBag(page: Page, lines: { sku: string; quantity: number }[]): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      // Only seed an empty bag, so a reload in the same test keeps the page's own changes.
      if (window.localStorage.getItem(key as string) === null) window.localStorage.setItem(key as string, value as string);
    },
    [BAG_KEY, JSON.stringify(lines)],
  );
}

/** Waits until every island on the page has hydrated: a click before that does nothing. */
export async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll('astro-island[ssr]').length === 0);
}

export type Customer = {
  name: string;
  phone: string;
  governorate: string;
  area: string;
  street: string;
  building: string;
};

export function testCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    name: 'Test Customer',
    phone: testPhone(),
    governorate: 'cairo',
    area: 'Nasr City',
    street: '10 Test Street',
    building: 'Building 4, flat 12',
    ...overrides,
  };
}

/** Fills the checkout form as a customer would, field by field, by the labels they read. */
export async function fillCheckout(page: Page, lang: Lang, customer: Customer): Promise<void> {
  const s = words(lang);
  await page.getByLabel(s.fieldName).fill(customer.name);
  await page.getByLabel(s.fieldPhone).fill(customer.phone);
  await page.getByLabel(s.fieldGovernorate).selectOption(customer.governorate);
  await page.getByLabel(s.fieldArea).fill(customer.area);
  await page.getByLabel(s.fieldStreet).fill(customer.street);
  await page.getByLabel(s.fieldBuilding).fill(customer.building);
}

/** The orders for a phone number, as the owner sees them in the admin API. */
export async function ordersFor(request: APIRequestContext, phone: string): Promise<OrderSummary[]> {
  const response = await request.get('/api/admin/orders', { params: { q: phone }, headers: OWNER_HEADERS });
  expect(response.status()).toBe(200);
  return (await response.json()) as OrderSummary[];
}

export async function orderDetail(request: APIRequestContext, number: string): Promise<OrderDetail> {
  const response = await request.get(`/api/admin/orders/${number}`, { headers: OWNER_HEADERS });
  expect(response.status()).toBe(200);
  return (await response.json()) as OrderDetail;
}

/** The order number in a thanks-page URL: `/<lang>/orders/<number>/thanks`. */
export function orderNumberFromUrl(url: string): string {
  const match = /\/orders\/(D\d{5,})\/thanks$/.exec(new URL(url).pathname);
  if (match?.[1] === undefined) throw new Error(`not a thanks page: ${url}`);
  return match[1];
}
