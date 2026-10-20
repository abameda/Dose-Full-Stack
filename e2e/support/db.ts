import { Client } from 'pg';
import { OWNER_URL } from './env';

/** Runs `fn` with a connection as the owner role (`dose_owner`) and closes it afterwards. */
async function asOwner<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: OWNER_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** The price of a variant in piastres. */
export async function variantPrice(sku: string): Promise<number> {
  return asOwner(async (client) => {
    const { rows } = await client.query<{ price_piastres: number }>(`select price_piastres from variants where sku = $1`, [sku]);
    const row = rows[0];
    if (row === undefined) throw new Error(`no variant ${sku}`);
    return row.price_piastres;
  });
}

/** Changes a variant's price, as the owner would in the admin (M2); used to make a bag stale. */
export async function setVariantPrice(sku: string, piastres: number): Promise<void> {
  await asOwner(async (client) => {
    const result = await client.query(`update variants set price_piastres = $2 where sku = $1`, [sku, piastres]);
    if (result.rowCount !== 1) throw new Error(`no variant ${sku}`);
  });
}
