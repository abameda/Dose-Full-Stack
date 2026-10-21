import type { Staff } from '@dose/contract';
import { expect, test, vi } from 'vitest';
import { guardStaffArea, isStaffAreaPath, withPrivateHeaders } from '../src/staff-guard';

const OWNER: Staff = { id: 'staff-1', email: 'owner@example.test', name: 'Owner', role: 'owner' };
const request = (path = '/studio/en/products/paradise') => new Request(`http://x${path}`);

const PRIVATE = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' };

test('no staff member is a 401, private and not indexed', async () => {
  const response = await guardStaffArea(request(), () => Promise.resolve(null));
  expect(response?.status).toBe(401);
  expect(Object.fromEntries(response?.headers ?? [])).toMatchObject(PRIVATE);
});

test('the admin is guarded the same way', async () => {
  const refused = await guardStaffArea(request('/admin/orders/D10001'), () => Promise.resolve(null));
  expect(refused?.status).toBe(401);
  expect(Object.fromEntries(refused?.headers ?? [])).toMatchObject(PRIVATE);
  expect(await guardStaffArea(request('/admin'), () => Promise.resolve(OWNER))).toBeNull();
});

test('the poc pages are guarded the same way', async () => {
  const refused = await guardStaffArea(request('/poc/latency'), () => Promise.resolve(null));
  expect(refused?.status).toBe(401);
  expect(Object.fromEntries(refused?.headers ?? [])).toMatchObject(PRIVATE);
  expect(await guardStaffArea(request('/poc/latency'), () => Promise.resolve(OWNER))).toBeNull();
});

test('the refusal names neither the studio, the admin nor the poc pages', async () => {
  for (const path of ['/admin', '/poc/latency']) {
    const refused = await guardStaffArea(request(path), () => Promise.resolve(null));
    expect(await refused?.text()).not.toMatch(/studio|admin|poc|latency|paradise|blanc/i);
  }
});

test('an active staff member continues (null), whatever their role', async () => {
  for (const role of ['owner', 'operations', 'marketing', 'accountant'] as const) {
    expect(await guardStaffArea(request(), () => Promise.resolve({ ...OWNER, role }))).toBeNull();
  }
});

test('the verifier sees the request that was guarded', async () => {
  const req = request();
  const verify = vi.fn(() => Promise.resolve(OWNER));
  await guardStaffArea(req, verify);
  expect(verify).toHaveBeenCalledExactlyOnceWith(req);
});

test('a verifier that fails is not swallowed into a pass', async () => {
  await expect(guardStaffArea(request(), () => Promise.reject(new Error('database down')))).rejects.toThrow('database down');
});

test('withPrivateHeaders adds the cache and robots headers and keeps status, body and other headers', async () => {
  const page = new Response('<p>hi</p>', { status: 404, headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=60' } });
  const marked = withPrivateHeaders(page);
  expect(marked.status).toBe(404);
  expect(await marked.text()).toBe('<p>hi</p>');
  expect(marked.headers.get('content-type')).toBe('text/html');
  expect(Object.fromEntries(marked.headers)).toMatchObject(PRIVATE);
});

test('withPrivateHeaders works on a response whose headers are frozen', () => {
  const frozen = Response.redirect('http://x/studio/en', 302);
  expect(Object.fromEntries(withPrivateHeaders(frozen).headers)).toMatchObject(PRIVATE);
});

test.each([
  ['/studio', true],
  ['/studio/', true],
  ['/studio/en/products/paradise', true],
  ['/Studio/en', true],
  ['/%73tudio/en', true],
  ['/%53TUDIO/en', true],
  ['/%2573tudio/en', true],
  ['/%252573tudio/en', true],
  ['//studio/en', true],
  ['/studio%2Fen', true],
  ['/studio%5Cen', true],
  ['/./studio/en', true],
  ['/en/../studio/en', true],
  ['/%zz', true],
  ['/en/products/100%', true],
  ['/%25%25%25%25%25%25%25%25%25%25%25%2573tudio', true],
  ['/admin', true],
  ['/admin/', true],
  ['/admin/orders/D10001', true],
  ['/Admin/audit', true],
  ['/%61dmin/audit', true],
  ['/%2561dmin/audit', true],
  ['//admin/audit', true],
  ['/admin%2Faudit', true],
  ['/./admin/audit', true],
  ['/en/../admin', true],
  ['/poc', true],
  ['/poc/', true],
  ['/poc/latency', true],
  ['/POC/latency', true],
  ['/%70oc/latency', true],
  ['/%2570oc/latency', true],
  ['//poc/latency', true],
  ['/poc%2Flatency', true],
  ['/./poc/latency', true],
  ['/en/../poc/latency', true],
  ['/administrator', false],
  ['/pocket', false],
  ['/pocs/latency', false],
  ['/en/poc/latency', false],
  ['/api/poc', false],
  ['/en/products/poc-latency', false],
  ['/admins/en', false],
  ['/api/admin/me', false],
  ['/en/admin', false],
  ['/studios%2Fen', false],
  ['/en/%73tudio', false],
  ['/en/products/%70aradise', false],
  ['/studios/en', false],
  ['/en/studio', false],
  ['/en/products/paradise', false],
  ['/api/checkout', false],
  ['/', false],
] as const)('isStaffAreaPath(%s) is %s', (path, expected) => {
  expect(isStaffAreaPath(path)).toBe(expected);
});
