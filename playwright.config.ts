import process from 'node:process';
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';
import { ACCESS_HEADERS, APP_URL, OWNER_URL, REMOTE_BASE_URL } from './e2e/support/env';

// End-to-end tests run against the real Worker, locally by default: `astro build`, then
// `wrangler dev` serving the build with local R2 (miniflare) and Hyperdrive pointed at the local
// Postgres of docker-compose.yml (`docker compose up -d` first). Before the build, `pnpm seed
// --fresh` recreates the `dose_e2e` database, migrates it and seeds the catalogue, so every run
// starts from the same data. The database URLs are the fixed, dev-only values of
// docker-compose.yml (e2e/support/env.ts).
//
// With `E2E_BASE_URL` set they run against that deployed environment instead (staging, from
// .github/workflows/staging.yml): no local Worker, every request carries the Cloudflare Access
// service-token headers, only the tests tagged @staging run, on the two phones, and the results
// go to the console alone.

const PORT = 8788;
const LOCAL_URL = `http://127.0.0.1:${String(PORT)}`;

/** Tests whose title carries this tag run alone, in the `-serial` projects. */
const SERIAL = /@serial/;
/** The tests that also run against a deployed environment. */
const STAGING = /@staging/;

const server = [
  `pnpm seed --target ${OWNER_URL} --media local --fresh`,
  'pnpm --filter @dose/web build',
  `pnpm --filter @dose/web exec wrangler dev --ip 127.0.0.1 --port ${String(PORT)} --persist-to .wrangler/state --var ENVIRONMENT:local --test-scheduled --show-interactive-dev-session=false`,
].join(' && ');

const local: PlaywrightTestConfig = {
  reporter: process.env['CI'] === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: { baseURL: LOCAL_URL, trace: 'retain-on-failure' },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 13'] }, grepInvert: SERIAL },
    { name: 'pixel', use: { ...devices['Pixel 7'] }, grepInvert: SERIAL },
    // A test tagged @serial changes shared data (a live price), which would fail checkouts running
    // beside it. These two projects run only those tests, one phone after the other, once
    // everything else has finished.
    { name: 'iphone-serial', use: { ...devices['iPhone 13'] }, grep: SERIAL, dependencies: ['iphone', 'pixel'] },
    { name: 'pixel-serial', use: { ...devices['Pixel 7'] }, grep: SERIAL, dependencies: ['iphone-serial'] },
  ],
  webServer: {
    command: server,
    url: `${LOCAL_URL}/en`,
    timeout: 240_000,
    reuseExistingServer: process.env['CI'] === undefined,
    env: {
      // wrangler dev: Hyperdrive's local connection goes to the e2e database as `dose_app`.
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: APP_URL,
    },
  },
};

const remote = (baseURL: string): PlaywrightTestConfig => ({
  // The list reporter only, and no traces: an API request's call log and a trace both record every
  // request header, the Access client secret included. The list goes to the CI step log, where
  // GitHub masks the secret; nothing is written to a report or uploaded (the repository is public).
  reporter: 'list',
  use: { baseURL, extraHTTPHeaders: ACCESS_HEADERS, trace: 'off', screenshot: 'off', video: 'off' },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 13'] }, grep: STAGING },
    { name: 'pixel', use: { ...devices['Pixel 7'] }, grep: STAGING },
  ],
});

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: process.env['CI'] !== undefined,
  retries: process.env['CI'] === undefined ? 0 : 1,
  ...(REMOTE_BASE_URL === undefined ? local : remote(REMOTE_BASE_URL)),
});
