import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'core',
    // Migrates dose_test_template once per run; needs `docker compose up -d`.
    globalSetup: ['./test/global-setup.ts'],
    // One test file at a time: the checkout concurrency test alone holds 58 of Postgres's 100
    // default connections, and files running side by side would exhaust the rest.
    fileParallelism: false,
  },
});
