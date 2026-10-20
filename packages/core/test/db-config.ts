// Connection settings shared by global-setup.ts (runs in the Vitest main process) and
// harness.ts (runs inside test workers). Kept free of any `vitest` import for that reason.
//
// The defaults are the fixed, dev-only values from docker-compose.yml (`docker compose up -d`)
// and from the Postgres service container in .github/workflows/ci.yml. They are not secrets.
// Override with DOSE_TEST_ADMIN_URL (an owner-role URL for the `postgres` database) and
// DOSE_APP_PASSWORD.

export const TEMPLATE_DB = 'dose_test_template';

/** Every database the harness creates starts with this prefix, so leftovers are easy to sweep. */
export const TEST_DB_PREFIX = 'dose_test_';

const ADMIN_URL =
  process.env['DOSE_TEST_ADMIN_URL'] ?? 'postgres://dose_owner:dose_owner_local@127.0.0.1:54329/postgres';

const APP_PASSWORD = process.env['DOSE_APP_PASSWORD'] ?? 'dose_app_local';

/** The owner role (`dose_owner`) on the maintenance database: creates, drops and migrates. */
export function adminUrl(): string {
  return ADMIN_URL;
}

/** The owner role connected to `database`. */
export function ownerUrlFor(database: string): string {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

/** The application role (`dose_app`) connected to `database`. */
export function appUrlFor(database: string): string {
  const url = new URL(ownerUrlFor(database));
  url.username = 'dose_app';
  url.password = APP_PASSWORD;
  return url.toString();
}

/** Quotes a database name for use in CREATE/DROP DATABASE (which cannot take parameters). */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
