// `pnpm migrate --target <ownerUrl> [--allow-remote]`
//
// Applies the migrations the target database does not have yet (src/migrate.ts) and prints their
// names. Run as the owner role (`dose_owner`). On a database that is not on this machine, migration
// 0001 takes the `dose_app` password from `DOSE_APP_PASSWORD`. The URL is never printed: it holds
// the owner password.
//   --target        Postgres URL of the owner role for the database.
//   --allow-remote  needed for a database that is not on this machine.
import { parseArgs } from 'node:util';
import { migrate } from '../src/migrate';
import { checkSeedTarget } from '../seed/target';

const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    'allow-remote': { type: 'boolean', default: false },
  },
});

const { target, 'allow-remote': allowRemote } = values;
if (target === undefined || target === '') throw new Error('--target <owner database URL> is required');
checkSeedTarget(target, { allowRemote, fresh: false, production: true });

const applied = await migrate(target);
for (const name of applied) console.log(`migrate: applied ${name}`);
console.log(`migrate: ${String(applied.length)} migration(s) applied`);
