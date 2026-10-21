import { defineConfig } from 'vitest/config';

// `pnpm test:preview` only (the root vitest.config.ts leaves test/preview out of `pnpm test`):
// the isolation test of one pull request's preview, against live Neon, Cloudflare and Access.
export default defineConfig({
  test: {
    name: 'preview',
    root: import.meta.dirname,
    include: ['preview-isolation.test.ts'],
    // A preview branch's compute may be waking up; one connection can take several seconds.
    testTimeout: 60_000,
  },
});
