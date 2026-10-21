import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { MIN_TOKEN_LENGTH, pocAuthFromEnv, withPocAuth } from '../src/poc-auth';

const TOKEN = 'a'.repeat(MIN_TOKEN_LENGTH) + '-test-token';
const ORIGIN = 'https://dose-web-poc.example-sub.workers.dev';

/** A stand-in for the commerce API: answers whatever reaches it, and says what it saw. */
function innerApp() {
  const seen: string[] = [];
  const app = new Hono();
  app.get('/api/products', (c) => {
    seen.push(`GET ${c.req.path}`);
    return c.json([{ slug: 'paradise' }], 200, { Vary: 'Accept-Encoding' });
  });
  app.post('/api/checkout', async (c) => {
    seen.push(`POST ${c.req.path} ${JSON.stringify(await c.req.json())}`);
    return c.json({ ok: true }, 201);
  });
  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  return { app, seen };
}

function guarded() {
  const inner = innerApp();
  return { app: withPocAuth(inner.app, { token: TOKEN, allowedOrigin: ORIGIN }), seen: inner.seen };
}

const bearer = (token = TOKEN) => ({ authorization: `Bearer ${token}` });

describe('the bearer token', () => {
  test('with the token, the request reaches the app and its answer comes back unchanged', async () => {
    const { app, seen } = guarded();
    const response = await app.request('/api/products?lang=en', { headers: bearer() });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ slug: 'paradise' }]);
    expect(seen).toEqual(['GET /api/products']);
  });

  test('a request body reaches the app', async () => {
    const { app, seen } = guarded();
    const response = await app.request('/api/checkout', {
      method: 'POST',
      headers: { ...bearer(), 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    expect(response.status).toBe(201);
    expect(seen).toEqual(['POST /api/checkout {"hello":"world"}']);
  });

  test.each([
    ['no Authorization header', {}],
    ['an empty header', { authorization: '' }],
    ['the token without the Bearer scheme', { authorization: TOKEN }],
    ['another scheme', { authorization: `Basic ${TOKEN}` }],
    ['a lower-case scheme', { authorization: `bearer ${TOKEN}` }],
    ['a wrong token of the same length', bearer('b'.repeat(TOKEN.length))],
    ['a prefix of the token', bearer(TOKEN.slice(0, -1))],
    ['the token with more after it', bearer(`${TOKEN}x`)],
    ['two spaces after the scheme', bearer(` ${TOKEN}`)],
    ['an empty token', bearer('')],
  ])('%s is a 401 that says nothing more, and the app is never reached', async (_name, headers: Record<string, string>) => {
    const { app, seen } = guarded();
    const response = await app.request('/api/products?lang=en', { headers });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(seen).toEqual([]);
  });

  test('an unknown path is a 401 without the token, so a prober learns nothing', async () => {
    const { app } = guarded();
    expect((await app.request('/no-such-path')).status).toBe(401);
    expect((await app.request('/no-such-path', { headers: bearer() })).status).toBe(404);
  });

  test('an OPTIONS request that is not a preflight needs the token too', async () => {
    const { app } = guarded();
    expect((await app.request('/api/products', { method: 'OPTIONS', headers: { origin: ORIGIN } })).status).toBe(401);
  });
});

describe('CORS', () => {
  const preflight = (origin: string | undefined) =>
    new Request('http://container.test/api/checkout', {
      method: 'OPTIONS',
      headers: {
        ...(origin === undefined ? {} : { origin }),
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type',
      },
    });

  test('a preflight from the allowed origin is a 204 allowing POST and GET with the two headers, for 600 s, with no token', async () => {
    const { app, seen } = guarded();
    const response = await app.request(preflight(ORIGIN));
    expect(response.status).toBe(204);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'access-control-allow-origin': ORIGIN,
      'access-control-allow-methods': 'POST, GET',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '600',
      vary: 'Origin',
    });
    expect(response.headers.has('access-control-allow-credentials')).toBe(false);
    expect(seen).toEqual([]);
  });

  test.each([
    ['another origin', 'https://evil.example'],
    ['the origin with a trailing slash', `${ORIGIN}/`],
    ['the origin over http', ORIGIN.replace('https:', 'http:')],
    ['a look-alike subdomain', 'https://dose-web-poc.example-sub.workers.dev.evil.example'],
    ['the null origin', 'null'],
    ['no origin', undefined],
  ])('a preflight from %s is a 403 without any CORS grant', async (_name, origin) => {
    const { app } = guarded();
    const response = await app.request(preflight(origin));
    expect(response.status).toBe(403);
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
    expect(response.headers.has('access-control-allow-methods')).toBe(false);
  });

  test('an answer to the allowed origin names it, and adds Origin to Vary', async () => {
    const { app } = guarded();
    const response = await app.request('/api/products?lang=en', { headers: { ...bearer(), origin: ORIGIN } });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(response.headers.get('vary')).toBe('Accept-Encoding, Origin');
    expect(response.headers.has('access-control-allow-credentials')).toBe(false);
  });

  test('a 401 to the allowed origin names it too, so the page can read the refusal', async () => {
    const { app } = guarded();
    const response = await app.request('/api/products?lang=en', { headers: { origin: ORIGIN } });
    expect(response.status).toBe(401);
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });

  test('an answer to any other origin, or to no origin, grants nothing', async () => {
    const { app } = guarded();
    for (const headers of [{ ...bearer(), origin: 'https://evil.example' }, bearer()]) {
      const response = await app.request('/api/products?lang=en', { headers });
      expect(response.status).toBe(200);
      expect(response.headers.has('access-control-allow-origin')).toBe(false);
    }
  });
});

describe('pocAuthFromEnv', () => {
  const vars = { POC_TOKEN: TOKEN, POC_ALLOWED_ORIGIN: ORIGIN };

  test('local needs neither, and the container runs unguarded as before', () => {
    expect(pocAuthFromEnv('local', {})).toBeNull();
  });

  test.each(['staging', 'production', 'test', 'preview'])('%s gets the token and the origin', (env) => {
    expect(pocAuthFromEnv(env, vars)).toEqual({ token: TOKEN, allowedOrigin: ORIGIN });
  });

  test.each([
    ['POC_TOKEN missing', { POC_ALLOWED_ORIGIN: ORIGIN }, /POC_TOKEN/],
    ['POC_TOKEN too short', { ...vars, POC_TOKEN: 'x'.repeat(MIN_TOKEN_LENGTH - 1) }, /POC_TOKEN/],
    ['POC_ALLOWED_ORIGIN missing', { POC_TOKEN: TOKEN }, /POC_ALLOWED_ORIGIN/],
    ['POC_ALLOWED_ORIGIN not a URL', { ...vars, POC_ALLOWED_ORIGIN: 'not-an-origin' }, /POC_ALLOWED_ORIGIN/],
    ['POC_ALLOWED_ORIGIN with a path', { ...vars, POC_ALLOWED_ORIGIN: `${ORIGIN}/poc/latency` }, /POC_ALLOWED_ORIGIN/],
    ['POC_ALLOWED_ORIGIN with a trailing slash', { ...vars, POC_ALLOWED_ORIGIN: `${ORIGIN}/` }, /POC_ALLOWED_ORIGIN/],
  ])('%s fails at start, naming the variable and never its value', (_name, env: Record<string, string>, message) => {
    let error: unknown;
    try {
      pocAuthFromEnv('staging', env);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    const text = (error as Error).message;
    expect(text).toMatch(message);
    for (const value of Object.values(env)) expect(text).not.toContain(value);
  });
});
