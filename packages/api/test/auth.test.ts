import type { Staff } from '@dose/contract';
import { withTestDb } from '@dose/core/test-harness';
import { exportJWK, generateKeyPair, SignJWT, UnsecuredJWT, createLocalJWKSet, type CryptoKey } from 'jose';
import { beforeAll, expect, test } from 'vitest';
import type { ApiDeps } from '../src/app';
import { createAccessVerifier, findActiveStaff } from '../src/auth';

// Tokens are signed here with a key pair made for this file and checked against a local JWKS:
// nothing calls Cloudflare.
const TEAM_DOMAIN = 'dose-test.cloudflareaccess.com';
const AUDIENCE = 'test-access-audience';
const KID = 'test-key';

let signingKey: CryptoKey;
let otherKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;
let lookup: (email: string) => Promise<Staff | null>;
let operations: Staff;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256' }] });

  const db = await withTestDb();
  const [row] = await db.owner.query<{ id: string }>(
    `insert into staff (email, name, role) values ('ops@example.test', 'Olivia Operations', 'operations') returning id`,
  );
  if (row === undefined) throw new Error('staff insert returned no row');
  await db.owner.query(`insert into staff (email, name, role, active) values ('gone@example.test', 'Former Staff', 'owner', false)`);
  operations = { id: row.id, email: 'ops@example.test', name: 'Olivia Operations', role: 'operations' };
  lookup = (email) => findActiveStaff(db.app, email);
});

function verifier(env: ApiDeps['env'] = 'production') {
  return createAccessVerifier({ teamDomain: TEAM_DOMAIN, audience: AUDIENCE, jwks, env, lookup });
}

type TokenOptions = { email?: string; audience?: string; issuer?: string; expiresAt?: number | string; key?: CryptoKey };

function token(o: TokenOptions = {}): Promise<string> {
  return new SignJWT({ email: o.email ?? 'ops@example.test' })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(o.issuer ?? `https://${TEAM_DOMAIN}`)
    .setAudience(o.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(o.expiresAt ?? '5m')
    .sign(o.key ?? signingKey);
}

function withHeaders(headers: Record<string, string>): Request {
  return new Request('http://dose.test/api/admin/me', { headers });
}

const withToken = (jwt: string) => withHeaders({ 'Cf-Access-Jwt-Assertion': jwt });

test('a token signed by the Access key for this audience is the active staff member it names', async () => {
  expect(await verifier()(withToken(await token()))).toEqual(operations);
});

test('the email in the token matches staff regardless of case', async () => {
  expect(await verifier()(withToken(await token({ email: 'OPS@Example.TEST' })))).toEqual(operations);
});

test('no token is no staff', async () => {
  expect(await verifier()(withHeaders({}))).toBeNull();
});

test('a token for another audience is refused', async () => {
  expect(await verifier()(withToken(await token({ audience: 'some-other-app' })))).toBeNull();
});

test('a token from another issuer is refused', async () => {
  expect(await verifier()(withToken(await token({ issuer: 'https://someone-else.cloudflareaccess.com' })))).toBeNull();
});

test('an expired token is refused', async () => {
  const anHourAgo = Math.floor(Date.now() / 1000) - 3600;
  expect(await verifier()(withToken(await token({ expiresAt: anHourAgo })))).toBeNull();
});

test('a token signed by another key is refused', async () => {
  expect(await verifier()(withToken(await token({ key: otherKey })))).toBeNull();
});

test('an unsigned token is refused', async () => {
  const unsigned = new UnsecuredJWT({ email: 'ops@example.test' })
    .setIssuer(`https://${TEAM_DOMAIN}`)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('5m')
    .encode();
  expect(await verifier()(withToken(unsigned))).toBeNull();
});

test('a token that is not a JWT at all is refused', async () => {
  expect(await verifier()(withToken('not-a-token'))).toBeNull();
});

test('a valid token for an email that is not staff is refused', async () => {
  expect(await verifier()(withToken(await token({ email: 'stranger@example.test' })))).toBeNull();
});

test('a valid token for inactive staff is refused', async () => {
  expect(await verifier()(withToken(await token({ email: 'gone@example.test' })))).toBeNull();
});

test('a valid token without an email is refused', async () => {
  const noEmail = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(`https://${TEAM_DOMAIN}`)
    .setAudience(AUDIENCE)
    .setExpirationTime('5m')
    .sign(signingKey);
  expect(await verifier()(withToken(noEmail))).toBeNull();
});

test('X-Dev-Staff-Email signs in active staff on a local machine only', async () => {
  expect(await verifier('local')(withHeaders({ 'X-Dev-Staff-Email': 'ops@example.test' }))).toEqual(operations);
  expect(await verifier('local')(withHeaders({ 'X-Dev-Staff-Email': 'gone@example.test' }))).toBeNull();
  expect(await verifier('local')(withHeaders({ 'X-Dev-Staff-Email': 'stranger@example.test' }))).toBeNull();
});

test.each(['test', 'preview', 'staging', 'production'] as const)('X-Dev-Staff-Email is ignored in %s', async (env) => {
  expect(await verifier(env)(withHeaders({ 'X-Dev-Staff-Email': 'ops@example.test' }))).toBeNull();
});
