// `pnpm seed --target <ownerUrl> --media local|r2|none [--bucket <name>] [--fresh] [--allow-remote]`
//
// Migrates the target database, then seeds it (seed/catalogue.ts) and uploads the images.
//   --target        Postgres URL of the owner role (`dose_owner`) for the database to seed.
//   --media         `local`: the local R2 of `wrangler dev` (apps/web/.wrangler/state);
//                   `r2`: the real bucket, through `wrangler r2 object put --remote` (needs a
//                   Cloudflare login, so it only runs where one exists, never on a developer
//                   machine in Milestone 1);
//                   `none`: records the keys and rows and uploads nothing, for a Worker without a
//                   bucket that serves the photos as static assets from its build (decision 0011).
//   --bucket        the R2 bucket name (default `dose-media`, as in apps/web/wrangler.jsonc).
//   --fresh         drops and recreates the target database first. Refused unless it is on this machine.
//   --allow-remote  seeds a database that is not on this machine (a preview or staging branch, never
//                   production, which holds an empty migrated database and nothing else). Without it
//                   a non-local target is refused. The local `@example.test` staff are written only
//                   to a local database, flag or not.
import { spawn } from 'node:child_process';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { createRequestDb } from '../src/db';
import { migrate } from '../src/migrate';
import { seedCatalogue, type MediaStore } from './catalogue';
import { checkSeedTarget } from './target';

/** Relative to apps/web, where `wrangler dev` runs; playwright.config.ts passes the same path. */
const LOCAL_PERSIST_DIR = '.wrangler/state';

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Drops and recreates the database named in `target`, connected to `postgres` on the same server. */
async function recreateDatabase(target: string): Promise<void> {
  const url = new URL(target);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (name === '' || name === 'postgres') throw new Error('--fresh needs a database name other than postgres in --target');
  url.pathname = '/postgres';
  const admin = createRequestDb(url.toString());
  try {
    await admin.query(`drop database if exists ${quoteIdent(name)} with (force)`);
    await admin.query(`create database ${quoteIdent(name)}`);
  } finally {
    await admin.close();
  }
}

/** Uploads through the wrangler CLI of apps/web, piping the bytes to `r2 object put --pipe`. */
function wranglerMedia(bucket: string, where: string[]): MediaStore {
  return {
    put(key, bytes, contentType) {
      const args = ['--filter', '@dose/web', 'exec', 'wrangler', 'r2', 'object', 'put', `${bucket}/${key}`];
      args.push('--pipe', '--content-type', contentType, ...where);
      return new Promise((resolve, reject) => {
        const stdio = ['pipe', 'ignore', 'inherit'] as const;
        // pnpm is a .cmd shim on Windows, which only a shell can start. Every argument is a fixed
        // word, the checked bucket name or a key built from a slug and a hex hash: none needs quoting.
        const child =
          process.platform === 'win32'
            ? spawn(['pnpm', ...args].join(' '), { shell: true, stdio: [...stdio] })
            : spawn('pnpm', args, { stdio: [...stdio] });
        child.on('error', reject);
        child.on('exit', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`wrangler r2 object put ${key} exited with ${String(code)}`));
        });
        child.stdin.end(bytes);
      });
    },
  };
}

const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    media: { type: 'string' },
    bucket: { type: 'string', default: 'dose-media' },
    fresh: { type: 'boolean', default: false },
    'allow-remote': { type: 'boolean', default: false },
  },
});

const { target, media, bucket, fresh, 'allow-remote': allowRemote } = values;
if (target === undefined || target === '') throw new Error('--target <owner database URL> is required');
const { local } = checkSeedTarget(target, { allowRemote, fresh, production: false });
if (media !== 'local' && media !== 'r2' && media !== 'none') throw new Error('--media must be local, r2 or none');
// R2's own naming rule; it also keeps the name safe on the Windows command line above.
if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('--bucket is not a valid R2 bucket name');

if (fresh) await recreateDatabase(target);
const applied = await migrate(target);
console.log(`seed: ${String(applied.length)} migration(s) applied`);

/** For `--media none`: the web build writes the same bytes under the same keys (`pnpm --filter @dose/core run seed:media`). */
const noUpload: MediaStore = { put: () => Promise.resolve() };

const store =
  media === 'none'
    ? noUpload
    : wranglerMedia(bucket, media === 'local' ? ['--local', '--persist-to', LOCAL_PERSIST_DIR] : ['--remote']);
const db = createRequestDb(target);
try {
  const result = await seedCatalogue(db, store, { localStaff: local });
  if (!local) console.log('seed: not a local database, so no local staff were written');
  for (const image of result.images) console.log(`seed: ${media === 'none' ? 'recorded' : 'stored'} ${image.key}`);
  for (const [sku, outcome] of Object.entries(result.stock)) {
    console.log(`seed: ${sku} opening stock ${outcome === 'applied' ? 'received' : 'already received'}`);
  }
} finally {
  await db.close();
}
