import { PRIVATE_HEADERS } from '@dose/api';
import type { Staff } from '@dose/contract';

// The studio shows unreleased design directions on real products, to signed-in staff only. It is
// never cached and never indexed (constraints), and checkout refuses to run there.

/** Whether a request path is the studio or anything under it (compared without regard to case). */
export function isStudioPath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return path === '/studio' || path.startsWith('/studio/');
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
