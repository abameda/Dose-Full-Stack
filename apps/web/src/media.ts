import type { R2Bucket } from '@cloudflare/workers-types';

/**
 * The only keys the media route serves: the seed's `products/<slug>/<sha256 of the bytes>.jpg`.
 * Because the hash is in the key, a key's bytes never change, so they can be cached forever.
 * Anything else in the bucket is not public.
 */
const MEDIA_KEY = /^products\/[a-z0-9]+(-[a-z0-9]+)*\/[0-9a-f]{64}\.jpg$/;

const IMMUTABLE = 'public, max-age=31536000, immutable';

const notFound = () => new Response('Not found', { status: 404 });

/** `GET /media/<key>`: streams a content-hashed product image from R2, or 404. */
export async function serveMedia(bucket: Pick<R2Bucket, 'get'>, key: string | undefined): Promise<Response> {
  if (key === undefined || !MEDIA_KEY.test(key)) return notFound();

  const object = await bucket.get(key);
  if (object === null) return notFound();

  // The R2 stream is the runtime's own ReadableStream; only its two type declarations differ.
  return new Response(object.body as unknown as ReadableStream, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': IMMUTABLE,
      etag: object.httpEtag,
      'x-content-type-options': 'nosniff',
    },
  });
}
