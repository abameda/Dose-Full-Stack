import process from 'node:process';
import { Client } from 'pg';
import { expect, test } from 'vitest';

// `pnpm test:preview`: what keeps a pull request's preview apart from production. Run by
// .github/workflows/preview.yml against the preview it has just set up, never by `pnpm check`
// (there are no credentials there). Every input comes from the environment, and a missing one
// fails the run before any test, so a misconfigured workflow cannot pass by testing nothing.
//
// PREVIEW_APP_URL holds the dose_app password: no message here may include it, so the tests only
// ever show its host.

const INPUTS = [
  'PR_NUMBER', // the pull request's number
  'PREVIEW_URL', // the preview Worker version's URL (https://pr-<n>-dose-web-staging.<subdomain>.workers.dev)
  'PREVIEW_DB_HOST', // the preview branch's read-write endpoint host
  'PREVIEW_APP_URL', // dose_app on the preview branch's `dose` database
  'PROD_DB_HOST', // the production endpoint's host (not a secret)
  'NEON_API_KEY', // reads the nonprod project's endpoints
  'NEON_NONPROD_PROJECT_ID',
  'CF_ACCESS_CLIENT_ID', // the Access service token, an active staff member of the preview database
  'CF_ACCESS_CLIENT_SECRET',
] as const;

type Input = (typeof INPUTS)[number];

function readInputs(): Record<Input, string> {
  const missing = INPUTS.filter((name) => (process.env[name] ?? '') === '');
  if (missing.length > 0) throw new Error(`pnpm test:preview needs ${missing.join(', ')}; not set`);
  return Object.fromEntries(INPUTS.map((name) => [name, process.env[name] ?? ''])) as Record<Input, string>;
}

const env = readInputs();
const PREVIEW_URL = env.PREVIEW_URL.replace(/\/+$/, '');

/** The same URL pointing at another host. */
function withHost(url: string, host: string): string {
  const u = new URL(url);
  u.hostname = host;
  return u.href;
}

const CONNECT_TIMEOUT_MS = 20_000;

// A `pg.Client` holds its password, and an assertion prints whatever it is given, so a client never
// reaches `expect`: the helpers below return plain strings and numbers only.

function client(url: string): Client {
  const c = new Client({ connectionString: url, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
  c.on('error', () => undefined); // a connection dropped after its query is not a test failure
  return c;
}

/** How the server answers a connection with `url`: `connected`, or the message it refuses with. */
async function connectionAnswer(url: string): Promise<string> {
  const c = client(url);
  try {
    await c.connect();
    return 'connected';
  } catch (error) {
    return error instanceof Error ? error.message : 'a refusal that is not an Error';
  } finally {
    await c.end().catch(() => undefined);
  }
}

async function count(table: 'customers' | 'orders'): Promise<number> {
  const c = client(env.PREVIEW_APP_URL);
  try {
    await c.connect();
    const result = await c.query<{ n: number }>(`select count(*)::int as n from ${table}`);
    return result.rows[0]?.n ?? Number.NaN;
  } finally {
    await c.end().catch(() => undefined);
  }
}

/** Every compute endpoint host of a Neon project (Neon API v2). */
async function neonEndpointHosts(projectId: string): Promise<string[]> {
  const response = await fetch(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}/endpoints`, {
    headers: { authorization: `Bearer ${env.NEON_API_KEY}`, accept: 'application/json' },
  });
  expect(response.status, 'the Neon API lists the nonprod project endpoints').toBe(200);
  const body = (await response.json()) as { endpoints?: { host?: unknown }[] };
  return (body.endpoints ?? []).map((e) => e.host).filter((host): host is string => typeof host === 'string');
}

const ACCESS_HEADERS = {
  'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID,
  'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET,
};

test('the preview database is a nonprod branch', async () => {
  expect(env.PREVIEW_DB_HOST).not.toBe(env.PROD_DB_HOST);
  expect(await neonEndpointHosts(env.NEON_NONPROD_PROJECT_ID)).toContain(env.PREVIEW_DB_HOST);
});

test('preview credentials cannot connect to production', async () => {
  // Only the production server's refusal of these credentials counts: a connection, DNS or TLS
  // error would pass a looser check without proving anything.
  expect(await connectionAnswer(withHost(env.PREVIEW_APP_URL, env.PROD_DB_HOST))).toMatch(
    /password authentication failed|role "?[^"\s]+"? does not exist/i,
  );
});

test('the preview holds no customers or orders', async () => {
  expect(new URL(env.PREVIEW_APP_URL).hostname, 'the counted database is the preview branch').toBe(env.PREVIEW_DB_HOST);
  expect(await count('customers')).toBe(0);
  expect(await count('orders')).toBe(0);
});

test('the deployed preview reports a nonprod database', async () => {
  const response = await fetch(`${PREVIEW_URL}/api/_diag/db-identity`, { headers: ACCESS_HEADERS, redirect: 'manual' });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ identity: `nonprod:preview/pr-${env.PR_NUMBER}` });
});

// Belief B7, on every run: Cloudflare Access stands in front of the preview URL.
test('without Access credentials the preview does not reach the app', async () => {
  for (const path of ['/', '/en']) {
    const response = await fetch(`${PREVIEW_URL}${path}`, { redirect: 'manual' });
    const body = await response.text();
    // Every storefront and studio page marks its <html> with the direction it renders.
    expect(body, `GET ${path} must not be the storefront`).not.toContain('data-direction');
    const location = response.headers.get('location');
    const answer = {
      status: response.status,
      // Access sends a visitor without a session to https://<team>.cloudflareaccess.com/...;
      // the app itself would send `/` to `/ar` or `/en`.
      to: location === null ? null : new URL(location, `${PREVIEW_URL}/`).origin,
    };
    const deniedByAccess = answer.status === 401 || answer.status === 403;
    const sentToAccessLogin =
      [301, 302, 303, 307, 308].includes(answer.status) && answer.to !== null && /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(answer.to);
    expect(deniedByAccess || sentToAccessLogin, `GET ${path} answered ${JSON.stringify(answer)}`).toBe(true);
  }
});
