// @ts-check
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';

// Every page is rendered on request by the Worker (wrangler.jsonc); nothing is prerendered.
// React runs only in the storefront's islands (the bag, add to bag, the checkout form).
export default defineConfig({
  output: 'server',
  integrations: [react()],
  adapter: cloudflare({
    // Product images are stored at their display size by the seed and served from /media.
    imageService: 'passthrough',
  }),
});
