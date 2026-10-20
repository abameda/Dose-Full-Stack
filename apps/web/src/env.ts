import { createAccessVerifier, createApp, findActiveStaff, type ApiDeps } from '@dose/api';
import type { Hyperdrive, R2Bucket } from '@cloudflare/workers-types';
import { createRequestDb, type Db } from '@dose/core/db';
import { errors, type JWTVerifyGetKey } from 'jose';

/** The Worker's bindings and variables, as declared in wrangler.jsonc. */
export interface WorkerEnv {
  HYPERDRIVE: Hyperdrive;
  /** Absent in the cloud environments of Milestone 1, which serve the seed photos as static assets (decision 0011). */
  MEDIA?: R2Bucket;
  ENVIRONMENT: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
}

const ENVIRONMENTS: readonly ApiDeps['env'][] = ['local', 'test', 'preview', 'staging', 'production'];

export function environmentOf(env: WorkerEnv): ApiDeps['env'] {
  const known = ENVIRONMENTS.find((name) => name === env.ENVIRONMENT);
  if (known === undefined) throw new Error(`ENVIRONMENT must be one of ${ENVIRONMENTS.join(', ')}; got "${env.ENVIRONMENT}"`);
  return known;
}

/** One database connection for one request or one cron run, through Hyperdrive. Close it when done. */
export function requestDb(env: WorkerEnv): Db {
  return createRequestDb(env.HYPERDRIVE.connectionString);
}

/** On a developer machine without Access in front, every Access token is refused (no keys to fetch). */
const NO_ACCESS_KEYS: JWTVerifyGetKey = () => {
  throw new errors.JWKSNoMatchingKey();
};

function staffVerifier(env: WorkerEnv, environment: ApiDeps['env']): ApiDeps['verifyStaff'] {
  const configured = env.ACCESS_TEAM_DOMAIN !== '' && env.ACCESS_AUD !== '';
  if (!configured && environment !== 'local') {
    throw new Error('ACCESS_TEAM_DOMAIN and ACCESS_AUD must be set outside local development');
  }
  const lookup = async (identity: string) => {
    const db = requestDb(env);
    try {
      return await findActiveStaff(db, identity);
    } finally {
      await db.close();
    }
  };
  return createAccessVerifier({
    teamDomain: configured ? env.ACCESS_TEAM_DOMAIN : 'access.invalid',
    audience: configured ? env.ACCESS_AUD : 'local',
    ...(configured ? {} : { jwks: NO_ACCESS_KEYS }),
    env: environment,
    lookup,
  });
}

let verifier: { env: WorkerEnv; verify: ApiDeps['verifyStaff'] } | undefined;

/**
 * Who is asking, for the admin API and the studio alike: one verifier per isolate, so Access's
 * signing keys are fetched once and cached.
 */
export function verifyStaffFor(env: WorkerEnv): ApiDeps['verifyStaff'] {
  if (verifier?.env !== env) verifier = { env, verify: staffVerifier(env, environmentOf(env)) };
  return verifier.verify;
}

type Api = ReturnType<typeof createApp>;
let api: { env: WorkerEnv; app: Api } | undefined;

/**
 * The commerce API (Hono, `@dose/api`) for this Worker, built once per isolate. Every request
 * gets its own database connection, which the app closes when the request ends.
 */
export function apiFor(env: WorkerEnv): Api {
  if (api?.env !== env) {
    const environment = environmentOf(env);
    const app = createApp({
      db: () => requestDb(env),
      env: environment,
      now: () => new Date(),
      verifyStaff: verifyStaffFor(env),
      webhookProviders: {}, // Paymob arrives in a later milestone
    });
    api = { env, app };
  }
  return api.app;
}
