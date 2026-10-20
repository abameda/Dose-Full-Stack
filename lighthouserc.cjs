// Lighthouse CI: the speed and accessibility gate for Direction 0's product page (`pnpm lhci`).
//
// It builds and serves the real Worker (`astro build`, then `wrangler dev` with local R2 and
// Hyperdrive pointed at a seeded local Postgres, as `pnpm e2e` does), then audits the product page
// in both languages with Lighthouse's default mobile emulation and throttling: three runs per URL,
// judged on the median. Nothing here is a cloud account; `docker compose up -d` must be running.
//
// The database URLs are the fixed, dev-only values of docker-compose.yml. The audit has its own
// database (`dose_lhci`) and port so it never collides with a `pnpm e2e` run.
// The lint config has no Node globals for CommonJS files, so `process` is required explicitly.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const process = require('node:process');

const PORT = 8789;
const ORIGIN = `http://127.0.0.1:${String(PORT)}`;
const DATABASE = 'dose_lhci';
const OWNER_URL =
  process.env.DOSE_LHCI_OWNER_URL ?? `postgres://dose_owner:dose_owner_local@127.0.0.1:54329/${DATABASE}`;
const APP_URL = process.env.DOSE_LHCI_APP_URL ?? `postgres://dose_app:dose_app_local@127.0.0.1:54329/${DATABASE}`;

// lhci starts the server with this process's environment: wrangler dev reads Hyperdrive's local
// connection string from here, and connects as `dose_app`.
process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = APP_URL;

const server = [
  `pnpm seed --target ${OWNER_URL} --media local --fresh`,
  'pnpm --filter @dose/web build',
  `pnpm --filter @dose/web exec wrangler dev --ip 127.0.0.1 --port ${String(PORT)} --persist-to .wrangler/state --var ENVIRONMENT:local --show-interactive-dev-session=false`,
].join(' && ');

/** Median of the three runs, so one noisy run neither fails nor rescues the gate. */
const median = { aggregationMethod: 'median' };

module.exports = {
  ci: {
    collect: {
      url: [`${ORIGIN}/en/products/paradise`, `${ORIGIN}/ar/products/paradise`],
      numberOfRuns: 3,
      startServerCommand: server,
      startServerReadyPattern: 'Ready on',
      startServerReadyTimeout: 240_000,
      // No `preset`: Lighthouse's default is mobile emulation with simulated slow-4G throttling.
      settings: {
        // GitHub's Ubuntu runners cannot start Chrome's sandbox as the unprivileged runner user.
        chromeFlags: process.env.CI === undefined ? '' : '--no-sandbox',
      },
    },
    assert: {
      assertions: {
        'largest-contentful-paint': ['error', { maxNumericValue: 2500, ...median }],
        // Transfer (compressed) bytes, the approved reading of "under 110 KB": 110 x 1024.
        'resource-summary:script:size': ['error', { maxNumericValue: 112_640, ...median }],
        'categories:accessibility': ['error', { minScore: 0.95, ...median }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: '.lighthouseci',
    },
  },
};
