import type { Staff } from '@dose/contract';
import { expect, test, vi } from 'vitest';
import { guardStudio, isStudioPath, withStudioHeaders } from '../src/studio-guard';

const OWNER: Staff = { id: 'staff-1', email: 'owner@example.test', name: 'Owner', role: 'owner' };
const request = () => new Request('http://x/studio/en/products/paradise');

const PRIVATE = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' };

test('no staff member is a 401, private and not indexed', async () => {
  const response = await guardStudio(request(), () => Promise.resolve(null));
  expect(response?.status).toBe(401);
  expect(Object.fromEntries(response?.headers ?? [])).toMatchObject(PRIVATE);
});

test('an active staff member continues (null), whatever their role', async () => {
  for (const role of ['owner', 'operations', 'marketing', 'accountant'] as const) {
    expect(await guardStudio(request(), () => Promise.resolve({ ...OWNER, role }))).toBeNull();
  }
});

test('the verifier sees the request that was guarded', async () => {
  const req = request();
  const verify = vi.fn(() => Promise.resolve(OWNER));
  await guardStudio(req, verify);
  expect(verify).toHaveBeenCalledExactlyOnceWith(req);
});

test('a verifier that fails is not swallowed into a pass', async () => {
  await expect(guardStudio(request(), () => Promise.reject(new Error('database down')))).rejects.toThrow('database down');
});

test('withStudioHeaders adds the cache and robots headers and keeps status, body and other headers', async () => {
  const page = new Response('<p>hi</p>', { status: 404, headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=60' } });
  const marked = withStudioHeaders(page);
  expect(marked.status).toBe(404);
  expect(await marked.text()).toBe('<p>hi</p>');
  expect(marked.headers.get('content-type')).toBe('text/html');
  expect(Object.fromEntries(marked.headers)).toMatchObject(PRIVATE);
});

test('withStudioHeaders works on a response whose headers are frozen', () => {
  const frozen = Response.redirect('http://x/studio/en', 302);
  expect(Object.fromEntries(withStudioHeaders(frozen).headers)).toMatchObject(PRIVATE);
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
  ['/studios%2Fen', false],
  ['/en/%73tudio', false],
  ['/en/products/%70aradise', false],
  ['/studios/en', false],
  ['/en/studio', false],
  ['/en/products/paradise', false],
  ['/api/checkout', false],
  ['/', false],
] as const)('isStudioPath(%s) is %s', (path, expected) => {
  expect(isStudioPath(path)).toBe(expected);
});
