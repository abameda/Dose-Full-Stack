import process from 'node:process';

// Where the end-to-end tests run, and who they are.
//
// Local (the default): playwright.config.ts builds and serves the Worker against the `dose_e2e`
// database, and staff sign in with the dev header (`X-Dev-Staff-Email`, accepted on `local` only)
// as the seed's two test members.
//
// Remote: `E2E_BASE_URL` names a deployed environment (staging) behind Cloudflare Access. Every
// request carries the Access service-token headers, and the service token is the only staff member:
// no staff header is sent, and the names the admin shows come from `E2E_STAFF_NAME`. The token must
// be an owner (`pnpm staff:add --identity <client ID> --role owner`): the flow reads the audit log.
// Only tests tagged `@staging` run there, and none of them may use the owner database connection.

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

/** A variable remote mode needs. The message names it, never its value. */
function required(name: string): string {
  const value = optional(name);
  if (value === undefined) throw new Error(`E2E_BASE_URL is set, so the end-to-end tests run remotely and need ${name}; it is not set`);
  return value;
}

/** The deployed environment under test, or undefined for the local Worker. */
export const REMOTE_BASE_URL = optional('E2E_BASE_URL');
export const REMOTE = REMOTE_BASE_URL !== undefined;

/** The Cloudflare Access service-token headers in remote mode, else none. */
export const ACCESS_HEADERS: Readonly<Record<string, string>> = REMOTE
  ? { 'CF-Access-Client-Id': required('CF_ACCESS_CLIENT_ID'), 'CF-Access-Client-Secret': required('CF_ACCESS_CLIENT_SECRET') }
  : {};

const STAFF_NAME = REMOTE ? required('E2E_STAFF_NAME') : undefined;

/** Signed in as operations: locally the seed's operations member; remotely the service token. */
export const OPERATIONS_HEADERS: Readonly<Record<string, string>> = REMOTE
  ? ACCESS_HEADERS
  : { 'X-Dev-Staff-Email': 'operations@example.test' };
/** The name the admin shows for `OPERATIONS_HEADERS`. */
export const OPERATIONS_NAME = STAFF_NAME ?? 'Local Operations';

/** Signed in as the owner: locally the seed's owner; remotely the service token. */
export const OWNER_HEADERS: Readonly<Record<string, string>> = REMOTE ? ACCESS_HEADERS : { 'X-Dev-Staff-Email': 'owner@example.test' };
/** The name the admin shows for `OWNER_HEADERS`. */
export const OWNER_NAME = STAFF_NAME ?? 'Local Owner';

// The fixed, dev-only database URLs of docker-compose.yml. The local e2e run owns the `dose_e2e`
// database (playwright.config.ts recreates it before the build), so the tests may change it
// through the owner role, which is what a migration or an operator would do.

export const E2E_DATABASE = 'dose_e2e';
export const OWNER_URL =
  process.env['DOSE_E2E_OWNER_URL'] ?? `postgres://dose_owner:dose_owner_local@127.0.0.1:54329/${E2E_DATABASE}`;
export const APP_URL =
  process.env['DOSE_E2E_APP_URL'] ?? `postgres://dose_app:dose_app_local@127.0.0.1:54329/${E2E_DATABASE}`;
