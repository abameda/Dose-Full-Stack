// The commerce API on Node: the same Hono app the Worker serves, over a shared Postgres pool.
// Run with `pnpm --filter @dose/node-control start`; configure with environment variables:
//   DATABASE_URL        (required) Postgres URL for the application role (`dose_app`).
//   ENVIRONMENT         local | test | preview | staging | production (default: local).
//   HOST, PORT          where to listen (default: 127.0.0.1:4010; the container sets HOST=0.0.0.0).
//   POC_TOKEN           (required unless local) the bearer token every request must carry, at least
//                       32 characters (src/poc-auth.ts).
//   POC_ALLOWED_ORIGIN  (required unless local) the one browser origin allowed by CORS: the poc
//                       Worker's, for its latency page.
// Outside `local` every request goes through `pocAuth` first: on Fly.io (Task 19) nothing else
// stands in front of the container.
import process from 'node:process';
import { createApp, type ApiDeps } from '@dose/api';
import { createPoolDb } from '@dose/core/db';
import { serve } from '@hono/node-server';
import { pocAuthFromEnv, withPocAuth } from './poc-auth';

const ENVIRONMENTS: readonly ApiDeps['env'][] = ['local', 'test', 'preview', 'staging', 'production'];

/**
 * Postgres connections the process holds at most. The proof of concept fires 200 checkouts at
 * once against a Neon Free compute; each is one short transaction, so 20 connections serve them in
 * turn without approaching Neon's connection limit, and match what Hyperdrive opens to the same
 * branch for the Worker (about 20 origin connections per config on the free plan).
 */
const POOL_MAX = 20;

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
const env = environment();
// Checked before anything connects, so a container without its secrets stops at once.
const pocAuthOptions = pocAuthFromEnv(env, process.env);

const pool = createPoolDb(databaseUrl, { max: POOL_MAX });
const app = createApp({
  // The pool lives for the whole process, so a request's "close" must not end it.
  db: () => ({ ...pool, close: () => Promise.resolve() }),
  env,
  now: () => new Date(),
  verifyStaff: () => Promise.resolve(null), // no staff sign-in here: Access sits in front of the Worker (createAccessVerifier, Task 13)
  webhookProviders: {},
});
const handler = pocAuthOptions === null ? app : withPocAuth(app, pocAuthOptions);

const hostname = process.env['HOST'] ?? '127.0.0.1';
const port = Number(process.env['PORT'] ?? '4010');
const server = serve({ fetch: handler.fetch, hostname, port }, (info) => {
  const guard = pocAuthOptions === null ? '' : ' (bearer token and CORS required)';
  console.log(`node-control: listening on http://${info.address}:${String(info.port)}${guard}`);
});

function shutdown(): void {
  server.close(() => {
    void pool.close().then(() => process.exit(0));
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
