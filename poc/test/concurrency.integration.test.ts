import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '@dose/api';
import type { Db } from '@dose/core/db';
import { setEnvIdentity } from '@dose/core/env-identity';
import { checkRules } from '@dose/core/rules';
import { withTestDb, type TestDb } from '@dose/core/test-harness';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { LATENCY_MIN_FREE, runConcurrencyProof, type RunnerArgs, type RunnerDeps, type RunResult } from '../runner';

// The runner against the real commerce API (createApp, in process) over a migrated test database,
// with the app's requests going through an injected fetch instead of the network.

const TARGET = 'http://poc.test';
const TOKEN_HEADERS = { authorization: 'Bearer test-token' };

let db: TestDb;
let dir: string;

beforeEach(async () => {
  db = await withTestDb();
  dir = await mkdtemp(path.join(tmpdir(), 'dose-poc-'));
});

afterEach(async () => {
  await db.drop();
  await rm(dir, { recursive: true, force: true });
});

/** The commerce API as the target: the shared test pool, never closed per request. */
function apiFetch(app: Db, seen: Headers[] = []): typeof fetch {
  const api = createApp({
    db: () => ({ ...app, close: () => Promise.resolve() }),
    env: 'test',
    now: () => new Date(),
    verifyStaff: () => Promise.resolve(null),
    webhookProviders: {},
  });
  return async (input, init) => {
    const request = new Request(input, init);
    seen.push(request.headers);
    return api.fetch(request);
  };
}

function deps(fetcher: typeof fetch, lines: string[]): RunnerDeps {
  return { owner: db.owner, fetch: fetcher, headers: TOKEN_HEADERS, log: (line) => lines.push(line) };
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
  const seen: Headers[] = [];
  const out = path.join(dir, 'proof.jsonl');

  const summary = await runConcurrencyProof(args({ out }), deps(apiFetch(db.app, seen), lines));

  expect(summary).toMatchObject({ passed: 2, failed: 0, failures: [] });
  expect(lines[0]).toMatch(/^poc:concurrency \S+: http:\/\/poc\.test \(bearer\), 2 run\(s\) of 20 checkouts for 3 units; POC-LATENCY topped up by 10000$/);
  expect(lines[1]).toMatch(/^run 1\/2: 201=3 409=17 other=0 orders=3 rules=ok in \d+\.\d s$/);
  expect(lines[2]).toMatch(/^run 2\/2: 201=3 409=17 other=0 orders=3 rules=ok in \d+\.\d s$/);
  expect(lines[3]).toMatch(/^summary: 2 run\(s\), 2 passed, 0 failed, in /);

  // Every request carried the target's front-door header.
  expect(seen.length).toBe(2 * (1 + 20));
  expect(seen.every((h) => h.get('authorization') === 'Bearer test-token')).toBe(true);

  // The database agrees: 6 orders of POC-CONCURRENCY, from 40 distinct test phones, and each run
  // started from exactly 3 free units, with one adjustment per run.
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
  expect(lines).toContain('  1 x status 503: {"error":"too many connections"}');
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
