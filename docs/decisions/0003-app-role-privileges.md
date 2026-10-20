# 0003 - Privileges of the application database role

- **Status:** accepted (controller ruling, Milestone 1 Task 3 review, 2026-10-20)
- **Date:** 2026-10-20

## Context

Migrations run as `dose_owner`; the application connects as `dose_app`. The Milestone 1 plan says every migration grants `dose_app` `SELECT, INSERT, UPDATE` on the tables it creates and `USAGE` on their sequences, and never `DELETE`. Migration 0001 creates two tables that do not fit that rule as written: `audit_events` and `schema_migrations`.

## Decision

| Table | `dose_app` privileges | Why |
| --- | --- | --- |
| Tables created by a migration (default) | `SELECT, INSERT, UPDATE`, plus `USAGE` on their sequences; never `DELETE` | The default grant rule |
| `audit_events` | `SELECT, INSERT` only; `UPDATE, DELETE, TRUNCATE` revoked | Rule 12: the audit log is append-only for the app role |
| `schema_migrations` | none | Only the owner reads or writes migration history. Granting `UPDATE` would let a compromised app rewrite it |

A later migration that adds a table follows the default row unless a decision record adds another exemption. The tests in `packages/core/test/db.test.ts` pin the `audit_events` and `schema_migrations` rows.
