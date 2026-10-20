import { expect, test, vi } from 'vitest';
import { AdminApiError, createAdminApi } from '../src/api';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function apiWith(answer: () => Response) {
  const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(answer()));
  return { api: createAdminApi(fetchMock), fetchMock };
}

test('reads go to the admin routes with the search in the query string', async () => {
  const { api, fetchMock } = apiWith(() => json([]));
  await api.orders({ q: '010 1234 5678', state: 'pending' });
  expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/admin/orders?q=010+1234+5678&state=pending');
  await api.orders({});
  expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/admin/orders');
});

test('an order number is encoded into its path, and a 404 is null rather than an error', async () => {
  const { api, fetchMock } = apiWith(() => json({ error: 'not_found' }, 404));
  expect(await api.order('D1/../2')).toBeNull();
  expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/admin/orders/D1%2F..%2F2');
});

test('the audit log is paged by cursor', async () => {
  const { api, fetchMock } = apiWith(() => json({ events: [], nextCursor: null }));
  await api.audit();
  await api.audit('42');
  expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(['/api/admin/audit', '/api/admin/audit?cursor=42']);
});

test('confirm and cancel are JSON posts, and 200, 409, 422 and 404 are answers, not errors', async () => {
  const answers = [
    json({ ok: true, version: 2 }),
    json({ ok: false, code: 'conflict', current: { orderState: 'cancelled', version: 3 } }, 409),
    json({ ok: false, code: 'invalid', fields: ['note'] }, 422),
    json({ ok: false, code: 'not_found' }, 404),
  ];
  const { api, fetchMock } = apiWith(() => answers.shift() ?? json({}, 500));

  expect(await api.confirm('D10001', { expectedVersion: 1, method: 'phone' })).toEqual({ ok: true, version: 2 });
  expect(await api.cancel('D10001', { expectedVersion: 1, reason: 'duplicate' })).toEqual({
    ok: false,
    code: 'conflict',
    current: { orderState: 'cancelled', version: 3 },
  });
  expect(await api.confirm('D10001', { expectedVersion: 1, method: 'phone' })).toEqual({ ok: false, code: 'invalid', fields: ['note'] });
  expect(await api.cancel('D10001', { expectedVersion: 1, reason: 'duplicate' })).toEqual({ ok: false, code: 'not_found' });

  const [path, init] = fetchMock.mock.calls[0] ?? [];
  expect(path).toBe('/api/admin/orders/D10001/confirm');
  expect(init?.method).toBe('POST');
  expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  expect(init?.body).toBe(JSON.stringify({ expectedVersion: 1, method: 'phone' }));
  expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/admin/orders/D10001/cancel');
});

test('401, 403 and server errors are AdminApiErrors that carry the status', async () => {
  for (const status of [401, 403, 500]) {
    const { api } = apiWith(() => json({ error: 'x' }, status));
    await expect(api.today()).rejects.toMatchObject({ name: 'AdminApiError', status });
  }
});

test('an answer that is not JSON is an AdminApiError, not a crash', async () => {
  const { api } = apiWith(() => new Response('<html>Bad gateway</html>', { status: 502 }));
  await expect(api.me()).rejects.toBeInstanceOf(AdminApiError);
  const { api: confirming } = apiWith(() => new Response('<html>ok?</html>', { status: 200 }));
  await expect(confirming.confirm('D10001', { expectedVersion: 1, method: 'phone' })).rejects.toBeInstanceOf(AdminApiError);
});
