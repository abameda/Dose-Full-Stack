import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { serveMedia } from '../../media';

export const prerender = false;

/**
 * Streams a stored product image from R2: `GET /media/<key>`. Only seeded image keys are served.
 * Where there is no bucket, the static assets (public/media/, written by the build) serve them.
 */
export const GET: APIRoute = ({ params }) => serveMedia(env.MEDIA, params['key']);
