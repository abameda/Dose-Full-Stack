import type { Staff } from '@dose/contract';
import type { Db } from '@dose/core/db';
import { withPrivateHeaders } from './staff-guard';

// Two diagnostics for staff to check a deployed environment, served at `/api/_diag/*`. They live
// here, not in `pages/api/_diag/`, because Astro does not route files or folders whose name starts
// with `_`; `pages/api/[...path].ts` hands exactly these two paths (GET) to `handleDiag` before the
// commerce API. They do not exist in production.

const DB_IDENTITY_PATH = '/api/_diag/db-identity';
const READ_YOUR_WRITES_PATH = '/api/_diag/read-your-writes';

/** How many write-then-read pairs the read-your-writes check makes. */
const ITERATIONS = 20;

const TRACE_URL = 'https://cloudflare.com/cdn-cgi/trace';
const TRACE_TIMEOUT_MS = 2000;

export interface DiagDeps {
  /** `ENVIRONMENT` of the Worker. `production` has no diagnostics. */
  environment: string;
  /** Who is asking. Called only outside production. */
  verifyStaff: (req: Request) => Promise<Staff | null>;
  /** One connection for this request; `handleDiag` closes it. */
  db: () => Db;
  fetch: typeof fetch;
}

function reply(body: BodyInit | null, status: number, contentType?: string): Response {
  return withPrivateHeaders(new Response(body, { status, ...(contentType === undefined ? {} : { headers: { 'content-type': contentType } }) }));
}

const json = (body: unknown): Response => reply(JSON.stringify(body), 200, 'application/json');

/** `GET /api/_diag/db-identity`: the name this database gives itself (`env_identity`), or null. */
async function dbIdentity(db: Db): Promise<Response> {
  const [row] = await db.query<{ name: string }>(`select name from env_identity`);
  return json({ identity: row?.name ?? null });
}

/**
 * `GET /api/_diag/read-your-writes`: whether a read right after a write sees it through Hyperdrive.
 * Hyperdrive caches only reads outside transactions, keyed on the query text and parameters, so
 * the read is the same parameterless statement every time (a fresh token per read would never hit
 * the cache). Each of the 20 rounds inserts a row and reads `max(id)`: equal means the read saw the
 * write. Another request writing at the same moment can make a round count as stale.
 */
async function readYourWrites(db: Db, colo: string | null, fetcher: typeof fetch): Promise<Response> {
  let stale = 0;
  for (let i = 0; i < ITERATIONS; i++) {
    const [written] = await db.query<{ id: string }>(`insert into diag_writes (token) values ($1) returning id::text as id`, [crypto.randomUUID()]);
    const [read] = await db.query<{ id: string }>(`select max(id)::text as id from diag_writes`);
    if (written === undefined || read?.id !== written.id) stale++;
  }
  return json({ consistent: stale === 0, iterations: ITERATIONS, stale, colo, placement: await placementOf(fetcher) });
}

/** The Cloudflare data centre this Worker runs in, from the `colo=` line of the trace, or null. */
async function placementOf(fetcher: typeof fetch): Promise<string | null> {
  try {
    const response = await fetcher(TRACE_URL, { signal: AbortSignal.timeout(TRACE_TIMEOUT_MS) });
    if (!response.ok) return null;
    const match = /^colo=(\S+)$/m.exec(await response.text());
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** The data centre that received the request (`request.cf.colo`), where Cloudflare provides it. */
function coloOf(req: Request): string | null {
  const colo = (req as { cf?: { colo?: unknown } }).cf?.colo;
  return typeof colo === 'string' && colo !== '' ? colo : null;
}

/**
 * The diagnostic response for `req`, or null when `req` is not one of the two diagnostic requests
 * (exactly these paths, GET), which then go to the commerce API unchanged. Production is a plain
 * 404 before anything else is checked; anyone but active staff is a 401; a fault is a 500. Every
 * response is private and not indexed.
 */
export async function handleDiag(req: Request, deps: DiagDeps): Promise<Response | null> {
  if (req.method !== 'GET') return null;
  const { pathname } = new URL(req.url);
  if (pathname !== DB_IDENTITY_PATH && pathname !== READ_YOUR_WRITES_PATH) return null;

  if (deps.environment === 'production') return reply('Not found', 404, 'text/plain; charset=utf-8');

  let db: Db | undefined;
  try {
    if ((await deps.verifyStaff(req)) === null) return reply('Unauthorized', 401, 'text/plain; charset=utf-8');
    db = deps.db();
    return pathname === DB_IDENTITY_PATH ? await dbIdentity(db) : await readYourWrites(db, coloOf(req), deps.fetch);
  } catch (error) {
    console.error('diag failed:', error instanceof Error ? error.message : 'unknown error');
    return reply('Internal error', 500, 'text/plain; charset=utf-8');
  } finally {
    await db?.close().catch(() => undefined);
  }
}
