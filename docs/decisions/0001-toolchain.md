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
| pg | 8.23.1 | Postgres driver for `@dose/core` (`createPoolDb` on Node, `createRequestDb` on Workers). Released 2026-09-30. |
| @types/pg | 8.23.1 | Types for `pg`; dev dependency of `@dose/core`. |
| fast-check | 4.10.2 | Property-based tests for the stock ledger (`@dose/core`, dev dependency). Published 2026-09-19, more than two weeks before it was added. |
| zod | 4.6.5 | Request-body schemas in `@dose/contract` (trust boundary). 4.6.6 and 4.6.7 were published less than two weeks before Task 10, so 4.6.5 (2026-09-13) is used. |
| hono | 4.13.13 | HTTP app in `@dose/api`. Latest stable 4.x (published 2026-10-04); the 5.0.0 release candidates are not stable. |
| @hono/node-server | 2.1.3 | Serves the Hono app on Node in `apps/node-control`. 2.1.4 and 2.1.5 were published less than two weeks before Task 10; 2.1.3 (2026-09-29) peers on `hono ^4`. |
| tsx | 4.23.15 | Runs `apps/node-control/src/server.ts` directly (the workspace sources import extensionless, which Node alone cannot load). Published 2026-09-20. |
| jose | 6.2.12 | Verifies Cloudflare Access tokens (`Cf-Access-Jwt-Assertion`) in `@dose/api`, on Workers and Node, with no dependencies of its own. Latest release (published 2026-09-05), more than two weeks before Task 11. |
| astro | 7.3.5 | The web app (`apps/web`), every page rendered on request (`output: 'server'`). Published 2026-09-24; the newest release more than two weeks old (7.3.6 to 7.4.1 are newer). |
| @astrojs/cloudflare | 14.3.3 | Astro's Workers adapter (peers `astro ^7.2.0`, `wrangler ^4.125.0`). Published 2026-09-22, the release paired with Astro 7.3.4/7.3.5; 14.3.4 to 14.4.1 are less than two weeks old. |
| wrangler | 4.147.0 | Runs the built Worker locally (`wrangler dev`, miniflare: local R2 and Hyperdrive's `localConnectionString`) and uploads seed images to local R2. Published 2026-10-02. No Cloudflare login is used in Milestone 1 until Task 17. |
| @cloudflare/vite-plugin | 1.62.5 (pnpm `overrides`) | The adapter depends on `^1.53.0`, which resolves to a release that wants a newer wrangler; 1.62.5 is the release built with wrangler 4.147.0 (same workerd 1.20261001.1 and miniflare), so dev, build and `wrangler dev` share one runtime. |
| @cloudflare/workers-types | 5.20261005.1 | Types for the Worker's bindings (`Hyperdrive`, `R2Bucket`, `ScheduledController`), imported as a module rather than loaded as globals: as globals they replace `Request`/`Response` for every workspace package the app compiles, and `@dose/api` stops typechecking under `exactOptionalPropertyTypes`. `cloudflare:workers` is declared in `apps/web/src/app.d.ts`. |
| @playwright/test | 1.63.0 | End-to-end tests (`pnpm e2e`), projects `iphone` (WebKit, iPhone 13) and `pixel` (Chromium, Pixel 7). Browsers installed with `pnpm exec playwright install chromium webkit`. Published 2026-09-04; 1.64 is less than two weeks old. |
| sharp | 0.35.5 | The seed re-encodes every product image to a 1200x1500 JPEG (dev dependency of `@dose/core`, used by `seed/` only). Published 2026-09-27. |
| tsx | 4.23.15 | Also runs `pnpm seed` (`packages/core/seed/run.ts`): the seed imports `stock.ts`, whose parameter properties Node's type stripping cannot run. |
| Postgres (local and CI) | 18 (`postgres:18` image) | `docker-compose.yml` for local development (port 54329) and the CI service container. Neon runs the production branches; the version is confirmed when the Neon project is created. |

TypeScript is configured with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` and `moduleResolution: Bundler` in `tsconfig.base.json`. Packages extend it. Source imports are extensionless.

Workspace globs are `packages/*`, `directions/*`, `apps/*`.

Code boundaries (`.dependency-cruiser.cjs`) are checked by dependency-cruiser, which cannot read `.astro` files (its supported extensions are ts, tsx, cts, mts, js, vue, svelte, livescript and coffee). `scripts/astro-imports.mjs` therefore scans the import specifiers in every `.astro` file under `packages/`, `directions/` and `apps/` and judges them against the same rules, so `pnpm boundaries` covers Astro frontmatter and `<script>` imports too. It is a text scan: it reports import-looking lines inside comments, and it does not follow `import.meta.glob` patterns.

`esbuild` (a dependency of `tsx`) has an install script that only optimises its launcher; `pnpm-workspace.yaml` sets `allowBuilds: { esbuild: false }` so `pnpm install` does not fail on the unreviewed script. The platform binary arrives as an optional dependency regardless.

How the Workers toolchain fits together in these versions (read from the adapter's source and the Astro Cloudflare guide, 2026-10-20):

- `apps/web/wrangler.jsonc` is the Worker's configuration. Its `main` is `src/worker-scheduled.ts`, which exports `fetch: handle` (from `@astrojs/cloudflare/handler`) plus the cron's `scheduled` handler. `astro build` bundles it and writes the deployable config to `dist/server/wrangler.json`, with `.wrangler/deploy/config.json` redirecting `wrangler dev` and `wrangler deploy` (run in `apps/web`) to it.
- Bindings and variables are read with `import { env } from 'cloudflare:workers'` (the adapter no longer puts them on `Astro.locals.runtime`).
- The adapter adds a `SESSION` KV binding for Astro sessions even though the app does not use sessions; locally miniflare simulates it. Deploying (Task 17) would provision that namespace automatically.
- `imageService: 'passthrough'`: the seed stores images at their display size and `/media/<key>` serves them, so no Cloudflare Images binding is needed.
- Locally, Hyperdrive connects to `localConnectionString`; the `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` environment variable overrides it (the e2e tests point it at `dose_e2e`).
- `pnpm-workspace.yaml` sets `allowBuilds: { workerd: false }` for the same reason as esbuild below.

Root scripts: `pnpm typecheck`, `pnpm lint`, `pnpm boundaries`, `pnpm test`, and `pnpm check`, which chains all four. `pnpm seed --target <ownerUrl> --media local|r2 [--fresh]` migrates and seeds a database; `pnpm e2e` runs Playwright against the built Worker (needs `docker compose up -d`). The root `tsconfig.json` covers `playwright.config.ts` and `e2e/`.

CI (`.github/workflows/ci.yml`) runs on pull requests and on every push (so a branch is checked before its pull request exists): install with a frozen lockfile, `pnpm check`, gitleaks, and `pnpm audit --prod --audit-level high`.

## Consequences

- Upgrading any version is a deliberate change that updates this record.
- TypeScript stays on 6.0.x until `typescript-eslint` supports 7.
- A package that needs Node or Worker types adds `@types/node` or the Workers types itself; the base config declares none.

## Evidence

Versions read from the npm registry on 2026-10-20 (`npm view <pkg> version`, and `npm view typescript-eslint@8.72.0 peerDependencies` for the TypeScript range). `pnpm check` passes locally on these versions.
