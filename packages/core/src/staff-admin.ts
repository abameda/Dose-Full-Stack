import { ROLES, type Role } from '@dose/contract';
import type { Tx } from './db';

export interface StaffInput {
  /** An email address, or the client ID of a Cloudflare Access service token (stored in the `email` column). */
  identity: string;
  name: string;
  role: string;
}

/**
 * Adds a staff member, or brings the one with this identity (compared without regard to case) up
 * to date: name and role are set and the member is made active. Returns whether a row was created.
 * Owner role only: the application role cannot be used to grant itself staff.
 */
export async function upsertStaff(db: Tx, input: StaffInput): Promise<'created' | 'updated'> {
  const identity = input.identity.trim();
  const name = input.name.trim();
  const role: Role | undefined = ROLES.find((r) => r === input.role);
  if (identity === '') throw new Error('identity must not be empty');
  if (name === '') throw new Error('name must not be empty');
  if (role === undefined) throw new Error(`role must be one of ${ROLES.join(', ')}; got "${input.role}"`);

  const [row] = await db.query<{ created: boolean }>(
    `insert into staff (email, name, role) values ($1, $2, $3)
     on conflict (email) do update set name = excluded.name, role = excluded.role, active = true
     returning (xmax = 0) as created`,
    [identity, name, role],
  );
  if (row === undefined) throw new Error('staff upsert returned no row');
  return row.created ? 'created' : 'updated';
}
