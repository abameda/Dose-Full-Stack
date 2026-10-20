import { Client, Pool } from 'pg';

/** Anything that can run a query: the database itself, or one open transaction. */
export interface Tx {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<R[]>;
}

export interface Db extends Tx {
  /**
   * Runs `fn` in one transaction: commits when it resolves, rolls back when it throws
   * (the original error is rethrown). Use only the `tx` passed in, never the `Db`, inside `fn`.
   */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

function asTx(client: Queryable): Tx {
  return {
    async query<R>(sql: string, params?: unknown[]) {
      const result = await (params === undefined ? client.query(sql) : client.query(sql, params));
      return result.rows as R[];
    },
  };
}

/** Runs `fn` between BEGIN and COMMIT on one connection, rolling back on any error. */
async function inTransaction<T>(client: Queryable, fn: (tx: Tx) => Promise<T>): Promise<T> {
  await client.query('begin');
  try {
    const result = await fn(asTx(client));
    await client.query('commit');
    return result;
  } catch (error) {
    // If the connection itself is broken the rollback fails too; the original error matters more.
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}

/** Node: a shared `pg.Pool`. Create it once per process. */
export function createPoolDb(connectionString: string, opts: { max?: number } = {}): Db {
  const pool = new Pool({ connectionString, ...(opts.max === undefined ? {} : { max: opts.max }) });
  // An idle connection dropped by the server must not crash the process; the pool replaces it.
  pool.on('error', (error) => {
    console.error('postgres pool: idle client error', error.message);
  });
  const poolTx = asTx(pool);
  return {
    query: poolTx.query.bind(poolTx),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        return await inTransaction(client, fn);
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/**
 * Workers: one `pg.Client` for the lifetime of one request. It connects on first use, so a
 * request that never touches the database opens no connection. Call `close()` when the request
 * ends (Hyperdrive pools the real connections).
 */
export function createRequestDb(connectionString: string): Db {
  let connecting: Promise<Client> | undefined;
  let closed = false;

  function connection(): Promise<Client> {
    if (closed) return Promise.reject(new Error('Database connection already closed'));
    connecting ??= (async () => {
      const client = new Client({ connectionString });
      try {
        await client.connect();
      } catch (error) {
        connecting = undefined; // let a later call retry
        throw error;
      }
      return client;
    })();
    return connecting;
  }

  return {
    async query<R>(sql: string, params?: unknown[]) {
      return asTx(await connection()).query<R>(sql, params);
    },
    async transaction(fn) {
      return inTransaction(await connection(), fn);
    },
    async close() {
      closed = true;
      const pending = connecting;
      connecting = undefined;
      if (pending === undefined) return;
      // A connect still in flight is awaited so its socket is closed rather than leaked.
      const client = await pending.catch(() => undefined);
      await client?.end();
    },
  };
}
