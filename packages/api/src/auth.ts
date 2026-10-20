import { ROLES, type Staff } from '@dose/contract';
import type { Tx } from '@dose/core/db';
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { ApiDeps } from './app';

/** The header Cloudflare Access adds to every request it lets through. */
const ACCESS_HEADER = 'Cf-Access-Jwt-Assertion';
/** Sign-in on a developer's machine, where there is no Access in front. Ignored everywhere else. */
const DEV_STAFF_HEADER = 'X-Dev-Staff-Email';
/** Access signs with RS256; anything else (including `none`) is refused. */
const ACCESS_ALGORITHMS = ['RS256'];

export interface AccessVerifierOptions {
  /** e.g. `dose.cloudflareaccess.com`: the issuer, and where its signing keys are published. */
  teamDomain: string;
  /** The Access application's audience tag (`ACCESS_AUD`). */
  audience: string;
  /** The keys to verify with. Defaults to `https://<teamDomain>/cdn-cgi/access/certs`; tests pass local keys. */
  jwks?: JWTVerifyGetKey;
  env: ApiDeps['env'];
  /** The active staff member with this identity (an email, or an Access service token's client ID), or null. */
  lookup: (identity: string) => Promise<Staff | null>;
}

/**
 * Who is asking, as Cloudflare Access proved it: the `Cf-Access-Jwt-Assertion` token is verified
 * against the team's keys, this application's audience and the team's issuer, and the identity it
 * proves is looked up among active staff. A person's token proves their `email`; an Access service
 * token (used by automation) carries the token's client ID in `common_name` and has no email, so
 * `common_name` is the identity when there is no email. Staff are added under either (`staff.email`
 * holds the client ID). Any token that fails verification, or proves neither, is no staff (null).
 * Only when `env` is `local` is `X-Dev-Staff-Email` accepted instead; in every other env it is
 * ignored.
 */
export function createAccessVerifier(o: AccessVerifierOptions): (req: Request) => Promise<Staff | null> {
  const issuer = `https://${o.teamDomain}`;
  // Fetches nothing until the first token arrives, then caches the keys.
  const jwks = o.jwks ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));

  return async (req) => {
    if (o.env === 'local') {
      const devEmail = req.headers.get(DEV_STAFF_HEADER);
      if (devEmail !== null && devEmail !== '') return o.lookup(devEmail);
    }

    const token = req.headers.get(ACCESS_HEADER);
    if (token === null || token === '') return null;
    let identity: string | null;
    try {
      const { payload } = await jwtVerify(token, jwks, { audience: o.audience, issuer, algorithms: ACCESS_ALGORITHMS });
      identity = identityOf(payload);
    } catch (error) {
      // jose's own errors (a bad, expired or foreign token; no matching key; a key fetch that timed
      // out) mean not signed in. Anything else is a fault and becomes a 500.
      if (error instanceof errors.JOSEError) return null;
      throw error;
    }
    return identity === null ? null : o.lookup(identity);
  };
}

/** The `email` of a person's token, else the `common_name` (client ID) of a service token, else null. */
function identityOf(payload: JWTPayload): string | null {
  for (const claim of ['email', 'common_name']) {
    const value = payload[claim];
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

/** The active staff member with this identity (an email, or a service token's client ID; compared without regard to case), or null. */
export async function findActiveStaff(db: Tx, identity: string): Promise<Staff | null> {
  const [row] = await db.query<{ id: string; email: string; name: string; role: string }>(
    `select id, email::text as email, name, role from staff where email = $1::citext and active`,
    [identity],
  );
  if (row === undefined) return null;
  const role = ROLES.find((r) => r === row.role);
  if (role === undefined) throw new Error(`staff ${row.id} has an unknown role "${row.role}"`);
  return { id: row.id, email: row.email, name: row.name, role };
}
