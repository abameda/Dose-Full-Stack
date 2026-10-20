# 0003 - Milestone 1 beliefs and their evidence

- **Status:** open (each belief is closed by the task named below; Task 20 closes the record)
- **Date:** 2026-10-20

> Numbering: `0003-app-role-privileges.md` was written under the same number during Task 3, before
> this record existed. The Milestone 1 plan names this file `0003-milestone-1-beliefs.md`, and later
> tasks update it by that name, so both keep 0003.

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
| B5 | Neon accepts `CREATE ROLE` and `GRANT/REVOKE` in SQL, and branches inherit those roles and privileges | Task 17 | open | |
| B6 | A Worker preview version can carry its own Hyperdrive binding, and the account's Hyperdrive config limit covers the open pull requests | Task 18 | open | |
| B7 | Cloudflare Access can protect the Worker's `workers.dev` and preview URLs | Task 18 | open | |
| B8 | Access one-time-PIN login works inside Instagram's in-app browser on iOS and Android | Task 20 | open | |
| B9 | Astro's client router keeps `transition:persist` elements (bag, canvas) alive inside Instagram's browser on iOS and Android | Task 20 | open | |
| B10 | `pg` runs on Workers with `nodejs_compat` through the Astro Cloudflare adapter | Task 12 (local); Task 17 (Cloudflare) | holds locally | See B10 below |
| B11 | Neon and Fly.io list prices match the plan's cost table | Task 17 | open | |

### B10 - `pg` on Workers through the Astro Cloudflare adapter (local evidence)

- **Setup:** `apps/web` built with Astro 7.3.5 and `@astrojs/cloudflare` 14.3.3 (`astro build`), served by `wrangler dev` 4.147.0 (workerd 1.20261001.1) with `compatibility_flags: ["nodejs_compat"]` and `compatibility_date` 2026-10-01. The Hyperdrive binding `HYPERDRIVE` uses its local connection string to the docker-compose Postgres 18 as `dose_app`. `pg` 8.23.1 is bundled into the Worker (its Workers socket path, `pg-cloudflare` over `cloudflare:sockets`, is in the build output); `@dose/core`'s `createRequestDb` opens one `pg.Client` per request on `env.HYPERDRIVE.connectionString`.
- **Test:** `e2e/shell.spec.ts`, `the API answers through the Worker from the seeded database (B10)`: `GET /api/products?lang=ar` through the Worker returns Paradise and Blanc from the seeded `dose_e2e` database. The development database `dose` was not even migrated at the time, so the rows can only have come through the binding. The cron test (`/cdn-cgi/handler/scheduled`) also ran the expiry and outbox queries through the same path.
- **Result:** passes on both Playwright projects (`iphone`, WebKit; `pixel`, Chromium) on 2026-10-20: 22 of 22 tests in the spec.
- **Still open:** this is miniflare's Hyperdrive simulation, which connects straight to Postgres. Task 17 confirms it on Cloudflare with a real Hyperdrive config in front of Neon.
