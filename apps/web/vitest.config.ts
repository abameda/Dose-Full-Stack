import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'web',
    // The cron test uses @dose/core's migrated template database; needs `docker compose up -d`.
    globalSetup: ['../../packages/core/test/global-setup.ts'],
    // One test file at a time, like @dose/core: files share one Postgres server.
    fileParallelism: false,
  },
});
