import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { createRequestDb } from '../src/db';
import { migrate } from '../src/migrate';
import { withTestDb } from './harness';

const insertAudit = `insert into audit_events (actor_type, actor_id, action, entity, entity_id) values ('system','t','x','order','1')`;

test('migrations are idempotent', async () => {
  const { ownerUrl } = await withTestDb();
  expect(await migrate(ownerUrl)).toEqual([]); // template already migrated
});

test('rule 12: the app role cannot alter audit events', async () => {
  const { app } = await withTestDb();
  await app.query(insertAudit);
  await expect(app.query(`update audit_events set action = 'y'`)).rejects.toThrow(/permission denied/);
  await expect(app.query(`delete from audit_events`)).rejects.toThrow(/permission denied/);
  await expect(app.query(`truncate audit_events`)).rejects.toThrow(/permission denied/);
});

test('a failed transaction leaves nothing behind', async () => {
  const { app } = await withTestDb();
  await expect(
    app.transaction(async (tx) => {
      await tx.query(insertAudit);
      throw new Error('boom');
    }),
  ).rejects.toThrow('boom');
  expect(await app.query(`select 1 from audit_events`)).toHaveLength(0);
});

describe('the migration', () => {
  test('records itself and keeps migration history owner-only (decision 0003: the one exemption from the app role grants)', async () => {
    const { app, owner } = await withTestDb();
    expect(await owner.query<{ name: string }>(`select name from schema_migrations order by name`)).toEqual([
      { name: '0001_roles_and_audit.sql' },
      { name: '0002_catalogue_and_stock.sql' },
      { name: '0003_orders.sql' },
      { name: '0004_webhooks_outbox.sql' },
      { name: '0005_staff.sql' },
    ]);
    await expect(app.query(`select 1 from schema_migrations`)).rejects.toThrow(/permission denied/);
  });

  test('audit events enforce the actor type', async () => {
    const { app } = await withTestDb();
    await expect(
      app.query(`insert into audit_events (actor_type, action) values ('robot','x')`),
    ).rejects.toThrow(/audit_events_actor_type_check/);
  });

  test('the app role can read and insert audit events and nothing more', async () => {
    const { owner } = await withTestDb();
    const [privileges] = await owner.query<Record<string, boolean>>(
      `select
         has_table_privilege('dose_app', 'audit_events', 'SELECT') as sel,
         has_table_privilege('dose_app', 'audit_events', 'INSERT') as ins,
         has_table_privilege('dose_app', 'audit_events', 'UPDATE') as upd,
         has_table_privilege('dose_app', 'audit_events', 'DELETE') as del,
         has_table_privilege('dose_app', 'audit_events', 'TRUNCATE') as trunc,
         has_sequence_privilege('dose_app', 'audit_events_id_seq', 'USAGE') as seq`,
    );
    expect(privileges).toEqual({ sel: true, ins: true, upd: false, del: false, trunc: false, seq: true });
  });
});

describe('migrate', () => {
  async function migrationsDir(files: Record<string, string>) {
    const dir = await mkdtemp(join(tmpdir(), 'dose-migrations-'));
    await mkdir(dir, { recursive: true });
    for (const [name, sql] of Object.entries(files)) await writeFile(join(dir, name), sql);
    return pathToFileURL(`${dir}/`);
  }

  test('applies new files in name order, each in its own transaction, and records them', async () => {
    const { owner, ownerUrl } = await withTestDb();
    const dir = await migrationsDir({
      '0003_c.sql': `create table c (n int); insert into c values (3);`,
      '0002_b.sql': `create table b (n int); insert into b values (2);`,
      '0001_roles_and_audit.sql': `this file was already applied and must not run again;`,
      'notes.txt': 'ignored',
    });
    expect(await migrate(ownerUrl, dir)).toEqual(['0002_b.sql', '0003_c.sql']);
    expect(await owner.query(`select n from b`)).toEqual([{ n: 2 }]);
    expect(await migrate(ownerUrl, dir)).toEqual([]);
  });

  test('a failing file rolls back completely, is not recorded, and stops later files', async () => {
    const { owner, ownerUrl } = await withTestDb();
    const dir = await migrationsDir({
      '0002_ok.sql': `create table ok (n int);`,
      '0003_bad.sql': `create table half (n int); select * from does_not_exist;`,
      '0004_never.sql': `create table never (n int);`,
    });
    await expect(migrate(ownerUrl, dir)).rejects.toThrow(/0003_bad\.sql/);
    expect(await owner.query(`select to_regclass('ok') as ok, to_regclass('half') as half, to_regclass('never') as never`)).toEqual([
      { ok: 'ok', half: null, never: null },
    ]);
    expect(await owner.query<{ name: string }>(`select name from schema_migrations order by name`)).toEqual([
      { name: '0001_roles_and_audit.sql' },
      { name: '0002_catalogue_and_stock.sql' },
      { name: '0002_ok.sql' },
      { name: '0003_orders.sql' },
      { name: '0004_webhooks_outbox.sql' },
      { name: '0005_staff.sql' },
    ]);
  });
});

describe('createRequestDb', () => {
  test('connects lazily, runs transactions on one connection and closes cleanly', async () => {
    const { appUrl } = await withTestDb();
    const db = createRequestDb(appUrl);
    await db.close(); // never connected: closing is a no-op
    const again = createRequestDb(appUrl);
    await again.transaction(async (tx) => {
      await tx.query(insertAudit);
    });
    expect(await again.query(`select 1 from audit_events`)).toHaveLength(1);
    await again.close();
  });
});
