# 0003 - Milestone 1 beliefs and their evidence

- **Status:** open (each belief is closed by the task named below; Task 20 closes the record)
- **Date:** 2026-10-20

> Numbering: the app-role privileges record was first written as `0003-app-role-privileges.md`
> during Task 3, before this record existed. The plan names this file `0003-milestone-1-beliefs.md`
> and reserves 0003-0006, so that record is now `0007-app-role-privileges.md`.

## Context

The Milestone 1 plan rests on beliefs about Cloudflare, Neon, Fly.io and Astro that the
documentation suggests but no one here has measured. Each one is verified in a named task, with the
evidence recorded here. A belief that fails gets a note on what it changes.

## Beliefs

| # | Belief | Verified in | Result | Evidence |
| --- | --- | --- | --- | --- |
| B1 | A Worker can be placed near Frankfurt (explicit placement hint for `aws:eu-central-1`) | Task 17 | open | |
| B2 | Hyperdrive caches read queries by default, and disabling caching gives read-your-writes | Task 17 | open | |
| B3 | Hyperdrive's transaction-mode pooling keeps a multi-statement transaction on one connection | Task 17 | open | |
| B4 | 200 concurrent checkout transactions through Hyperdrive queue rather than fail when they exceed origin connections | Task 19 | open | |
| B5 | Neon accepts `CREATE ROLE` and `GRANT/REVOKE` in SQL, and branches inherit those roles and privileges | Task 17 | holds | See B5 below |
| B6 | A Worker preview version can carry its own Hyperdrive binding, and the account's Hyperdrive config limit covers the open pull requests | Task 18 | open | |
| B7 | Cloudflare Access can protect the Worker's `workers.dev` and preview URLs | Task 18 | open | |
| B8 | Access one-time-PIN login works inside Instagram's in-app browser on iOS and Android | Task 20 | open | |
| B9 | Astro's client router keeps `transition:persist` elements (bag, canvas) alive inside Instagram's browser on iOS and Android | Task 20 | open | |
| B10 | `pg` runs on Workers with `nodejs_compat` through the Astro Cloudflare adapter | Task 12 (local); Task 17 (Cloudflare) | holds locally | See B10 below |
| B11 | Neon and Fly.io list prices match the plan's cost table | Task 17 | holds (with a note) | See B11 below |

### B10 - `pg` on Workers through the Astro Cloudflare adapter (local evidence)

- **Setup:** `apps/web` built with Astro 7.3.5 and `@astrojs/cloudflare` 14.3.3 (`astro build`), served by `wrangler dev` 4.147.0 (workerd 1.20261001.1) with `compatibility_flags: ["nodejs_compat"]` and `compatibility_date` 2026-10-01. The Hyperdrive binding `HYPERDRIVE` uses its local connection string to the docker-compose Postgres 18 as `dose_app`. `pg` 8.23.1 is bundled into the Worker (its Workers socket path, `pg-cloudflare` over `cloudflare:sockets`, is in the build output); `@dose/core`'s `createRequestDb` opens one `pg.Client` per request on `env.HYPERDRIVE.connectionString`.
- **Test:** `e2e/shell.spec.ts`, `the API answers through the Worker from the seeded database (B10)`: `GET /api/products?lang=ar` through the Worker returns Paradise and Blanc from the seeded `dose_e2e` database. The development database `dose` was not even migrated at the time, so the rows can only have come through the binding. The cron test (`/cdn-cgi/handler/scheduled`) also ran the expiry and outbox queries through the same path.
- **Result:** passes on both Playwright projects (`iphone`, WebKit; `pixel`, Chromium) on 2026-10-20: 22 of 22 tests in the spec.
- **Still open:** this is miniflare's Hyperdrive simulation, which connects straight to Postgres. Task 17 confirms it on Cloudflare with a real Hyperdrive config in front of Neon.

### B5 - Neon roles and privileges, and branches inheriting them (2026-10-21)

- **Setup:** Neon project `dose-nonprod` (`little-bonus-28400697`, `aws-eu-central-1`, Postgres 18.6), database `dose` owned by `dose_owner` (created with the project through the Neon API; a member of `neon_superuser`, not a superuser). The repository's `migrate()` ran migrations 0001-0005 on branch `main` as `dose_owner`, with `DOSE_APP_PASSWORD` set to a generated 40-character password.
- **Test:** migration 0001 ran `create role dose_app login password …`, the grants and the `revoke update, delete, truncate on audit_events from dose_app` without error. A fresh child branch `b5-check` was then created from `main`, and on it: `checkRules` (all rules built so far, rule 12 included) as the owner returned no violations; `has_table_privilege('dose_app', 'audit_events', …)` was true for SELECT and INSERT and false for UPDATE, DELETE and TRUNCATE; `dose_app` logged in to the child with the password set on the parent, inserted an audit event, and `update`, `delete` and `truncate` on `audit_events` were each refused with `42501 permission denied for table audit_events`.
- **Result:** holds. The child branch was deleted afterwards. The same migrations later ran on `dose-production` (separate project, different `dose_app` password) and on `main` again for migration 0006, also without error.
- **Note:** creating `dose_app` makes `dose_owner` a member of it (Postgres 16+ grants the creating role membership). That is expected and gives the app role nothing.

### B11 - Neon and Fly.io prices against the plan's cost table (2026-10-21)

Read on 2026-10-21 from neon.com/pricing, neon.com/docs/introduction/plans and docs.fly.io/about/pricing.

| Plan line | Plan says | Price found | Within range? |
| --- | --- | --- | --- |
| Neon Launch plan (production at launch) | About $19-25 a month | Usage-based, no monthly minimum: compute $0.106 per CU-hour, storage $0.35 per GB-month. A 0.25 CU compute always on is 0.25 x 730 h x $0.106 = about $19.35, plus storage (well under 1 GB, under $0.35) | Yes |
| Neon preview branches | Ten included, then about $1.50 each | 10 branches per project on Free and Launch; extra branches $1.50 per branch-month on Launch (not available on Free) | Yes |
| Neon Free (Milestone 1, decision 0009) | - | 100 projects, 10 branches per project, 100 CU-hours per project a month, 1 GB storage per project, scale to zero after 5 minutes (cannot be turned off), up to 2 CU | Fits Milestone 1 |
| Fly.io (the Node control container) | Fallback only; no line in the cost table | No free tier for new organisations; a trial of up to 2 hours of machine runtime or 7 days, no card needed to start; shared-cpu-1x 256 MB $2.19/month, 512 MB $3.69/month, 1 GB in Frankfurt $7.73/month | No plan figure to exceed |

- **Result:** holds. Nothing exceeds the plan's range. **Note:** the Neon Launch plan is now pay-as-you-go rather than a fixed monthly fee, so the launch-time figure depends on compute hours; an always-on compute lands at the bottom of the plan's range. The Fly.io trial's 2 machine-hours is the binding limit for Task 19 (decision 0009).
