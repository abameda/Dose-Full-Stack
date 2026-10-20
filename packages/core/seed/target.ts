const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Decides whether `pnpm seed` may write to `target` (an owner Postgres URL), and whether it is a
 * database on this machine. Production holds an empty, migrated database and nothing else, so a
 * database anywhere else is refused unless `--allow-remote` says the operator means it (preview and
 * staging branches); `--fresh` drops a database, so it is refused anywhere but here.
 */
export function checkSeedTarget(target: string, flags: { allowRemote: boolean; fresh: boolean }): { local: boolean } {
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
    throw new Error(`${host} is not a local database; pass --allow-remote to seed it (never production)`);
  }
  return { local };
}
