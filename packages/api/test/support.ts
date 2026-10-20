import type { Db } from '@dose/core/db';
import type { TestDb } from '@dose/core/test-harness';
import { createApp, type ApiDeps } from '../src/app';

export const NOW = new Date('2026-10-20T10:00:00.000Z');

/** The shared test pool, with `close` turned off: the app closes the Db it gets after every request. */
function perRequest(app: Db): () => Db {
  return () => ({ ...app, close: () => Promise.resolve() });
}

/** An app wired to the test database as `dose_app`, exactly as production wires it. */
export function makeTestApp(db: TestDb, overrides: Partial<ApiDeps> = {}) {
  return createApp({
    db: perRequest(db.app),
    env: 'test',
    now: () => NOW,
    verifyStaff: () => Promise.resolve(null),
    webhookProviders: {},
    ...overrides,
  });
}

export function postJson(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://dose.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
