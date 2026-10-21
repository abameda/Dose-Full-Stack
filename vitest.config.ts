import { defineConfig } from 'vitest/config';

// Vitest 5 removed `vitest.workspace.ts`; `test.projects` replaces it.
// Not test/preview: it needs a live preview and its credentials, so it runs only as
// `pnpm test:preview` (test/preview/vitest.config.ts), inside .github/workflows/preview.yml.
export default defineConfig({
  test: {
    projects: ['packages/*', 'directions/*', 'apps/*', 'poc', 'test/*', '!test/preview'],
  },
});
