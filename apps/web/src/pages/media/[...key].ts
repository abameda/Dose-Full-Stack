import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

/** Keys are content-hashed by the seed (`products/<slug>/<sha256>.jpg`), so a key's bytes never change. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Streams a stored image from R2: `GET /media/<key>`. */
export const GET: APIRoute = async ({ params }) => {
  const key = params['key'];
  if (key === undefined || key === '') return new Response('Not found', { status: 404 });

  const object = await env.MEDIA.get(key);
  if (object === null) return new Response('Not found', { status: 404 });

  // The R2 stream is the runtime's own ReadableStream; only its two type declarations differ.
  return new Response(object.body as unknown as ReadableStream, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': IMMUTABLE,
      etag: object.httpEtag,
      'x-content-type-options': 'nosniff',
    },
  });
};
