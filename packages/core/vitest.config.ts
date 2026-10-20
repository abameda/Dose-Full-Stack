import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'core',
    // Migrates dose_test_template once per run; needs `docker compose up -d`.
    globalSetup: ['./test/global-setup.ts'],
  },
});
