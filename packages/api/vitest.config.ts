import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'api',
    // The same migrated template database as @dose/core's tests; needs `docker compose up -d`.
    globalSetup: ['../core/test/global-setup.ts'],
    // One test file at a time, like @dose/core: files share one Postgres server.
    fileParallelism: false,
    // After core, before web: see packages/core/vitest.config.ts.
    sequence: { groupOrder: 2 },
  },
});
