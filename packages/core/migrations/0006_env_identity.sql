-- 0006: what this database is, and a table the read-your-writes diagnostic writes to.

-- env_identity names the database (names such as production, or nonprod:<which>) so a
-- tool or a staff member can tell which one a connection string points at. At most one row.
-- Set by the owner CLI (`pnpm env:identity`), never by the app: dose_app can only read it, so a
-- compromised app cannot claim to be another database (decision 0007: an exemption from the
-- default grant).
create table env_identity (
  one boolean primary key default true check (one),
  name text not null check (name ~ '^(production|nonprod:(seed|staging|poc|preview/pr-[1-9][0-9]*))$')
);
grant select on env_identity to dose_app;

-- diag_writes: one row per write of the read-your-writes diagnostic (/api/_diag/read-your-writes).
-- Default grant of decision 0007, never DELETE.
create table diag_writes (
  id bigserial primary key,
  token text not null,
  at timestamptz not null default now()
);
grant select, insert, update on diag_writes to dose_app;
grant usage on sequence diag_writes_id_seq to dose_app;
