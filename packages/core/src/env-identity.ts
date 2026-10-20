import type { Tx } from './db';

/**
 * What a database may call itself. The same pattern is the CHECK on `env_identity.name`
 * (migration 0006); the CLI tests it first so a typo fails before any connection is made.
 */
export const ENV_IDENTITY_PATTERN = /^(production|nonprod:(seed|staging|poc|preview\/pr-[1-9][0-9]*))$/;

export function isEnvIdentity(name: string): boolean {
  return ENV_IDENTITY_PATTERN.test(name);
}

/** Sets the one `env_identity` row to `name`: inserts it, or changes the row that is there. Owner role only. */
export async function setEnvIdentity(db: Tx, name: string): Promise<void> {
  if (!isEnvIdentity(name)) throw new Error(`"${name}" is not a valid environment identity`);
  await db.query(
    `insert into env_identity (one, name) values (true, $1)
     on conflict (one) do update set name = excluded.name`,
    [name],
  );
}

/** The name this database gives itself, or null when none was set. */
export async function readEnvIdentity(db: Tx): Promise<string | null> {
  const [row] = await db.query<{ name: string }>(`select name from env_identity`);
  return row?.name ?? null;
}
