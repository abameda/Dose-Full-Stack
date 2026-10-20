import { randomBytes } from 'node:crypto';
import { afterAll } from 'vitest';
import { createPoolDb, createRequestDb, type Db } from '../src/db';
import { adminUrl, appUrlFor, ownerUrlFor, quoteIdent, TEMPLATE_DB, TEST_DB_PREFIX } from './db-config';

export interface TestDb {
  /** Connected as `dose_app`, exactly like production code. */
  app: Db;
  /** Connected as `dose_owner`: for arranging data, reading privileges, or corrupting a rule on purpose. */
  owner: Db;
  appUrl: string;
  ownerUrl: string;
  /** Closes both connections and drops the database. Safe to call twice. */
  drop(): Promise<void>;
}

const created: TestDb[] = [];

// Every database made through withTestDb is dropped when the test file that made it finishes,
// even when the test never calls drop(). (global-setup.ts sweeps anything a crash leaves behind.)
afterAll(async () => {
  await Promise.all(created.splice(0).map((db) => db.drop()));
});

/**
 * A fresh, migrated database for one test (or one test file), cloned from `dose_test_template`
 * with CREATE DATABASE ... TEMPLATE, so it costs milliseconds. Needs the Postgres from
 * docker-compose.yml; global-setup.ts builds the template.
 */
export async function withTestDb(): Promise<TestDb> {
  const name = `${TEST_DB_PREFIX}${randomBytes(8).toString('hex')}`;

  const admin = createRequestDb(adminUrl());
  try {
    await admin.query(`create database ${quoteIdent(name)} template ${quoteIdent(TEMPLATE_DB)}`);
  } finally {
    await admin.close();
  }

  const ownerUrl = ownerUrlFor(name);
  const appUrl = appUrlFor(name);
  const app = createPoolDb(appUrl, { max: 4 });
  const owner = createPoolDb(ownerUrl, { max: 4 });
  let dropped = false;

  const db: TestDb = {
    app,
    owner,
    appUrl,
    ownerUrl,
    async drop() {
      if (dropped) return;
      dropped = true;
      await Promise.all([app.close(), owner.close()]);
      const dropper = createRequestDb(adminUrl());
      try {
        await dropper.query(`drop database if exists ${quoteIdent(name)} with (force)`);
      } finally {
        await dropper.close();
      }
    },
  };
  created.push(db);
  return db;
}
