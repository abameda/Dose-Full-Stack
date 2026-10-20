import type { R2Bucket } from '@cloudflare/workers-types';
import { expect, test, vi } from 'vitest';
import { serveMedia } from '../src/media';

const HASH = 'a'.repeat(64);
const KEY = `products/paradise/${HASH}.jpg`;

/** A bucket that holds one JPEG under every key it is asked for, so only the route decides what is served. */
function bucket() {
  const get = vi.fn(() =>
    Promise.resolve({
      body: new Response('jpeg-bytes').body,
      httpMetadata: { contentType: 'image/jpeg' },
      httpEtag: '"etag-1"',
    }),
  );
  return { get, media: { get } as unknown as Pick<R2Bucket, 'get'> };
}

test('a seeded product image is served with the immutable cache header', async () => {
  const { get, media } = bucket();
  const response = await serveMedia(media, KEY);
  expect(response.status).toBe(200);
  expect(get).toHaveBeenCalledExactlyOnceWith(KEY);
  expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  expect(response.headers.get('content-type')).toBe('image/jpeg');
  expect(await response.text()).toBe('jpeg-bytes');
});

test('a multi-word slug is accepted', async () => {
  const { media } = bucket();
  expect((await serveMedia(media, `products/oud-noir-2/${HASH}.jpg`)).status).toBe(200);
});

test('a missing object is a 404', async () => {
  const media = { get: () => Promise.resolve(null) } as unknown as Pick<R2Bucket, 'get'>;
  expect((await serveMedia(media, KEY)).status).toBe(404);
});

test.each([
  ['no key', undefined],
  ['an empty key', ''],
  ['another prefix', `private/paradise/${HASH}.jpg`],
  ['a key at the bucket root', `${HASH}.jpg`],
  ['a nested path', `products/paradise/extra/${HASH}.jpg`],
  ['an upper-case slug', `products/Paradise/${HASH}.jpg`],
  ['a slug with a leading dash', `products/-paradise/${HASH}.jpg`],
  ['a slug with a double dash', `products/para--dise/${HASH}.jpg`],
  ['a slug with a trailing dash', `products/paradise-/${HASH}.jpg`],
  ['a dot-dot segment', `products/../${HASH}.jpg`],
  ['a short hash', `products/paradise/${'a'.repeat(63)}.jpg`],
  ['a long hash', `products/paradise/${'a'.repeat(65)}.jpg`],
  ['an upper-case hash', `products/paradise/${'A'.repeat(64)}.jpg`],
  ['a non-hex hash', `products/paradise/${'g'.repeat(64)}.jpg`],
  ['another extension', `products/paradise/${HASH}.png`],
  ['a trailing suffix', `${KEY}.bak`],
  ['a trailing newline', `${KEY}\n`],
  ['a leading slash', `/${KEY}`],
])('%s is a 404 without touching the bucket', async (_name, key) => {
  const { get, media } = bucket();
  const response = await serveMedia(media, key);
  expect(response.status).toBe(404);
  expect(response.headers.get('cache-control')).toBeNull();
  expect(get).not.toHaveBeenCalled();
});
