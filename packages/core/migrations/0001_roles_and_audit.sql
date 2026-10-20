-- 0001: the application role, migration history and the append-only audit log.
-- Runs as the owner role (dose_owner). Rule 12: the app role can never UPDATE, DELETE or
-- TRUNCATE audit events.

-- The password arrives as the transaction setting dose.app_password (see migrate.ts), so it
-- never appears in a committed file. Roles are cluster-wide: if dose_app already exists (another
-- database on the same server, a new test database), it is left as it is.
do $$
declare
  pw text := nullif(current_setting('dose.app_password', true), '');
begin
  if not exists (select 1 from pg_roles where rolname = 'dose_app') then
    if pw is null then
      raise exception 'DOSE_APP_PASSWORD must be set to create the dose_app role on a non-local database';
    end if;
    execute format('create role dose_app login password %L', pw);
  end if;
end
$$;

grant usage on schema public to dose_app;

-- Applied-migration history. Deliberately NOT granted to dose_app: it is the one table a
-- migration creates that the app role gets no access to, because a compromised app must not be
-- able to read or rewrite migration history (docs/decisions/0007-app-role-privileges.md).
create table schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);

create table audit_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_type text not null check (actor_type in ('customer', 'staff', 'system')),
  actor_id text,
  action text not null,
  entity text,
  entity_id text,
  entity_version int,
  reason text,
  data jsonb not null default '{}'
);

-- Insert-only for the app role. The explicit revoke documents the intent and also removes
-- anything granted through PUBLIC or default privileges.
revoke all on audit_events from public;
revoke update, delete, truncate on audit_events from dose_app;
grant select, insert on audit_events to dose_app;
grant usage on sequence audit_events_id_seq to dose_app;
