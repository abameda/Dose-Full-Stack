import { createApp } from '@dose/api';
import type { Staff } from '@dose/contract';
import type { Db } from '@dose/core/db';
import { expect, test, vi } from 'vitest';
import { handleDiag, type DiagDeps } from '../src/diag';

const STAFF: Staff = { id: 'staff-1', email: 'owner@example.test', name: 'Owner', role: 'owner' };
const PRIVATE = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' };
const IDENTITY_PATH = '/api/_diag/db-identity';
const RYW_PATH = '/api/_diag/read-your-writes';

const TRACE = 'fl=1\nh=cloudflare.com\nip=203.0.113.1\ncolo=FRA\nhttp=http/2\n';

/**
 * A database holding `diag_writes` and `env_identity`. Reads of `max(id)` return the newest write
 * minus `lag` (0: the read sees the write; 1: it is one write behind, as a stale cache would be).
 */
function fakeDb(o: { identity?: string; lag?: number } = {}) {
  let last = 100;
  const close = vi.fn(() => Promise.resolve());
  const db: Db = {
    query<R>(sql: string) {
      if (/insert into diag_writes/.test(sql)) return Promise.resolve([{ id: String(++last) }] as R[]);
      if (/max\(id\)/.test(sql)) return Promise.resolve([{ id: String(last - (o.lag ?? 0)) }] as R[]);
      if (/from env_identity/.test(sql)) return Promise.resolve((o.identity === undefined ? [] : [{ name: o.identity }]) as R[]);
      return Promise.reject(new Error(`unexpected query: ${sql}`));
    },
    transaction: () => Promise.reject(new Error('the diagnostics never open a transaction')),
    close,
  };
  return { db, close };
}

function deps(o: Partial<Omit<DiagDeps, 'db'>> & { db?: Db } = {}) {
  const { db, ...rest } = o;
  const database = db ?? fakeDb().db;
  const dbFactory = vi.fn(() => database);
  const verifyStaff = vi.fn(() => Promise.resolve<Staff | null>(STAFF));
  const fetcher = vi.fn(() => Promise.resolve(new Response(TRACE)));
  const all: DiagDeps = { environment: 'staging', verifyStaff, db: dbFactory, fetch: fetcher, ...rest };
  return { deps: all, dbFactory, verifyStaff, fetcher };
}

const get = (path: string, init?: RequestInit) => new Request(`http://dose.test${path}`, init);

function expectPrivate(response: Response | null) {
  expect(response).not.toBeNull();
  expect(Object.fromEntries(response?.headers ?? [])).toMatchObject(PRIVATE);
}

test.each([IDENTITY_PATH, RYW_PATH])('%s goes to the commerce API in production, before anyone is asked who they are', async (path) => {
  const { deps: d, verifyStaff, dbFactory } = deps({ environment: 'production' });
  expect(await handleDiag(get(path), d)).toBeNull();
  expect(verifyStaff).not.toHaveBeenCalled();
  expect(dbFactory).not.toHaveBeenCalled();
});

test('in production the commerce API answers the diagnostic paths exactly as any unknown /api path', async () => {
  const app = createApp({
    db: () => fakeDb().db,
    env: 'production',
    now: () => new Date(),
    verifyStaff: () => Promise.resolve(STAFF),
    webhookProviders: {},
  });
  const answer = async (path: string) => {
    const response = await app.fetch(get(path));
    return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
  };
  const unknown = await answer('/api/no-such-path');
  expect(unknown).toEqual({ status: 404, headers: expect.anything() as unknown, body: '{"error":"not_found"}' });
  expect(await answer(IDENTITY_PATH)).toEqual(unknown);
  expect(await answer(RYW_PATH)).toEqual(unknown);
});

test.each([IDENTITY_PATH, RYW_PATH])('%s is a 401 for anyone but active staff, private, and opens no database', async (path) => {
  const { deps: d, dbFactory } = deps({ verifyStaff: () => Promise.resolve(null) });
  const response = await handleDiag(get(path), d);
  expect(response?.status).toBe(401);
  expectPrivate(response);
  expect(dbFactory).not.toHaveBeenCalled();
});

test('a verifier that fails is a private 500, not a pass', async () => {
  const { deps: d } = deps({ verifyStaff: () => Promise.reject(new Error('database down')) });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const response = await handleDiag(get(IDENTITY_PATH), d);
  expect(response?.status).toBe(500);
  expectPrivate(response);
  expect(await response?.text()).not.toMatch(/database down/);
});

test('db-identity returns the name in env_identity, as JSON, private, and closes the database', async () => {
  const fake = fakeDb({ identity: 'nonprod:staging' });
  const { deps: d, dbFactory } = deps({ db: fake.db });
  const response = await handleDiag(get(IDENTITY_PATH), d);
  expect(response?.status).toBe(200);
  expect(response?.headers.get('content-type')).toBe('application/json');
  expectPrivate(response);
  expect(await response?.json()).toEqual({ identity: 'nonprod:staging' });
  expect(dbFactory).toHaveBeenCalledOnce();
  expect(fake.close).toHaveBeenCalledOnce();
});

test('db-identity is null when the database has no identity', async () => {
  const { deps: d } = deps({ db: fakeDb().db });
  expect(await (await handleDiag(get(IDENTITY_PATH), d))?.json()).toEqual({ identity: null });
});

test('a database failure is a private 500 and the database is still closed', async () => {
  const fake = fakeDb();
  fake.db.query = () => Promise.reject(new Error('connection refused'));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const response = await handleDiag(get(IDENTITY_PATH), deps({ db: fake.db }).deps);
  expect(response?.status).toBe(500);
  expectPrivate(response);
  expect(fake.close).toHaveBeenCalledOnce();
});

test('read-your-writes is consistent when every read sees its write', async () => {
  const fake = fakeDb();
  const { deps: d, fetcher, dbFactory } = deps({ db: fake.db });
  const request = get(RYW_PATH);
  Object.defineProperty(request, 'cf', { value: { colo: 'CAI' } });
  const response = await handleDiag(request, d);
  expect(response?.status).toBe(200);
  expect(response?.headers.get('content-type')).toBe('application/json');
  expectPrivate(response);
  expect(await response?.json()).toEqual({ consistent: true, iterations: 20, stale: 0, colo: 'CAI', placement: 'FRA' });
  expect(fetcher).toHaveBeenCalledWith('https://cloudflare.com/cdn-cgi/trace', expect.anything());
  expect(dbFactory).toHaveBeenCalledOnce();
  expect(fake.close).toHaveBeenCalledOnce();
});

test('read-your-writes writes, then runs exactly the same parameterless read, twenty times', async () => {
  const fake = fakeDb();
  const calls: { sql: string; params: unknown[] | undefined }[] = [];
  const query = fake.db.query.bind(fake.db);
  fake.db.query = (sql, params) => {
    calls.push({ sql, params });
    return query(sql, params);
  };
  await handleDiag(get(RYW_PATH), deps({ db: fake.db }).deps);
  const reads = calls.filter((c) => /max\(id\)/.test(c.sql));
  const writes = calls.filter((c) => /insert into diag_writes/.test(c.sql));
  expect(reads).toHaveLength(20);
  expect(writes).toHaveLength(20);
  expect(new Set(reads.map((c) => c.sql)).size).toBe(1);
  expect(reads.every((c) => c.params === undefined)).toBe(true);
  expect(new Set(writes.map((c) => String(c.params?.[0]))).size).toBe(20); // a fresh token per write
  expect(calls.map((c) => (/insert/.test(c.sql) ? 'w' : 'r')).join('')).toBe('wr'.repeat(20));
});

test('read-your-writes counts the reads that returned an older id', async () => {
  const response = await handleDiag(get(RYW_PATH), deps({ db: fakeDb({ lag: 1 }).db }).deps);
  expect(await response?.json()).toMatchObject({ consistent: false, iterations: 20, stale: 20 });
});

test('the colo is null where Cloudflare provides none', async () => {
  const response = await handleDiag(get(RYW_PATH), deps({ db: fakeDb().db }).deps);
  expect(await response?.json()).toMatchObject({ colo: null });
});

test.each([
  ['the fetch fails', () => Promise.reject(new Error('offline'))],
  ['the trace is an error page', () => Promise.resolve(new Response('nope', { status: 503 }))],
  ['the trace has no colo line', () => Promise.resolve(new Response('fl=1\nh=cloudflare.com\n'))],
])('placement is null, and the route still answers, when %s', async (_name, fetcher) => {
  const { deps: d } = deps({ db: fakeDb().db, fetch: fetcher as unknown as typeof fetch });
  const response = await handleDiag(get(RYW_PATH), d);
  expect(response?.status).toBe(200);
  expect(await response?.json()).toMatchObject({ consistent: true, placement: null });
});

test.each([
  ['another API path', '/api/products'],
  ['the admin API', '/api/admin/me'],
  ['the diag folder itself', '/api/_diag'],
  ['the diag folder with a slash', '/api/_diag/'],
  ['an unknown diagnostic', '/api/_diag/other'],
  ['a longer path', `${IDENTITY_PATH}/extra`],
  ['a trailing slash', `${IDENTITY_PATH}/`],
  ['another case', '/api/_DIAG/db-identity'],
])('%s is not handled by diag', async (_name, path) => {
  const { deps: d, verifyStaff } = deps();
  expect(await handleDiag(get(path), d)).toBeNull();
  expect(verifyStaff).not.toHaveBeenCalled();
});

test.each(['POST', 'PUT', 'DELETE', 'PATCH'])('%s to a diagnostic path is not handled by diag', async (method) => {
  const { deps: d, verifyStaff } = deps();
  expect(await handleDiag(get(IDENTITY_PATH, { method }), d)).toBeNull();
  expect(verifyStaff).not.toHaveBeenCalled();
});
