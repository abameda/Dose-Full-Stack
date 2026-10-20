import { describe, expect, test } from 'vitest';
import { ENV_IDENTITY_PATTERN, readEnvIdentity, setEnvIdentity } from '../src/env-identity';
import { withTestDb } from './harness';

const VALID = ['production', 'nonprod:seed', 'nonprod:staging', 'nonprod:poc', 'nonprod:preview/pr-1', 'nonprod:preview/pr-123'];
const INVALID = [
  '',
  'prod',
  'Production',
  'production ',
  'nonprod',
  'nonprod:',
  'nonprod:production',
  'nonprod:preview',
  'nonprod:preview/pr-0',
  'nonprod:preview/pr-01',
  'nonprod:preview/pr-',
  'nonprod:preview/pr-1a',
  'nonprod:seed\n',
  'production\nnonprod:seed',
];

describe('env_identity', () => {
  test('a fresh migration leaves it empty', async () => {
    const { owner } = await withTestDb();
    expect(await readEnvIdentity(owner)).toBeNull();
  });

  test.each(VALID)('the database accepts "%s"', async (name) => {
    const { owner } = await withTestDb();
    await owner.query(`insert into env_identity (name) values ($1)`, [name]);
    expect(await readEnvIdentity(owner)).toBe(name);
  });

  test.each(INVALID)('the database refuses %j', async (name) => {
    const { owner } = await withTestDb();
    await expect(owner.query(`insert into env_identity (name) values ($1)`, [name])).rejects.toThrow(/env_identity_name_check/);
  });

  test('the TypeScript pattern agrees with the database check', async () => {
    const { owner } = await withTestDb();
    for (const name of [...VALID, ...INVALID]) {
      const accepted = await owner
        .query(`select $1::text ~ '^(production|nonprod:(seed|staging|poc|preview/pr-[1-9][0-9]*))$' as ok`, [name])
        .then(([row]) => (row as { ok: boolean }).ok);
      expect(ENV_IDENTITY_PATTERN.test(name), name).toBe(accepted);
    }
  });

  test('a second row is refused', async () => {
    const { owner } = await withTestDb();
    await owner.query(`insert into env_identity (name) values ('nonprod:seed')`);
    await expect(owner.query(`insert into env_identity (name) values ('nonprod:staging')`)).rejects.toThrow(/duplicate key|unique/);
    await expect(owner.query(`insert into env_identity (one, name) values (false, 'nonprod:staging')`)).rejects.toThrow(/check/);
    expect(await readEnvIdentity(owner)).toBe('nonprod:seed');
  });

  test('the app role can read it and nothing more', async () => {
    const { app, owner } = await withTestDb();
    await owner.query(`insert into env_identity (name) values ('nonprod:staging')`);
    expect(await readEnvIdentity(app)).toBe('nonprod:staging');
    await expect(app.query(`insert into env_identity (one, name) values (true, 'production') on conflict do nothing`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.query(`update env_identity set name = 'production'`)).rejects.toThrow(/permission denied/);
    await expect(app.query(`delete from env_identity`)).rejects.toThrow(/permission denied/);
    await expect(app.query(`truncate env_identity`)).rejects.toThrow(/permission denied/);
    expect(await readEnvIdentity(owner)).toBe('nonprod:staging');
  });

  describe('setEnvIdentity', () => {
    test('inserts the row, then changes it in place', async () => {
      const { owner } = await withTestDb();
      await setEnvIdentity(owner, 'nonprod:staging');
      expect(await readEnvIdentity(owner)).toBe('nonprod:staging');
      await setEnvIdentity(owner, 'nonprod:preview/pr-7');
      expect(await readEnvIdentity(owner)).toBe('nonprod:preview/pr-7');
      expect(await owner.query(`select 1 from env_identity`)).toHaveLength(1);
    });

    test('refuses an invalid name without touching the database', async () => {
      const { owner } = await withTestDb();
      await expect(setEnvIdentity(owner, 'prod')).rejects.toThrow(/not a valid environment identity/);
      expect(await readEnvIdentity(owner)).toBeNull();
    });
  });
});

describe('diag_writes', () => {
  test('the app role can insert and read, and never delete', async () => {
    const { app } = await withTestDb();
    const [first] = await app.query<{ id: string }>(`insert into diag_writes (token) values ('a') returning id::text as id`);
    const [second] = await app.query<{ id: string }>(`insert into diag_writes (token) values ('b') returning id::text as id`);
    expect(Number(second?.id)).toBeGreaterThan(Number(first?.id));
    expect(await app.query(`select token from diag_writes order by id`)).toEqual([{ token: 'a' }, { token: 'b' }]);
    await expect(app.query(`delete from diag_writes`)).rejects.toThrow(/permission denied/);
    await expect(app.query(`truncate diag_writes`)).rejects.toThrow(/permission denied/);
  });
});
