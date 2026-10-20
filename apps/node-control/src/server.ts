// The commerce API on Node: the same Hono app the Worker serves, over a shared Postgres pool.
// Run with `pnpm --filter @dose/node-control start`; configure with environment variables:
//   DATABASE_URL  (required) Postgres URL for the application role (`dose_app`).
//   ENVIRONMENT   local | test | preview | staging | production (default: local).
//   HOST, PORT    where to listen (default: 127.0.0.1:4010).
import process from 'node:process';
import { createApp, type ApiDeps } from '@dose/api';
import { createPoolDb } from '@dose/core/db';
import { serve } from '@hono/node-server';

const ENVIRONMENTS: readonly ApiDeps['env'][] = ['local', 'test', 'preview', 'staging', 'production'];

function environment(): ApiDeps['env'] {
  const name = process.env['ENVIRONMENT'] ?? 'local';
  const known = ENVIRONMENTS.find((env) => env === name);
  if (known === undefined) throw new Error(`ENVIRONMENT must be one of ${ENVIRONMENTS.join(', ')}; got "${name}"`);
  return known;
}

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl === '') {
  throw new Error('DATABASE_URL is required (the Postgres URL of the dose_app role)');
}

const pool = createPoolDb(databaseUrl);
const app = createApp({
  // The pool lives for the whole process, so a request's "close" must not end it.
  db: () => ({ ...pool, close: () => Promise.resolve() }),
  env: environment(),
  now: () => new Date(),
  verifyStaff: () => Promise.resolve(null), // no staff sign-in here: Access sits in front of the Worker (createAccessVerifier, Task 13)
  webhookProviders: {},
});

const hostname = process.env['HOST'] ?? '127.0.0.1';
const port = Number(process.env['PORT'] ?? '4010');
const server = serve({ fetch: app.fetch, hostname, port }, (info) => {
  console.log(`node-control: listening on http://${info.address}:${String(info.port)}`);
});

function shutdown(): void {
  server.close(() => {
    void pool.close().then(() => process.exit(0));
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
