import { defineConfig } from 'vitest/config';

// Vitest 5 removed `vitest.workspace.ts`; `test.projects` replaces it.
export default defineConfig({
  test: {
    projects: ['packages/*', 'directions/*', 'apps/*', 'test/*'],
  },
});
