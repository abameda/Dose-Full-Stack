import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { handleDiag } from '../../diag';
import { apiFor, requestDb, verifyStaffFor } from '../../env';

export const prerender = false;

/**
 * Every method on `/api/*` goes to the commerce API unchanged (it routes on the full path), except
 * the two staff diagnostics under `/api/_diag/`, which Astro cannot route as files (see diag.ts).
 */
export const ALL: APIRoute = async ({ request }) => {
  const diagnostic = await handleDiag(request, {
    environment: env.ENVIRONMENT,
    verifyStaff: (req) => verifyStaffFor(env)(req),
    db: () => requestDb(env),
    fetch: (input, init) => fetch(input, init),
  });
  return diagnostic ?? apiFor(env).fetch(request);
};
