const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface TargetFlags {
  /** `--allow-remote`: the operator means a database that is not on this machine. */
  allowRemote: boolean;
  /** `--fresh`: the tool drops the database first. */
  fresh: boolean;
  /**
   * The tool must never write to production: true for the seed (production holds an empty,
   * migrated database and nothing else), so its refusal says so. False for `migrate`,
   * `env:identity`, `staff:add` and `stock:receive`, which production needs too.
   */
  neverProduction: boolean;
}

/**
 * Decides whether an owner CLI (`seed`, `migrate`, `env:identity`, `staff:add`, `stock:receive`) may write to `target`
 * (an owner Postgres URL), and whether it is a database on this machine. A database anywhere else is
 * refused unless `--allow-remote` says the operator means it; `--fresh` drops a database, so it is
 * refused anywhere but here.
 */
export function checkSeedTarget(target: string, flags: TargetFlags): { local: boolean } {
  let host: string;
  try {
    host = new URL(target).hostname;
  } catch {
    // Not the URL itself: it holds the owner password.
    throw new Error('--target is not a valid database URL');
  }
  const local = LOCAL_HOSTS.has(host);
  if (!local && flags.fresh) throw new Error(`--fresh only works on a local database, not ${host}`);
  if (!local && !flags.allowRemote) {
    const never = flags.neverProduction ? ' (never production)' : '';
    throw new Error(`${host} is not a local database; pass --allow-remote to write to it${never}`);
  }
  return { local };
}
