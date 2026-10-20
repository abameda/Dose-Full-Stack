import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'core',
    // Migrates dose_test_template once per run (shared with api and web); needs `docker compose up -d`.
    globalSetup: ['./test/global-setup.ts'],
    // One test file at a time: the checkout concurrency test alone holds 58 of Postgres's 100
    // default connections, and files running side by side would exhaust the rest.
    fileParallelism: false,
    // The database-backed projects (core 1, api 2, web 3) run one after another, after the
    // projects that need no database, so only one test file at a time talks to Postgres.
    sequence: { groupOrder: 1 },
  },
});
