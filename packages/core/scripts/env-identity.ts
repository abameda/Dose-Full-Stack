// `pnpm env:identity --target <ownerUrl> --name <name> [--allow-remote]`
//
// Sets the single env_identity row of the target database (what this database is). Run as the owner
// role (`dose_owner`); the application role can only read it.
//   --target        Postgres URL of the owner role for the database.
//   --name          production, or nonprod:seed | nonprod:staging | nonprod:poc | nonprod:preview/pr-<n>.
//   --allow-remote  needed for a database that is not on this machine.
import { parseArgs } from 'node:util';
import { createRequestDb } from '../src/db';
import { isEnvIdentity, setEnvIdentity } from '../src/env-identity';
import { checkSeedTarget } from '../seed/target';

const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    name: { type: 'string' },
    'allow-remote': { type: 'boolean', default: false },
  },
});

const { target, name, 'allow-remote': allowRemote } = values;
if (target === undefined || target === '') throw new Error('--target <owner database URL> is required');
if (name === undefined || !isEnvIdentity(name)) {
  throw new Error('--name must be production, or nonprod:seed, nonprod:staging, nonprod:poc or nonprod:preview/pr-<n>');
}
checkSeedTarget(target, { allowRemote, fresh: false });

const db = createRequestDb(target);
try {
  await setEnvIdentity(db, name);
} finally {
  await db.close();
}
console.log(`env_identity = ${name}`);
