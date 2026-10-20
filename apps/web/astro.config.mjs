// @ts-check
import cloudflare from '@astrojs/cloudflare';
import { defineConfig } from 'astro/config';

// Every page is rendered on request by the Worker (wrangler.jsonc); nothing is prerendered.
export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    // Product images are stored at their display size by the seed and served from /media.
    imageService: 'passthrough',
  }),
});
