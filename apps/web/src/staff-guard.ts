import { PRIVATE_HEADERS } from '@dose/api';
import type { Staff } from '@dose/contract';

// Two areas of the site are for signed-in staff only: the studio, which shows unreleased design
// directions on real products, and the admin. Neither is ever cached or indexed (constraints). The
// studio refuses to run checkout; the admin's API (`/api/admin/*`) has its own guard, which also
// checks each person's role, so this one only decides who may be sent the admin's pages.

/** The first path segments that belong to staff: `/studio/...` and `/admin/...`. */
const STAFF_AREAS: readonly string[] = ['studio', 'admin'];

/** The most times a path is percent-decoded, as in Astro's router (`validateAndDecodePathname`). */
const MAX_DECODES = 10;

/**
 * The path as the router will read it: percent-decoded until it stops changing, backslashes as
 * slashes, repeated slashes and `.` dropped, `..` resolved. `null` when it cannot be decoded
 * (a malformed escape, or more layers of encoding than the router will unwrap).
 */
function routedSegments(pathname: string): string[] | null {
  let path = pathname;
  for (let decodes = 0; ; decodes++) {
    let next: string;
    try {
      next = decodeURIComponent(path);
    } catch {
      return null;
    }
    if (next === path) break;
    if (decodes >= MAX_DECODES) return null;
    path = next;
  }
  const segments: string[] = [];
  for (const segment of path.replaceAll('\\', '/').split('/')) {
    if (segment === '..') segments.pop();
    else if (segment !== '' && segment !== '.') segments.push(segment);
  }
  return segments;
}

/**
 * Whether a request path is a staff area (the studio or the admin) or anything under one
 * (compared without regard to case). It reads the path the way the router does, so
 * `/%73tudio/...`, `/%2573tudio/...`, `//studio/...`, `/studio%2F...` and `/%61dmin/...` are
 * guarded too (Astro hands the middleware an already-decoded URL, but the guard does not depend
 * on that). It fails closed: a path it cannot decode counts as a staff area.
 */
export function isStaffAreaPath(pathname: string): boolean {
  const segments = routedSegments(pathname);
  if (segments === null) return true;
  const first = segments[0]?.toLowerCase();
  return first !== undefined && STAFF_AREAS.includes(first);
}

/**
 * A copy of `response` that is private and not indexed. It builds a new Response, because the
 * headers of one that came out of the page renderer (or `Response.redirect`) may be frozen.
 */
export function withPrivateHeaders(response: Response): Response {
  const marked = new Response(response.body, response);
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) marked.headers.set(name, value);
  return marked;
}

/**
 * Lets only signed-in staff into a staff area. Returns the refusal to send, or null to carry on:
 * no staff member is a 401 that names nothing about which pages exist. Any active staff member
 * may be sent a page (the studio holds the public catalogue and no customer data; the admin's
 * page is only the app, and every call it makes is checked against the person's role by the
 * API); nothing a page itself does changes anything. A verifier that throws (database down, a
 * fault) throws on, so the caller answers 500 and never lets anyone in.
 */
export async function guardStaffArea(
  req: Request,
  verify: (req: Request) => Promise<Staff | null>,
): Promise<Response | null> {
  const staff = await verify(req);
  if (staff !== null) return null;
  return withPrivateHeaders(new Response('Sign in with your staff account to continue.', { status: 401, headers: { 'content-type': 'text/plain; charset=utf-8' } }));
}
