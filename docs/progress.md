# Progress

## 2026-10-20
- Repository set up and connected to github.com/abameda/Dose-Full-Stack (branch `main`).
- Master plan moved to `docs/master-plan.md`; `CLAUDE.md`, `docs/decisions/` and this log created.
- `docs/milestones.md` (M1 to launch) and the Milestone 1 plan (`docs/plans/2026-10-20-milestone-1-foundation-and-proof.md`) drafted.
- **Waiting on the owner:** approval of the milestone map, the M1 plan and its interpretations table (O1); accounts (O2); product copy and photos (O3).
- No application code written; no cloud accounts created; doseeg.com, Paymob and Bosta untouched.
- Task 1 (Monorepo, toolchain and CI quality gate): pnpm workspace, strict TypeScript, ESLint and Vitest in place; `pnpm check` runs typecheck, lint and tests; `@dose/core` money (`assertPiastres`, `formatEgp`) is tested; CI workflow added.
- Task 2 (Enforced code boundaries): `pnpm boundaries` (in `pnpm check`) fails the build when a direction imports `@dose/core`, `@dose/api`, `pg` or another direction, or when `ui`, `shop`, `contract`, `admin` or `core` break their import rules; package skeletons for `@dose/contract`, `@dose/ui`, `@dose/shop`, `@dose/d0-baseline` and `@dose/x1-studio` exist.
