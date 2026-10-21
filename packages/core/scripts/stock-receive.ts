// `pnpm stock:receive --target <ownerUrl> --sku <sku> --units <n> --source-key <key> [--allow-remote]`
//
// Receives stock for one variant onto the ledger (src/stock-admin.ts). The same source key receives
// once, so a retried run changes nothing. Run as the owner role (`dose_owner`). The staging
// workflow tops up the SKU its end-to-end tests order before every run.
//   --target        Postgres URL of the owner role for the database.
//   --sku           the variant's SKU, e.g. BLANC-50ML.
//   --units         a positive whole number of units.
//   --source-key    names this delivery, e.g. staging-topup:<run id>-<attempt>.
//   --allow-remote  needed for a database that is not on this machine.
import { parseArgs } from 'node:util';
import { createRequestDb } from '../src/db';
import { receiveStockBySku } from '../src/stock-admin';
import { checkSeedTarget } from '../seed/target';

const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    sku: { type: 'string' },
    units: { type: 'string' },
    'source-key': { type: 'string' },
    'allow-remote': { type: 'boolean', default: false },
  },
});

const { target, sku, units, 'source-key': sourceKey, 'allow-remote': allowRemote } = values;
if (target === undefined || target === '') throw new Error('--target <owner database URL> is required');
if (sku === undefined) throw new Error('--sku <sku> is required');
if (units === undefined || !/^[0-9]+$/.test(units)) throw new Error('--units <whole number> is required');
if (sourceKey === undefined) throw new Error('--source-key <key> is required');
checkSeedTarget(target, { allowRemote, fresh: false, neverProduction: false });

const db = createRequestDb(target);
try {
  const { outcome, stock } = await receiveStockBySku(db, { sku, units: Number(units), sourceKey });
  console.log(
    `stock ${sku.trim()}: ${outcome === 'applied' ? `received ${units}` : 'already received under this key'}; on hand ${String(stock.onHand)}, available ${String(stock.available)}`,
  );
} finally {
  await db.close();
}
