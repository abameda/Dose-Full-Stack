# 0001 - Toolchain and pinned versions

- **Status:** accepted
- **Date:** 2026-10-20

## Context

Milestone 1 starts from an empty repository. Every later task inherits the toolchain, so the versions and conventions are fixed once, here. The constraint "every dependency version is pinned exactly" applies: no `^` or `~` in any `package.json`.

## Decision

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | 24 (`.nvmrc`; local 24.16.0) | Current LTS line; Workers tooling and Vitest 5 both support it. CI reads `.nvmrc`. |
| pnpm | 12.14.0 (`packageManager` in root `package.json`) | Strict, fast workspaces with a committed lockfile and `pnpm audit`. Installed locally with `npm install -g pnpm@12.14.0` because `corepack enable` failed with EPERM writing to `C:\Program Files\nodejs`. |
| TypeScript | 6.0.3 | The newest release `typescript-eslint` 8.72.0 supports (peer range `>=4.8.4 <6.1.0`). TypeScript 7.0.2 is the npm `latest` but is outside that range, so linting with type information would be unsupported. Revisit when `typescript-eslint` widens its range. |
| ESLint | 10.13.0 | Flat config (`eslint.config.js`). |
| @eslint/js | 10.0.1 | ESLint recommended rules; matches ESLint 10. |
| typescript-eslint | 8.72.0 | `strictTypeChecked` preset with the project service. |
| Vitest | 5.0.5 | Test runner. Vitest 5 has no `vitest.workspace.ts` (removed in favour of `test.projects`), so the root `vitest.config.ts` lists `packages/*`, `directions/*`, `apps/*`, `test/*` as projects. |
| dependency-cruiser | 18.6.0 | Enforces the code boundaries (`.dependency-cruiser.cjs`, run by `pnpm boundaries`). 18.7.0 was published less than two weeks before this task, so 18.6.0 is used and the supply-chain age gate needs no exclusion. |
| @types/node | 24.19.2 | Node types for the boundaries test and script. TypeScript 6 no longer loads `@types` implicitly, so `test/boundaries/tsconfig.json` lists `types: ["node"]`. Latest 24.x, matching Node 24. |

TypeScript is configured with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` and `moduleResolution: Bundler` in `tsconfig.base.json`. Packages extend it. Source imports are extensionless.

Workspace globs are `packages/*`, `directions/*`, `apps/*`.

Root scripts: `pnpm typecheck`, `pnpm lint`, `pnpm boundaries`, `pnpm test`, and `pnpm check`, which chains all four.

CI (`.github/workflows/ci.yml`) runs on pull requests and on every push (so a branch is checked before its pull request exists): install with a frozen lockfile, `pnpm check`, gitleaks, and `pnpm audit --prod --audit-level high`.

## Consequences

- Upgrading any version is a deliberate change that updates this record.
- TypeScript stays on 6.0.x until `typescript-eslint` supports 7.
- A package that needs Node or Worker types adds `@types/node` or the Workers types itself; the base config declares none.

## Evidence

Versions read from the npm registry on 2026-10-20 (`npm view <pkg> version`, and `npm view typescript-eslint@8.72.0 peerDependencies` for the TypeScript range). `pnpm check` passes locally on these versions.
