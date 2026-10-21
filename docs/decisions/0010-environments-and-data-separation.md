# 0010 - Environments and data separation

- **Status:** accepted (Milestone 1 Task 17, 2026-10-21); evidence below is completed as each environment is proven
- **Date:** 2026-10-21
- **Numbering:** the Milestone 1 plan calls this record `0006`; 0006–0009 were already taken when it
  was written, so the owner asked for `0010`. Migration `0006_env_identity.sql` keeps its number.
- **Builds on:** 0007 (app-role privileges), 0008 (DÖSE's own Cloudflare account), 0009 (free tiers),
  0011 (no R2 in Milestone 1).

## Context

Master plan section E fixes four environments (local, a preview per change, staging, production) and
two rules: no real customer data leaves production, and preview databases are never copied from it.
Section G asks for a test proving that a preview cannot reach production data. Milestone 1 has no
customers, so production is an empty, migrated database with nothing bound to it.

## Decision

**Two Neon projects, so no non-production credential can reach production.** Both in the DÖSE-owned
Neon organisation "Abdelhmeed" (`org-muddy-sea-89554723`, managed in the Neon console, not the
Vercel-managed organisation on the same login), region `aws-eu-central-1` (Frankfurt), Postgres 18,
database `dose`, owner role `dose_owner` created with the project.

| Project | ID | Branches | Holds |
| --- | --- | --- | --- |
| `dose-production` | `dark-leaf-88608542` | `main` | Migrated, empty. `env_identity = production`. No Worker or Hyperdrive config points at it in Milestone 1 |
| `dose-nonprod` | `little-bonus-28400697` | `main` → `seed` → `staging`, `poc`, `preview/pr-<n>` | `main`: migrated, empty. `seed`: the catalogue and stock (placeholder copy until O3), the owner as staff; no customers or orders. Every other branch is a copy-on-write child of `seed` |

**Roles.** Migrations run as `dose_owner`. The application connects as `dose_app` (created by
migration 0001; privileges in 0007). `dose_app` has a different password in each project: the
nonprod one is shared by every nonprod branch (branches inherit roles and passwords, belief B5) and
is the GitHub secret `DOSE_APP_PASSWORD_NONPROD`; the production one was generated for its single
migration run and discarded, so it exists nowhere (the owner can set a new one with `ALTER ROLE` from
the Neon console when production gets a Worker). A nonprod credential therefore fails authentication
against the production host, which the preview isolation test checks on every pull request.

**Each database says what it is.** Migration 0006 adds `env_identity` (one row; `dose_app` may only
read it). Rows: `production`, `nonprod:seed`, `nonprod:staging`, `nonprod:poc`,
`nonprod:preview/pr-<n>`, written by the owner CLI `pnpm env:identity` when a branch is created. A
Worker cannot see the real database host through Hyperdrive, so `GET /api/_diag/db-identity`
(non-production, staff only) asks the database.

**Cloudflare (DÖSE account `a61331a1643fa91a513c9cb775d7d619` only).**

| Resource | Name / ID | Notes |
| --- | --- | --- |
| Hyperdrive | `dose-staging` `50106e4cc55d4ce5bd26f93a1a5b49a0` | → `staging` as `dose_app`, caching disabled |
| Hyperdrive | `dose-poc` `16583f17bc9d45349915598b9ef8e5a5` | → `poc` as `dose_app`, caching disabled |
| Hyperdrive | `dose-pr-<n>` | one per open pull request, created and deleted by the preview workflows |
| Worker | `dose-web-staging` | env `staging`; workers.dev; preview URLs on; cron every 5 minutes; placement `aws:eu-central-1` |
| Worker | `dose-web-poc` | env `poc`; no cron; Milestone 1 only |
| Previews | versions of `dose-web-staging` with alias `pr-<n>` | own Hyperdrive binding, `ENVIRONMENT=preview` |
| Access | one application per Worker, whole host incl. previews | one-time PIN for the owner's email; a Service Auth policy for the `dose-ci` service token |
| R2 | none in Milestone 1 | decision 0011 |

There is no `production` Worker environment in Milestone 1; the top level of `wrangler.jsonc` is the
local default and fails closed as `production`.

**Who is staff where.** `staff` rows live in the database, so each environment has its own: `seed`
holds the owner (`abdelhmeed.mohsen@gmail.com`, owner) and the Access service token (its client ID,
owner role, nonprod only, for CI and the proof-of-concept runner), and every child inherits them.
Production has no staff in Milestone 1. Local development keeps the `@example.test` staff, which
`pnpm seed` writes only to a database on the developer's machine.

**GitHub.** Secrets (credentials): `CLOUDFLARE_API_TOKEN` (DÖSE account only: Workers Scripts,
Hyperdrive and Workers KV edit, Account Settings read), `NEON_API_KEY` (scoped to `dose-nonprod`),
`DOSE_APP_PASSWORD_NONPROD`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`. Variables (not
secret): `CLOUDFLARE_ACCOUNT_ID`, `NEON_NONPROD_PROJECT_ID`, `NEON_PROD_PROJECT_ID`, `PROD_DB_HOST`,
`STAGING_URL`, `WORKERS_SUBDOMAIN`, `E2E_STAFF_NAME`. No production database credential is stored in
GitHub. The plan's `NONPROD_OWNER_URL` secret is not used: workflows ask the Neon API for each
branch's owner connection string with the project-scoped key.

## Consequences

- A leaked nonprod secret cannot read or change production data: different Neon project, different
  `dose_app` password, a project-scoped Neon key, and no production credential in CI.
- Neon Free allows 10 branches per project: `main`, `seed`, `staging` and `poc` leave room for about
  six open previews; Hyperdrive Free allows 10 configs (two fixed, one per preview). Previews are
  cleaned up when their pull request closes.
- Staging is deployed from `main` by `.github/workflows/staging.yml` after CI passes, and tops up its
  stock each run (`pnpm stock:receive`).
- The owner's real email is in the nonprod `staff` table: staff data, not customer data.
- Moving production to its own Worker later needs: a production Hyperdrive config, a new `dose_app`
  password set by the owner, a production Access application, and a record superseding this one.

## Evidence

- B5 (roles, grants and inheritance on Neon): `0003-milestone-1-beliefs.md`.
- Row counts on 2026-10-21 (owner role): `dose-production/main` every table empty except
  `schema_migrations` (6), `env_identity = production`; `dose-nonprod/seed` and `/staging` 2 products,
  2 variants, 2 stock movements, 1 staff, 0 customers, 0 orders.
- `wrangler hyperdrive get` for both configs: user `dose_app`, `caching.disabled: true`.
- Staging deploy, Access and preview evidence: added in Tasks 17–18 below.
