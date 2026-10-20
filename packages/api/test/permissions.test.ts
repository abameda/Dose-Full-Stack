import { ROLES, type Role, type Staff } from '@dose/contract';
import { withTestDb } from '@dose/core/test-harness';
import { beforeAll, describe, expect, test } from 'vitest';
import { ADMIN_ROUTES } from '../src/permissions';
import { makeTestApp } from './support';

// Who is asking comes from a test header here; auth.test.ts covers how Access proves it.
const ROLE_HEADER = 'x-test-role';

function staffWithRole(role: Role): Staff {
  return { id: `00000000-0000-4000-8000-00000000000${String(ROLES.indexOf(role))}`, email: `${role}@example.test`, name: `Test ${role}`, role };
}

let app: ReturnType<typeof makeTestApp>;

beforeAll(async () => {
  const db = await withTestDb();
  app = makeTestApp(db, {
    verifyStaff: (req) => {
      const role = ROLES.find((r) => r === req.headers.get(ROLE_HEADER));
      return Promise.resolve(role === undefined ? null : staffWithRole(role));
    },
  });
});

/** A request for `route` with every path parameter filled in, as `role` (or as nobody). */
function requestFor(route: (typeof ADMIN_ROUTES)[number], role?: Role): Request {
  const path = route.path.replace(/:[a-zA-Z]+/g, 'D99999');
  const headers: Record<string, string> = role === undefined ? {} : { [ROLE_HEADER]: role };
  if (route.method === 'GET') return new Request(`http://dose.test${path}`, { headers });
  return new Request(`http://dose.test${path}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: '{}',
  });
}

test('the matrix is decision 0002: owner all, operations reads and acts, accountant reads, marketing only itself', () => {
  const readers = ['owner', 'operations', 'accountant'];
  const actors = ['owner', 'operations'];
  expect(ADMIN_ROUTES.map((r) => [r.method, r.path, [...r.allow].sort()])).toEqual([
    ['GET', '/api/admin/me', [...ROLES].sort()],
    ['GET', '/api/admin/today', readers.sort()],
    ['GET', '/api/admin/orders', readers.sort()],
    ['GET', '/api/admin/orders/:number', readers.sort()],
    ['POST', '/api/admin/orders/:number/confirm', actors.sort()],
    ['POST', '/api/admin/orders/:number/cancel', actors.sort()],
    ['GET', '/api/admin/audit', ['owner']],
  ]);
});

describe.each(ADMIN_ROUTES.map((route) => [`${route.method} ${route.path}`, route] as const))('%s', (_name, route) => {
  test.each(ROLES)('as %s', async (role) => {
    const res = await app.request(requestFor(route, role));
    if ((route.allow as readonly Role[]).includes(role)) expect(res.status).not.toBe(403);
    else expect(res.status).toBe(403);
    expect(res.status).not.toBe(401);
  });

  test('without staff is 401', async () => {
    const res = await app.request(requestFor(route));
    expect(res.status).toBe(401);
  });
});

test('every admin route registered on the app is in ADMIN_ROUTES, and every entry is registered', () => {
  const registered = app.routes
    .filter((r) => r.path.startsWith('/api/admin') && r.method !== 'ALL')
    .map((r) => `${r.method} ${r.path}`);
  const declared = ADMIN_ROUTES.map((r) => `${r.method} ${r.path}`);
  const missing = registered.filter((key) => !declared.includes(key));
  expect(missing, 'admin routes registered without an entry in ADMIN_ROUTES').toEqual([]);
  expect([...new Set(registered)].sort()).toEqual([...declared].sort());
});

test('an admin path not in ADMIN_ROUTES is 401 without staff and 404 with it, never served', async () => {
  expect((await app.request('/api/admin/secret')).status).toBe(401);
  expect((await app.request('/api/admin/secret', { headers: { [ROLE_HEADER]: 'owner' } })).status).toBe(404);
  // A known path with the wrong method is not a route either.
  expect((await app.request('/api/admin/today', { method: 'POST', headers: { [ROLE_HEADER]: 'owner' } })).status).toBe(404);
});

test('admin responses are private and not indexed, refusals included', async () => {
  for (const headers of [{}, { [ROLE_HEADER]: 'marketing' }, { [ROLE_HEADER]: 'owner' }]) {
    const res = await app.request('/api/admin/today', { headers });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  }
});
