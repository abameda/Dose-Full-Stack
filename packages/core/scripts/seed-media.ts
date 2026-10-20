// `pnpm --filter @dose/core run seed:media --out <dir>`
//
// Writes every seed photo to `<dir>/products/<slug>/<sha256>.jpg`, the bytes and keys `pnpm seed`
// records, so a Worker without an R2 bucket serves them as static assets (decision 0011). apps/web's
// build runs it with `--out ../../apps/web/public/media` (relative to this package).
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { writeSeedMediaAssets } from '../seed/catalogue';

const { values } = parseArgs({ options: { out: { type: 'string' } } });
if (values.out === undefined || values.out === '') throw new Error('--out <directory> is required');

const keys = await writeSeedMediaAssets(pathToFileURL(resolve(process.cwd(), values.out)));
console.log(`seed:media: wrote ${String(keys.length)} image(s)`);
