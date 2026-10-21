import type { Db } from './db';
import { getStock, receiveStock, type Stock } from './stock';

export interface ReceiveInput {
  sku: string;
  /** A positive whole number of units. */
  units: number;
  /** Names this delivery; the same key receives stock once. */
  sourceKey: string;
}

/** Who receives stock through `pnpm stock:receive`, on the ledger. */
const OPERATOR = { type: 'system', id: 'stock:receive' } as const;

/**
 * Receives `units` of the variant with this SKU onto the stock ledger, in one transaction, under
 * `sourceKey`: running it again with the same key changes nothing (`'duplicate'`). Returns the
 * outcome and the variant's stock afterwards. Connect as the owner role (`dose_owner`).
 */
export async function receiveStockBySku(db: Db, input: ReceiveInput): Promise<{ outcome: 'applied' | 'duplicate'; stock: Stock }> {
  const sku = input.sku.trim();
  const sourceKey = input.sourceKey.trim();
  if (sku === '') throw new Error('sku must not be empty');
  if (sourceKey === '') throw new Error('source key must not be empty');
  return db.transaction(async (tx) => {
    const [variant] = await tx.query<{ id: string }>(`select id from variants where sku = $1`, [sku]);
    if (variant === undefined) throw new Error(`no variant has the SKU ${sku}`);
    const outcome = await receiveStock(tx, { variantId: variant.id, quantity: input.units, sourceKey, actor: OPERATOR });
    return { outcome, stock: await getStock(tx, variant.id) };
  });
}
