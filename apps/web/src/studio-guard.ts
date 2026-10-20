import { PRIVATE_HEADERS } from '@dose/api';
import type { Staff } from '@dose/contract';

// The studio shows unreleased design directions on real products, to signed-in staff only. It is
// never cached and never indexed (constraints), and checkout refuses to run there.

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
 * Whether a request path is the studio or anything under it (compared without regard to case).
 * It reads the path the way the router does, so `/%73tudio/...`, `/%2573tudio/...`, `//studio/...`
 * and `/studio%2F...` are the studio too (Astro hands the middleware an already-decoded URL, but
 * the guard does not depend on that). It fails closed: a path it cannot decode counts as studio.
 */
export function isStudioPath(pathname: string): boolean {
  const segments = routedSegments(pathname);
  return segments === null || segments[0]?.toLowerCase() === 'studio';
}

/**
 * A copy of `response` that is private and not indexed. It builds a new Response, because the
 * headers of one that came out of the page renderer (or `Response.redirect`) may be frozen.
 */
export function withStudioHeaders(response: Response): Response {
  const marked = new Response(response.body, response);
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) marked.headers.set(name, value);
  return marked;
}

/**
 * Lets only signed-in staff into the studio. Returns the refusal to send, or null to carry on:
 * no staff member is a 401 that names nothing about which studio pages exist. Any active staff
 * member may look (the studio holds the public catalogue and no customer data); the role matrix
 * guards what staff can change, and nothing in the studio changes anything. A verifier that
 * throws (database down, a fault) throws on, so the caller answers 500 and never lets anyone in.
 */
export async function guardStudio(
  req: Request,
  verify: (req: Request) => Promise<Staff | null>,
): Promise<Response | null> {
  const staff = await verify(req);
  if (staff !== null) return null;
  return withStudioHeaders(new Response('Sign in to see the studio.', { status: 401, headers: { 'content-type': 'text/plain; charset=utf-8' } }));
}
