-- 0005: staff who sign in to the admin through Cloudflare Access. Access proves the email; this
-- table says whether that email belongs to active staff and in which role (decision 0002: owner,
-- operations, marketing, accountant). The email compares without regard to case, because Access
-- reports it as the person typed it.

-- citext is a trusted extension, so the database owner (dose_owner) may create it.
create extension if not exists citext;

create table staff (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  name text not null check (length(trim(name)) > 0),
  role text not null check (role in ('owner', 'operations', 'marketing', 'accountant')),
  -- Staff who leave are deactivated, never deleted: their name stays on the audit log.
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Application role: the default grant of decision 0007, never DELETE.
grant select, insert, update on staff to dose_app;
