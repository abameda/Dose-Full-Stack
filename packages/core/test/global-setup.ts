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

async function buildTemplate(): Promise<void> {
  const admin = createRequestDb(adminUrl());
  try {
    await dropTestDatabases(admin);
    await admin.query(`create database ${quoteIdent(TEMPLATE_DB)}`);
  } finally {
    await admin.close();
  }
  await migrate(ownerUrlFor(TEMPLATE_DB));
}

/**
 * Every database-backed project (core, api, web) names this file as its global setup, so a run
 * of any one of them has a template. Vitest runs each project's global setup in its main process,
 * so the projects share this state: the first setup builds the template and the others wait for
 * it, and the last teardown removes it. (Without this, each project rebuilt the template.)
 */
type Shared = { built: Promise<void>; users: number };
const state = globalThis as { doseTestTemplate?: Shared | undefined };

/**
 * Runs before the Vitest run: rebuilds `dose_test_template` from the migrations, so every test
 * database cloned from it (see harness.ts) starts fully migrated. Databases left by an earlier
 * crashed run are removed first. Run one Vitest process at a time per Postgres server.
 */
export async function setup(): Promise<void> {
  const shared = (state.doseTestTemplate ??= { built: buildTemplate(), users: 0 });
  shared.users += 1;
  await shared.built;
}

/** Runs after the Vitest run: the last project to finish removes the template and any database a test left behind. */
export async function teardown(): Promise<void> {
  const shared = state.doseTestTemplate;
  if (shared !== undefined) {
    shared.users -= 1;
    if (shared.users > 0) return;
    state.doseTestTemplate = undefined;
  }
  const admin = createRequestDb(adminUrl());
  try {
    await dropTestDatabases(admin);
  } finally {
    await admin.close();
  }
}
