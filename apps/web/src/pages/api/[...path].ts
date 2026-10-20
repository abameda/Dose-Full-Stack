import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { apiFor } from '../../env';

export const prerender = false;

/** Every method on `/api/*` goes to the commerce API unchanged (it routes on the full path). */
export const ALL: APIRoute = ({ request }) => apiFor(env).fetch(request);
