import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { serveMedia } from '../../media';

export const prerender = false;

/** Streams a stored product image from R2: `GET /media/<key>`. Only seeded image keys are served. */
export const GET: APIRoute = ({ params }) => serveMedia(env.MEDIA, params['key']);
