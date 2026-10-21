// The container's own front door for the proof of concept (Milestone 1, Task 19): nothing like
// Cloudflare Access sits in front of it on Fly.io, so every request carries a bearer token, and
// only the poc Worker's latency page (one origin) may call it from a browser. Destroyed with the
// container after Gate 1.
import { timingSafeEqual } from 'node:crypto';
import { Hono, type MiddlewareHandler } from 'hono';

export interface PocAuthOptions {
  /** The shared secret; requests carry `Authorization: Bearer <token>`. */
  token: string;
  /** The one browser origin allowed to call the container (the poc Worker's), e.g. `https://dose-web-poc.<sub>.workers.dev`. */
  allowedOrigin: string;
}

/** The shortest `POC_TOKEN` the container accepts (e.g. `openssl rand -hex 32` gives 64). */
export const MIN_TOKEN_LENGTH = 32;

const BEARER = 'Bearer ';

const PREFLIGHT_HEADERS = {
  'Access-Control-Allow-Methods': 'POST, GET',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Max-Age': '600',
} as const;

/** Whether `presented` is the token, in time that does not depend on how much of it matches. */
function tokenMatches(presented: string, token: string): boolean {
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(token, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A CORS preflight: an OPTIONS request that names the method it is asking for. */
function isPreflight(req: Request): boolean {
  return req.method === 'OPTIONS' && req.headers.has('access-control-request-method');
}

/**
 * Every request but a CORS preflight needs the bearer token (else a 401 that says nothing more).
 * A preflight from the allowed origin is a 204 allowing POST and GET with the `authorization` and
 * `content-type` headers, cached for 600 seconds; from any other origin (or none) it is a 403.
 * Responses to the allowed origin carry `Access-Control-Allow-Origin` with that origin; there is no
 * credentials mode (the page sends the token in a header, never a cookie).
 */
export function pocAuth(o: PocAuthOptions): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('origin');
    const allowed = origin !== undefined && origin === o.allowedOrigin;

    if (isPreflight(c.req.raw)) {
      if (!allowed) return c.body(null, 403, { Vary: 'Origin' });
      return c.body(null, 204, { 'Access-Control-Allow-Origin': o.allowedOrigin, Vary: 'Origin', ...PREFLIGHT_HEADERS });
    }

    const cors = allowed ? { 'Access-Control-Allow-Origin': o.allowedOrigin } : {};
    const header = c.req.header('authorization') ?? '';
    if (!header.startsWith(BEARER) || !tokenMatches(header.slice(BEARER.length), o.token)) {
      return c.json({ error: 'unauthorized' }, 401, { Vary: 'Origin', ...cors });
    }

    await next();
    // `c.header` copies a finished response before changing it, so its headers need not be mutable.
    c.header('Vary', 'Origin', { append: true });
    if (allowed) c.header('Access-Control-Allow-Origin', o.allowedOrigin);
  };
}

/** `app` behind `pocAuth`: the middleware sees every request first, and the app answers the rest unchanged. */
export function withPocAuth(app: { fetch: (req: Request) => Response | Promise<Response> }, o: PocAuthOptions): Hono {
  const outer = new Hono();
  outer.use(pocAuth(o));
  outer.all('*', (c) => app.fetch(c.req.raw));
  return outer;
}

/**
 * The proof-of-concept settings from the environment: none for `local` (the container runs as it
 * always has, on 127.0.0.1); otherwise `POC_TOKEN` (at least `MIN_TOKEN_LENGTH` characters) and
 * `POC_ALLOWED_ORIGIN` (an origin: scheme, host and optional port, nothing more) are required.
 * The errors name the variable, never its value.
 */
export function pocAuthFromEnv(environment: string, vars: Record<string, string | undefined>): PocAuthOptions | null {
  if (environment === 'local') return null;
  const token = vars['POC_TOKEN'] ?? '';
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`POC_TOKEN is required outside local, at least ${String(MIN_TOKEN_LENGTH)} characters`);
  }
  const allowedOrigin = vars['POC_ALLOWED_ORIGIN'] ?? '';
  let origin: string | null;
  try {
    origin = new URL(allowedOrigin).origin;
  } catch {
    origin = null;
  }
  if (origin === null || origin === 'null' || origin !== allowedOrigin) {
    throw new Error('POC_ALLOWED_ORIGIN is required outside local: an origin such as https://dose-web-poc.<subdomain>.workers.dev, without a path or trailing slash');
  }
  return { token, allowedOrigin };
}
