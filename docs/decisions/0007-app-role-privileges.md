# 0007 - Privileges of the application database role

- **Status:** accepted (controller ruling, Milestone 1 Task 3 review, 2026-10-20; the `stock_movements` and `webhook_receipts` rows ratified by the owner-side controller, 2026-10-20)
- **Date:** 2026-10-20

> Numbering: this record was first written as `0003-app-role-privileges.md` during Task 3. The
> Milestone 1 plan reserves 0003-0006 (beliefs, runtime, storefront, environments), so it was
> renumbered 0007 after the whole-branch review. Nothing else about it changed with the number.

## Context

Migrations run as `dose_owner`; the application connects as `dose_app`. The Milestone 1 plan names only the `audit_events` grants (Task 3: `SELECT, INSERT`, with `UPDATE, DELETE, TRUNCATE` revoked). The general rule came from a controller ruling at the Task 3 review: every migration grants `dose_app` `SELECT, INSERT, UPDATE` on the tables it creates and `USAGE` on their sequences, and never `DELETE`. Migration 0001 creates two tables that do not fit that rule as written: `audit_events` and `schema_migrations`.

## Decision

| Table | `dose_app` privileges | Why |
| --- | --- | --- |
| Tables created by a migration (default) | `SELECT, INSERT, UPDATE`, plus `USAGE` on their sequences; never `DELETE` | The controller ruling's default grant |
| `audit_events` | `SELECT, INSERT` only; `UPDATE, DELETE, TRUNCATE` revoked | Rule 12: the audit log is append-only for the app role |
| `schema_migrations` | none | Only the owner reads or writes migration history. Granting `UPDATE` would let a compromised app rewrite it |
| `stock_movements` (migration 0002) | `SELECT, INSERT` only, plus `USAGE` on its sequence | Rule 5: the stock ledger is append-only, and stock levels must equal the sum of its deltas. No code updates a movement; the ledger is written with `insert ... on conflict (source_key) do nothing`, which needs only `INSERT` |
| `webhook_receipts` (migration 0004) | `SELECT, INSERT` only, plus `USAGE` on its sequence | Rule 8: the receipt is the record that a provider event was applied once. No code updates a receipt; `ingestEvent` uses `insert ... on conflict do nothing` |
| `env_identity` (migration 0006) | `SELECT` only | The table says which database this is (`production` or `nonprod:...`). Only the owner role sets it (`pnpm env:identity`); the app must not be able to claim to be another database |

A later migration that adds a table follows the default row unless a decision record adds another exemption. The tests in `packages/core/test/db.test.ts` pin the `audit_events` and `schema_migrations` rows; `stock.test.ts` and `webhooks.test.ts` pin the `stock_movements` and `webhook_receipts` rows, `env-identity.test.ts` pins the `env_identity` row, and the rule checker reports `UPDATE` (on the table or any column), `DELETE` or `TRUNCATE` on any of the three append-only tables (rules 5, 8 and 12).

The `stock_movements` and `webhook_receipts` rows were added on 2026-10-20 after the Milestone 1 whole-branch review (finding 2), before any migration had been applied outside local and CI, so migrations 0002 and 0004 were edited in place rather than amended by a new migration. They narrow the controller ruling's default grant. The owner-side controller ratified them (`SELECT, INSERT` only on both tables) on 2026-10-20, when it closed the review's open findings before Task 17.
