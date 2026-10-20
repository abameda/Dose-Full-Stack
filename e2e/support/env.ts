import process from 'node:process';

// The fixed, dev-only database URLs of docker-compose.yml. The e2e run owns the `dose_e2e`
// database (playwright.config.ts recreates it before the build), so the tests may change it
// through the owner role, which is what a migration or an operator would do.

export const E2E_DATABASE = 'dose_e2e';
export const OWNER_URL =
  process.env['DOSE_E2E_OWNER_URL'] ?? `postgres://dose_owner:dose_owner_local@127.0.0.1:54329/${E2E_DATABASE}`;
export const APP_URL =
  process.env['DOSE_E2E_APP_URL'] ?? `postgres://dose_app:dose_app_local@127.0.0.1:54329/${E2E_DATABASE}`;

/** A staff member the seed creates for local sign-in (`X-Dev-Staff-Email` works on `local` only). */
export const OWNER_HEADERS = { 'X-Dev-Staff-Email': 'owner@example.test' } as const;
