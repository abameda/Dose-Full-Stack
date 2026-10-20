import type { Lang, ProductView } from '@dose/contract';
import { toProductView } from '@dose/api';
import { getPublishedProduct, listPublishedProducts } from '@dose/core/catalogue';
import { GOVERNORATES } from '@dose/core/governorates';
import { env } from 'cloudflare:workers';
import { requestDb } from './env';

// What the storefront pages read. The pages load their data here, on the server, and hand it to
// the design direction's page component as props: a direction never fetches commerce data.

/** Every published product, as the storefront API would describe it in this language. */
export async function loadProducts(lang: Lang): Promise<ProductView[]> {
  const db = requestDb(env);
  try {
    return (await listPublishedProducts(db)).map((row) => toProductView(row, lang));
  } finally {
    await db.close();
  }
}

/** One published product, or null when there is none with this slug. */
export async function loadProduct(slug: string, lang: Lang): Promise<ProductView | null> {
  const db = requestDb(env);
  try {
    const row = await getPublishedProduct(db, slug);
    return row === null ? null : toProductView(row, lang);
  } finally {
    await db.close();
  }
}

/** The 27 governorates named in this language, for the checkout's select. */
export function governorateOptions(lang: Lang): { code: string; name: string }[] {
  return GOVERNORATES.map((governorate) => ({
    code: governorate.code,
    name: lang === 'ar' ? governorate.nameAr : governorate.nameEn,
  }));
}
