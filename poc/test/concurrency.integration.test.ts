import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '@dose/api';
import { createRequestDb, type Db } from '@dose/core/db';
import { setEnvIdentity } from '@dose/core/env-identity';
import { checkRules } from '@dose/core/rules';
import { withTestDb, type TestDb } from '@dose/core/test-harness';
import { withPocAuth } from '@dose/node-control/src/poc-auth';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { LATENCY_MIN_FREE, RUNNER_LOCK_KEY, runConcurrencyProof, type RunnerArgs, type RunnerDeps, type RunResult } from '../runner';

// The runner against the real commerce API (createApp, in process) over a migrated test database,
// with the app's requests going through an injected fetch instead of the network.

const TARGET = 'http://poc.test';
const TOKEN = 'integration-test-token-0123456789abcdef';
const TOKEN_HEADERS = { authorization: `Bearer ${TOKEN}` };

let db: TestDb;
let lock: Db;
let dir: string;

beforeEach(async () => {
  db = await withTestDb();
  lock = createRequestDb(db.ownerUrl);
  dir = await mkdtemp(path.join(tmpdir(), 'dose-poc-'));
});

afterEach(async () => {
  await lock.close();
  await db.drop();
  await rm(dir, { recursive: true, force: true });
});

function commerceApi(app: Db) {
  return createApp({
    db: () => ({ ...app, close: () => Promise.resolve() }),
    env: 'test',
    now: () => new Date(),
    verifyStaff: () => Promise.resolve(null),
    webhookProviders: {},
  });
}

/** The commerce API as the target: the shared test pool, never closed per request. */
function apiFetch(app: Db, seen: Request[] = []): typeof fetch {
  const api = commerceApi(app);
  return async (input, init) => {
    const request = new Request(input, init);
    seen.push(request);
    return api.fetch(request);
  };
}

function deps(fetcher: typeof fetch, lines: string[], headers: Record<string, string> = TOKEN_HEADERS): RunnerDeps {
  return { owner: db.owner, lock, fetch: fetcher, headers, log: (line) => lines.push(line) };
}

const args = (o: Partial<RunnerArgs> = {}): RunnerArgs => ({
  target: TARGET,
  auth: 'bearer',
  runs: 2,
  start: 1,
  concurrency: 20,
  units: 3,
  ...o,
});

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const [row] = await db.owner.query<{ n: number }>(sql, params);
  return row?.n ?? 0;
}

test('two runs of 20 checkouts for 3 units: exactly 3 placed per run, the rest out of stock, rules intact', async () => {
  await setEnvIdentity(db.owner, 'nonprod:poc');
  const lines: string[] = [];
  const seen: Request[] = [];
  const out = path.join(dir, 'proof.jsonl');

  const summary = await runConcurrencyProof(args({ out }), deps(apiFetch(db.app, seen), lines));

  expect(summary).toMatchObject({ passed: 2, failed: 0, failures: [] });
  expect(lines[0]).toMatch(/^poc:concurrency \S+: http:\/\/poc\.test \(bearer\), 2 run\(s\) of 20 checkouts for 3 units; POC-LATENCY topped up by 10000$/);
  expect(lines[1]).toMatch(/^run 1\/2: 201=3 409=17 other=0 orders=3 rules=ok in \d+\.\d s$/);
  expect(lines[2]).toMatch(/^run 2\/2: 201=3 409=17 other=0 orders=3 rules=ok in \d+\.\d s$/);
  expect(lines[3]).toMatch(/^summary: 2 run\(s\), 2 passed, 0 failed, in /);

  // Every request carried the target's front-door header.
  expect(seen.length).toBe(2 * (1 + 20));
  expect(seen.every((r) => r.headers.get('authorization') === `Bearer ${TOKEN}`)).toBe(true);
  // No request follows a redirect (an Access login page must be recorded, not fetched).
  expect(seen.every((r) => r.redirect === 'manual')).toBe(true);

  // The database agrees: 6 orders of POC-CONCURRENCY and 6 customers (only a placed order creates
  // one; the 34 refused checkouts left none), and each run started from exactly 3 free units, with
  // one adjustment per run.
  expect(await count(`select count(*)::int as n from order_lines where sku = 'POC-CONCURRENCY'`)).toBe(6);
  expect(await count(`select count(distinct phone_e164)::int as n from customers where phone_e164 like '+2010%'`)).toBe(6);
  expect(await count(`select count(*)::int as n from stock_movements where source_key like 'poc-reset:%'`)).toBe(2);
  expect(await checkRules(db.owner)).toEqual([]);

  const [latency] = await db.owner.query<{ free: number }>(
    `select s.on_hand - s.reserved as free from stock_levels s join variants v on v.id = s.variant_id where v.sku = 'POC-LATENCY'`,
  );
  expect(latency?.free).toBe(LATENCY_MIN_FREE);

  const records = (await readFile(out, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as RunResult);
  expect(records.map((r) => [r.run, r.ok, r.created, r.outOfStock, r.other, r.orders])).toEqual([
    [1, true, 3, 17, 0, 3],
    [2, true, 3, 17, 0, 3],
  ]);
  expect(new Set(records.map((r) => r.runTag)).size).toBe(1);
});

test('a second invocation continues the numbering, reuses the products, needs no top-up and appends to the same file', async () => {
  await setEnvIdentity(db.owner, 'nonprod:poc');
  const out = path.join(dir, 'proof.jsonl');
  const fetcher = apiFetch(db.app);
  await runConcurrencyProof(args({ runs: 1, out }), deps(fetcher, []));
  const lines: string[] = [];
  const summary = await runConcurrencyProof(args({ runs: 1, start: 2, out }), deps(fetcher, lines));

  expect(summary).toMatchObject({ passed: 1, failed: 0 });
  expect(lines[0]).not.toMatch(/topped up/);
  expect(lines[1]).toMatch(/^run 2\/2: 201=3 409=17/);
  expect(await count(`select count(*)::int as n from products where slug in ('poc-concurrency', 'poc-latency')`)).toBe(2);
  const records = (await readFile(out, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as RunResult);
  expect(records.map((r) => r.run)).toEqual([1, 2]);
  expect(new Set(records.map((r) => r.runTag)).size).toBe(2);
});

test('a target that fails some checkouts fails the run, naming each failure, and the next run still runs', async () => {
  await setEnvIdentity(db.owner, 'nonprod:poc');
  const real = apiFetch(db.app);
  let checkouts = 0;
  const flaky: typeof fetch = async (input, init) => {
    if (new Request(input, init).url.endsWith('/api/checkout') && ++checkouts <= 2) {
      return checkouts === 1 ? new Response('{"error":"too many connections"}', { status: 503 }) : Promise.reject(new TypeError('fetch failed'));
    }
    return real(input, init);
  };
  const lines: string[] = [];
  const summary = await runConcurrencyProof(args(), deps(flaky, lines));

  expect(summary).toMatchObject({ passed: 1, failed: 1 });
  // A body with no JSON content type is named with its content type.
  expect(lines).toContain('  1 x status 503: [text/plain;charset=UTF-8] {"error":"too many connections"}');
  expect(lines).toContain('  1 x no response: TypeError: fetch failed');
  expect(lines.find((l) => l.startsWith('run 1/2:'))).toMatch(/other=2/);
  expect(lines.find((l) => l.startsWith('run 2/2:'))).toMatch(/201=3 409=17 other=0/);
});

test.each([
  ['no identity', null],
  ['staging', 'nonprod:staging'],
  ['a preview', 'nonprod:preview/pr-7'],
  ['production', 'production'],
])('refuses to start on a database that is %s, before writing anything', async (_name, identity) => {
  if (identity !== null) await setEnvIdentity(db.owner, identity);
  const fetcher: typeof fetch = () => Promise.reject(new Error('no request may be sent'));
  await expect(runConcurrencyProof(args(), deps(fetcher, []))).rejects.toThrow(/refusing to run: .* not nonprod:poc/);
  expect(await count(`select count(*)::int as n from products where slug like 'poc-%'`)).toBe(0);
});

describe("through the container's real front door (withPocAuth)", () => {
  const ORIGIN = 'https://dose-web-poc.example.workers.dev';
  const guardedFetch = (): typeof fetch => {
    const guarded = withPocAuth(commerceApi(db.app), { token: TOKEN, allowedOrigin: ORIGIN });
    return async (input, init) => guarded.fetch(new Request(input, init));
  };

  test("the runner's bearer header gets every request through, and the run passes", async () => {
    await setEnvIdentity(db.owner, 'nonprod:poc');
    const summary = await runConcurrencyProof(args({ runs: 1 }), deps(guardedFetch(), []));
    expect(summary).toMatchObject({ passed: 1, failed: 0 });
  });

  test('a wrong token fails the run on its 401, and no order is placed', async () => {
    await setEnvIdentity(db.owner, 'nonprod:poc');
    const lines: string[] = [];
    const summary = await runConcurrencyProof(args({ runs: 1 }), deps(guardedFetch(), lines, { authorization: 'Bearer wrong-token' }));
    expect(summary).toMatchObject({ passed: 0, failed: 1 });
    expect(lines).toContain('  GET /api/products/poc-concurrency: status 401: {"error":"unauthorized"}');
    expect(await count(`select count(*)::int as n from orders`)).toBe(0);
  });
});

describe("answers that are not the API's (Cloudflare Access in the way)", () => {
  const LOGIN = 'https://dose.cloudflareaccess.com/cdn-cgi/access/login/dose-web-poc.example.workers.dev';
  const loginRedirect = () => new Response(null, { status: 302, headers: { location: LOGIN } });
  const loginPage = () => new Response('<!doctype html>\n<title>Sign in</title>', { status: 200, headers: { 'content-type': 'text/html' } });

  test('a redirect to the Access login is recorded as a failed run, never followed and never a crash', async () => {
    await setEnvIdentity(db.owner, 'nonprod:poc');
    const lines: string[] = [];
    const summary = await runConcurrencyProof(args(), deps(() => Promise.resolve(loginRedirect()), lines));
    expect(summary).toMatchObject({ passed: 0, failed: 2 });
    expect(lines).toContain('  GET /api/products/poc-concurrency: status 302: [no content-type] (empty body)');
    expect(summary.failures).toHaveLength(1);
  });

  test('an HTML page with status 200 instead of the product fails the run, naming its content type', async () => {
    await setEnvIdentity(db.owner, 'nonprod:poc');
    const lines: string[] = [];
    const summary = await runConcurrencyProof(args({ runs: 1 }), deps(() => Promise.resolve(loginPage()), lines));
    expect(summary).toMatchObject({ passed: 0, failed: 1 });
    expect(lines).toContain(
      '  GET /api/products/poc-concurrency: status 200 but not the product as JSON: [text/html] <!doctype html> <title>Sign in</title>',
    );
  });

  test('checkouts answered by the login page count as other answers, with status and content type', async () => {
    await setEnvIdentity(db.owner, 'nonprod:poc');
    const real = apiFetch(db.app);
    const bounced: typeof fetch = (input, init) =>
      new Request(input, init).url.endsWith('/api/checkout') ? Promise.resolve(loginPage()) : real(input, init);
    const lines: string[] = [];
    const summary = await runConcurrencyProof(args({ runs: 1 }), deps(bounced, lines));
    expect(summary).toMatchObject({ passed: 0, failed: 1 });
    expect(lines).toContain('  20 x status 200: [text/html] <!doctype html> <title>Sign in</title>');
  });
});

test('refuses to start while another invocation holds the runner lock, and runs once it is released', async () => {
  await setEnvIdentity(db.owner, 'nonprod:poc');
  const other = createRequestDb(db.ownerUrl);
  try {
    await other.query(`select pg_advisory_lock($1)`, [RUNNER_LOCK_KEY]);
    const fetcher: typeof fetch = () => Promise.reject(new Error('no request may be sent'));
    await expect(runConcurrencyProof(args(), deps(fetcher, []))).rejects.toThrow(/another pnpm poc:concurrency is running/);
    expect(await count(`select count(*)::int as n from products where slug like 'poc-%'`)).toBe(0);
    await other.query(`select pg_advisory_unlock($1)`, [RUNNER_LOCK_KEY]);
  } finally {
    await other.close();
  }
  const summary = await runConcurrencyProof(args({ runs: 1 }), deps(apiFetch(db.app), []));
  expect(summary).toMatchObject({ passed: 1, failed: 0 });
  // It let go of the lock when it finished.
  const [row] = await db.owner.query<{ held: boolean }>(`select pg_try_advisory_lock($1) as held`, [RUNNER_LOCK_KEY]);
  expect(row?.held).toBe(true);
});
