// `pnpm staff:add --target <ownerUrl> --identity <identity> --name <name> --role <role> [--allow-remote]`
//
// Adds a staff member, or updates the one with this identity (name, role, active again). Run as the
// owner role (`dose_owner`).
//   --target        Postgres URL of the owner role for the database.
//   --identity      an email address, or the client ID of a Cloudflare Access service token.
//   --name          the name shown on the audit log.
//   --role          owner | operations | marketing | accountant.
//   --allow-remote  needed for a database that is not on this machine.
import { parseArgs } from 'node:util';
import { createRequestDb } from '../src/db';
import { upsertStaff } from '../src/staff-admin';
import { checkSeedTarget } from '../seed/target';

const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    identity: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string' },
    'allow-remote': { type: 'boolean', default: false },
  },
});

const { target, identity, name, role, 'allow-remote': allowRemote } = values;
if (target === undefined || target === '') throw new Error('--target <owner database URL> is required');
if (identity === undefined) throw new Error('--identity <email or Access service-token client ID> is required');
if (name === undefined) throw new Error('--name <name> is required');
if (role === undefined) throw new Error('--role <owner|operations|marketing|accountant> is required');
checkSeedTarget(target, { allowRemote, fresh: false });

const db = createRequestDb(target);
try {
  const outcome = await upsertStaff(db, { identity, name, role });
  console.log(`staff ${identity.trim()}: ${outcome} as ${role}`);
} finally {
  await db.close();
}
