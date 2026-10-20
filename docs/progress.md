# Progress

## 2026-10-20
- Repository set up and connected to github.com/abameda/Dose-Full-Stack (branch `main`).
- Master plan moved to `docs/master-plan.md`; `CLAUDE.md`, `docs/decisions/` and this log created.
- `docs/milestones.md` (M1 to launch) and the Milestone 1 plan (`docs/plans/2026-10-20-milestone-1-foundation-and-proof.md`) drafted.
- **Waiting on the owner:** approval of the milestone map, the M1 plan and its interpretations table (O1); accounts (O2); product copy and photos (O3).
- No application code written; no cloud accounts created; doseeg.com, Paymob and Bosta untouched.
- Task 1 (Monorepo, toolchain and CI quality gate): pnpm workspace, strict TypeScript, ESLint and Vitest in place; `pnpm check` runs typecheck, lint and tests; `@dose/core` money (`assertPiastres`, `formatEgp`) is tested; CI workflow added.
- Task 2 (Enforced code boundaries): `pnpm boundaries` (in `pnpm check`) fails the build when a direction imports `@dose/core`, `@dose/api`, `pg` or another direction, or when `ui`, `shop`, `contract`, `admin` or `core` break their import rules; package skeletons for `@dose/contract`, `@dose/ui`, `@dose/shop`, `@dose/d0-baseline` and `@dose/x1-studio` exist.
- Task 3 (Postgres, migrations, roles and the test-database harness): `docker compose up -d` starts local Postgres on port 54329; `migrate` applies SQL files as `dose_owner`; migration 0001 creates the `dose_app` role and an audit log it can only read and insert into; tests get a fresh migrated database in milliseconds (`withTestDb`); CI runs a Postgres service container.
- Task 4 (Catalogue and stock ledger): products, images and variants exist in the database; stock changes only through an append-only movement ledger (receive, reserve, release, sell, adjust) that is idempotent by source key and refuses over-reserving, with the published catalogue readable including free stock.
- Task 5 (Orders, payments, state machines and audit): customers, orders, order lines, payments, reservations, delivery fees and settings tables exist with database checks that refuse totals that do not add up; orders get numbers `D10001` onward; order and payment state machines, `writeAudit`, `priceBag` (property-tested) and the 27 governorates are in `@dose/core`.
- Task 6 (Cash-on-delivery checkout): `placeCodOrder` places a cash-on-delivery order in one transaction (re-priced from the database, stock reserved in a fixed variant order, idempotent by checkout key, refused in the studio); Egyptian mobile numbers normalise to E.164 from Arabic-Indic digits and any common prefix; 200 simultaneous checkouts for 10 units give exactly 10 orders in each of 100 runs.
