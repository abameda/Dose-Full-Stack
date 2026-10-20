// Run with `pnpm rules:check`. Node runs this file directly (it strips the types), which is why
// the two imports below name their `.ts` files; the package's other sources import extensionless.
import { createPoolDb } from '../src/db.ts';
import { checkRules } from '../src/rules.ts';

// The owner role (`dose_owner`), never `dose_app`: the checker reads privileges. Without
// DOSE_OWNER_DATABASE_URL it uses the fixed, dev-only database of docker-compose.yml.
const url =
  process.env['DOSE_OWNER_DATABASE_URL'] ?? 'postgres://dose_owner:dose_owner_local@127.0.0.1:54329/dose';

const db = createPoolDb(url, { max: 1 });
try {
  const violations = await checkRules(db);
  if (violations.length === 0) {
    console.log('rules:check: every rule holds');
  } else {
    for (const v of violations) {
      console.error(`rule ${String(v.rule)}${v.ref === undefined ? '' : ` [${v.ref}]`}: ${v.detail}`);
    }
    console.error(`rules:check: ${String(violations.length)} violation(s)`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error('rules:check: could not run the checks:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.close();
}
