import { readdir, readFile } from 'node:fs/promises';
import { Client } from 'pg';

const DEFAULT_DIR = new URL('../migrations/', import.meta.url);

// One fixed key so concurrent `migrate` calls (two deploys, two test workers) queue up.
const ADVISORY_LOCK_KEY = 7_265_001;

/** Only a database on this machine may fall back to the documented dev-only app password. */
const LOCAL_APP_PASSWORD = 'dose_app_local';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '']);

function appPassword(connectionString: string): string {
  const fromEnv = process.env['DOSE_APP_PASSWORD'];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return LOCAL_HOSTS.has(new URL(connectionString).hostname) ? LOCAL_APP_PASSWORD : '';
}

/**
 * Applies every `*.sql` file in the migrations folder that is not yet in `schema_migrations`,
 * in file-name order, each in its own transaction (so a failing file leaves nothing behind and
 * stops the run). Connect as the owner role (`dose_owner`). Returns the names applied this call,
 * so a second call returns `[]`.
 *
 * Migration 0001 creates the `dose_app` login role. Its password comes from `DOSE_APP_PASSWORD`;
 * on a local database it falls back to the dev-only value, anywhere else the migration fails
 * rather than create a role with a guessable password. The password reaches the SQL as the
 * transaction setting `dose.app_password`.
 */
export async function migrate(ownerConnectionString: string, dir: URL = DEFAULT_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
  const password = appPassword(ownerConnectionString);

  const client = new Client({ connectionString: ownerConnectionString });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);

    // schema_migrations is created by migration 0001 itself, so it may not exist yet.
    const existing = await client.query<{ present: boolean }>(
      `select to_regclass('public.schema_migrations') is not null as present`,
    );
    const done = new Set<string>();
    if (existing.rows[0]?.present === true) {
      const rows = await client.query<{ name: string }>('select name from schema_migrations');
      for (const row of rows.rows) done.add(row.name);
    }

    const applied: string[] = [];
    for (const name of files) {
      if (done.has(name)) continue;
      const sql = await readFile(new URL(name, dir), 'utf8');
      try {
        await client.query('begin');
        await client.query(`select set_config('dose.app_password', $1, true)`, [password]);
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [name]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw new Error(`Migration ${name} failed: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      }
      applied.push(name);
    }
    return applied;
  } finally {
    // Closing the session also releases the advisory lock.
    await client.end();
  }
}
