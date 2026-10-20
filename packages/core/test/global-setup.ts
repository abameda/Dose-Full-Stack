import { createRequestDb, type Db } from '../src/db';
import { migrate } from '../src/migrate';
import { adminUrl, ownerUrlFor, quoteIdent, TEMPLATE_DB, TEST_DB_PREFIX } from './db-config';

async function dropTestDatabases(admin: Db): Promise<void> {
  const rows = await admin.query<{ datname: string }>(
    `select datname from pg_database where datname like $1`,
    [`${TEST_DB_PREFIX.replaceAll('_', '\\_')}%`],
  );
  for (const { datname } of rows) {
    await admin.query(`drop database if exists ${quoteIdent(datname)} with (force)`);
  }
}

/**
 * Runs once before the Vitest run: rebuilds `dose_test_template` from the migrations, so
 * every test database cloned from it (see harness.ts) starts fully migrated. Databases left by
 * an earlier crashed run are removed first. Run one Vitest process at a time per Postgres server.
 */
export async function setup(): Promise<void> {
  const admin = createRequestDb(adminUrl());
  try {
    await dropTestDatabases(admin);
    await admin.query(`create database ${quoteIdent(TEMPLATE_DB)}`);
  } finally {
    await admin.close();
  }
  await migrate(ownerUrlFor(TEMPLATE_DB));
}

/** Runs once after the Vitest run: removes the template and any database a test left behind. */
export async function teardown(): Promise<void> {
  const admin = createRequestDb(adminUrl());
  try {
    await dropTestDatabases(admin);
  } finally {
    await admin.close();
  }
}
