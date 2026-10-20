import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the real Worker: `astro build`, then `wrangler dev` serving the
// build with local R2 (miniflare) and Hyperdrive pointed at the local Postgres of
// docker-compose.yml (`docker compose up -d` first). Before the build, `pnpm seed --fresh`
// recreates the `dose_e2e` database, migrates it and seeds the catalogue, so every run starts
// from the same data. The URLs below are the fixed, dev-only values of docker-compose.yml.

const PORT = 8788;
const BASE_URL = `http://127.0.0.1:${String(PORT)}`;

const E2E_DATABASE = 'dose_e2e';
const OWNER_URL =
  process.env['DOSE_E2E_OWNER_URL'] ?? `postgres://dose_owner:dose_owner_local@127.0.0.1:54329/${E2E_DATABASE}`;
const APP_URL =
  process.env['DOSE_E2E_APP_URL'] ?? `postgres://dose_app:dose_app_local@127.0.0.1:54329/${E2E_DATABASE}`;

const server = [
  `pnpm seed --target ${OWNER_URL} --media local --fresh`,
  'pnpm --filter @dose/web build',
  `pnpm --filter @dose/web exec wrangler dev --ip 127.0.0.1 --port ${String(PORT)} --persist-to .wrangler/state --var ENVIRONMENT:local --test-scheduled --show-interactive-dev-session=false`,
].join(' && ');

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: process.env['CI'] !== undefined,
  retries: process.env['CI'] === undefined ? 0 : 1,
  reporter: process.env['CI'] === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
    { name: 'pixel', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: server,
    url: `${BASE_URL}/en`,
    timeout: 240_000,
    reuseExistingServer: process.env['CI'] === undefined,
    env: {
      // wrangler dev: Hyperdrive's local connection goes to the e2e database as `dose_app`.
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: APP_URL,
    },
  },
});
