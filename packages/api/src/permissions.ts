import { AUDIT_READER_ROLES, ORDER_ACTOR_ROLES, ORDER_READER_ROLES, ROLES, type Role, type Staff } from '@dose/contract';
import type { Db } from '@dose/core/db';
import type { MiddlewareHandler } from 'hono';

export type AdminRoute = { method: 'GET' | 'POST'; path: string; allow: readonly Role[] };

/**
 * Every admin route and the roles that may use it: the single source of truth. `adminGuard`
 * refuses anything not listed here, `adminRoutes` registers exactly these, and
 * permissions.test.ts checks both against the app's route list.
 */
export const ADMIN_ROUTES = [
  { method: 'GET', path: '/api/admin/me', allow: ROLES },
  { method: 'GET', path: '/api/admin/today', allow: ORDER_READER_ROLES },
  { method: 'GET', path: '/api/admin/orders', allow: ORDER_READER_ROLES },
  { method: 'GET', path: '/api/admin/orders/:number', allow: ORDER_READER_ROLES },
  { method: 'POST', path: '/api/admin/orders/:number/confirm', allow: ORDER_ACTOR_ROLES },
  { method: 'POST', path: '/api/admin/orders/:number/cancel', allow: ORDER_ACTOR_ROLES },
  { method: 'GET', path: '/api/admin/audit', allow: AUDIT_READER_ROLES },
] as const satisfies readonly AdminRoute[];

/** Hono's type parameter for the admin routes: the guard puts the signed-in staff member on the context. */
export type AdminEnv = { Variables: { db: Db; staff: Staff } };

/** Studio and admin responses are never cached or indexed (constraints). */
export const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' } as const;

/** Whether `path` fits `pattern`, where a `:name` segment stands for any one non-empty segment. */
function fits(pattern: string, path: string): boolean {
  const want = pattern.split('/');
  const got = path.split('/');
  return want.length === got.length && want.every((segment, i) => (segment.startsWith(':') ? got[i] !== '' : segment === got[i]));
}

/** The ADMIN_ROUTES entry for this request, or undefined when it is not an admin route. */
export function adminRouteFor(method: string, path: string): AdminRoute | undefined {
  return ADMIN_ROUTES.find((route) => route.method === method && fits(route.path, path));
}

/**
 * Whether the request says its body is JSON. A cross-site page can send a POST without a CORS
 * preflight only as a "simple" request (text/plain, a form encoding, or no type at all), and the
 * browser still attaches the Access cookie. Requiring `application/json` forces a preflight, which
 * the admin API never answers, so such a request is refused before any handler reads its body.
 */
export function isJsonRequest(req: Request): boolean {
  const type = req.headers.get('content-type');
  return type !== null && type.split(';')[0]?.trim().toLowerCase() === 'application/json';
}

/**
 * Guards everything under `/api/admin/`: no staff is 401; a path or method not in ADMIN_ROUTES is
 * 404 (after sign-in, so a stranger learns nothing about which routes exist); a role the route
 * does not allow is 403; a POST whose body is not declared `application/json` is 415 (the CSRF
 * defence, see `isJsonRequest`). Every response, refusals and errors included, is private and
 * not indexed.
 */
export function adminGuard(verifyStaff: (req: Request) => Promise<Staff | null>): MiddlewareHandler<AdminEnv> {
  const setPrivate = (c: { header(name: string, value: string): void }) => {
    for (const [name, value] of Object.entries(PRIVATE_HEADERS)) c.header(name, value);
  };

  return async (c, next) => {
    setPrivate(c);
    const staff = await verifyStaff(c.req.raw);
    if (staff === null) return c.json({ error: 'unauthenticated' }, 401);
    const route = adminRouteFor(c.req.method, c.req.path);
    if (route === undefined) return c.json({ error: 'not_found' }, 404);
    if (!route.allow.includes(staff.role)) return c.json({ error: 'forbidden' }, 403);
    if (route.method === 'POST' && !isJsonRequest(c.req.raw)) return c.json({ error: 'unsupported_media_type' }, 415);
    c.set('staff', staff);
    await next();
    // A response built after an error (onError) is a new response: mark it too.
    setPrivate(c);
  };
}
