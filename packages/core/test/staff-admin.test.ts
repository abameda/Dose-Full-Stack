import { describe, expect, test } from 'vitest';
import { upsertStaff } from '../src/staff-admin';
import { withTestDb } from './harness';

const CLIENT_ID = '0123456789abcdef0123456789abcdef.access';

describe('upsertStaff', () => {
  test('creates a staff member, active, with the role', async () => {
    const { owner } = await withTestDb();
    expect(await upsertStaff(owner, { identity: 'sam@example.test', name: 'Sam', role: 'marketing' })).toBe('created');
    expect(await owner.query(`select email::text as email, name, role, active from staff`)).toEqual([
      { email: 'sam@example.test', name: 'Sam', role: 'marketing', active: true },
    ]);
  });

  test('updates the member with the same email (any case), reactivating them', async () => {
    const { owner } = await withTestDb();
    await upsertStaff(owner, { identity: 'sam@example.test', name: 'Sam', role: 'marketing' });
    await owner.query(`update staff set active = false`);
    expect(await upsertStaff(owner, { identity: 'SAM@Example.TEST', name: 'Samira', role: 'accountant' })).toBe('updated');
    const rows = await owner.query(`select email::text as email, name, role, active from staff`);
    expect(rows).toEqual([{ email: 'sam@example.test', name: 'Samira', role: 'accountant', active: true }]);
  });

  test('stores an Access service-token client ID as the identity', async () => {
    const { owner } = await withTestDb();
    expect(await upsertStaff(owner, { identity: CLIENT_ID, name: 'Deploy check', role: 'owner' })).toBe('created');
    expect(await owner.query(`select email::text as email from staff`)).toEqual([{ email: CLIENT_ID }]);
  });

  test('trims the identity and name', async () => {
    const { owner } = await withTestDb();
    await upsertStaff(owner, { identity: '  sam@example.test ', name: ' Sam ', role: 'owner' });
    expect(await owner.query(`select email::text as email, name from staff`)).toEqual([{ email: 'sam@example.test', name: 'Sam' }]);
  });

  test.each([
    [{ identity: '', name: 'Sam', role: 'owner' }, /identity/],
    [{ identity: '  ', name: 'Sam', role: 'owner' }, /identity/],
    [{ identity: 'sam@example.test', name: ' ', role: 'owner' }, /name/],
    [{ identity: 'sam@example.test', name: 'Sam', role: 'superuser' }, /role must be one of/],
  ])('refuses %j', async (input, message) => {
    const { owner } = await withTestDb();
    await expect(upsertStaff(owner, input)).rejects.toThrow(message);
    expect(await owner.query('select 1 from staff')).toHaveLength(0);
  });
});
