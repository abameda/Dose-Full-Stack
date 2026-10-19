# Milestone 1: Foundation and Proof — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Working software the owner can use on a phone (a cash-on-delivery order from bag to confirmation, visible and confirmable in the admin), plus measured evidence for the two choices that are expensive to reverse: Workers versus a Node container, and Astro versus React Router.

**Architecture:** A pnpm monorepo. A plain-TypeScript commerce core (`packages/core`) holds every money rule and talks to Postgres through one small `Db` interface, so it runs unchanged on Workers (via Hyperdrive) and on Node. A Hono HTTP app (`packages/api`) exposes the core; the Astro app (`apps/web`) serves the storefront, the studio and the React admin, and mounts the Hono app at `/api/*`. The same Hono app runs on Node (`apps/node-control`) as the proof-of-concept control. Design directions (`directions/*`) consume only the typed contract and shared hardened parts; importing commerce code fails the build.

**Tech Stack:** TypeScript (strict), pnpm workspaces, Node 24 LTS, Postgres (same major version as the Neon projects), `pg`, Hono, Astro with `@astrojs/cloudflare` and React islands, React for the admin, Zod at trust boundaries, `jose` for Access JWTs, Vitest, fast-check, Playwright with `@axe-core/playwright`, Lighthouse CI, dependency-cruiser, ESLint, gitleaks, Wrangler, GitHub Actions, Neon, Cloudflare Workers/Hyperdrive/R2/Access, Fly.io (control container only).

**Spec:** `docs/master-plan.md` (sections A, "Commerce correctness", B, C, E and G) and `docs/milestones.md` (M1). Read both before starting any task.

## Global Constraints

- Money is integer piastres everywhere (`number`, `Number.isSafeInteger`, never decimals); EGP only; prices shown with Western digits in both languages.
- Two languages, `ar` and `en`, at `/ar/...` and `/en/...`; Arabic pages are `dir="rtl"`; product slugs are Latin in both languages (`^[a-z0-9]+(-[a-z0-9]+)*$`).
- Customer identity is the normalised Egyptian mobile number in E.164 (`+201XXXXXXXXX`).
- Order, payment and fulfilment are three separate state columns; every state change is a conditional update from allowed states, bumps `version`, and writes an audit event in the same transaction.
- Stock on hand and reserved are always equal to the sum of their stock movements; `0 ≤ reserved ≤ on_hand` is a database check.
- The application database role (`dose_app`) can never `UPDATE`, `DELETE` or `TRUNCATE` audit events. Migrations run as `dose_owner`.
- Directions (`directions/**`) may import only `@dose/contract`, `@dose/ui` and `@dose/shop`. Importing `@dose/core`, `@dose/api`, `pg` or anything under `apps/` fails the build.
- Studio and admin responses carry `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow`. Checkout refuses to run from the studio.
- No real customer data anywhere in M1. Preview and staging databases are never copied from production. Production holds an empty, migrated database and nothing else.
- doseeg.com, Paymob, Bosta and any account not listed under "Owner prerequisites" are out of bounds.
- Speed budget for the Direction 0 product page in Lighthouse mobile emulation: largest contentful paint ≤ 2,500 ms; JavaScript ≤ 110 KB.
- Every dependency version is pinned exactly; versions are recorded in `docs/decisions/0001-toolchain.md`.
- Every task ends with `pnpm check` green (typecheck, lint, boundaries, unit and integration tests) and a commit; `docs/progress.md` gets a dated line per task.

### Interpretations the owner confirms when approving this plan

The spec leaves these open; the plan uses the value shown until the owner says otherwise. Each is recorded in `docs/decisions/0002-milestone-1-defaults.md` in Task 1.

| Item | Value used | Why it needs a value now |
| --- | --- | --- |
| "Under 110 KB of JavaScript" | Compressed bytes transferred (Lighthouse `resource-summary` script transfer size), ≤ 112,640 bytes | React islands cannot fit 110 KB uncompressed |
| Order number scheme (also Bosta's reference later) | `D` followed by a sequence starting at `10001` (e.g. `D10001`) | Expensive to change once orders exist (section B) |
| Cash-on-delivery confirmation window | 48 hours, stored in `settings`, then cancelled with reason `confirmation_window_expired` | Rule 4 tests need an expiry; section F lists it as safe to decide later |
| Delivery fee before M2's per-governorate settings | EGP 70 (7,000 piastres) for every governorate, marked placeholder | Totals must include delivery |
| Bag limits | 1–10 units per line, at most 10 lines | A trust-boundary limit on checkout input |
| M1 admin permissions | Owner: all. Operations: read orders, confirm, cancel. Accountant: read orders. Marketing: no order routes. Audit log: Owner only | Section B roles, narrowed to M1 routes |

### Owner prerequisites (blocking only the tasks named)

| # | What the owner provides | Blocks |
| --- | --- | --- |
| O1 | Approval of this plan and the interpretations above | Everything |
| O2 | Cloudflare (Workers paid plan), Neon (Launch plan) and Fly.io accounts in DÖSE's name, with access granted; GitHub repo admin rights for Actions secrets | Tasks 17–20 |
| O3 | Paradise and Blanc copy in Arabic and English (name, story, exact label copy), and the product photographs as files | Task 12 seed (placeholders, clearly marked, until then) |
| O4 | An iPhone and a mid-range Android, both with Instagram, for the field checks | Task 20 |
| O5 | Senior reviewer yes or no (needed from week 3, not for M1) | Nothing in M1 |

## Acceptance criteria → tasks

| Section G acceptance criterion | Automated proof | Field proof |
| --- | --- | --- |
| COD order from a phone on staging in AR and EN appears in Today within seconds; confirming shows who did what in timeline and audit | Task 16 `e2e/order-to-admin.spec.ts` (both languages, both phone profiles), on Tasks 6, 7, 11, 13 | Task 20 step 2 |
| 200 simultaneous checkouts for 10 units → exactly 10 orders, 100 runs, rule checker reports nothing | Task 6 `checkout.concurrency.test.ts` + Task 9 checker, locally and in CI | Task 19 against Workers+Hyperdrive and the Node container |
| The same webhook ten times in parallel changes state once | Task 8 `webhooks.test.ts` (core) and `webhooks.http.test.ts` (HTTP) | — |
| A change creates its preview and database branch in under five minutes; a test proves a preview cannot reach production data | Task 18 `preview.yml` duration gate + `preview-isolation.test.ts` | Task 18 step 7 |
| In the studio the same product renders in both designs and checkout refuses to run | Task 15 `e2e/studio.spec.ts` + `studio-guard.test.ts` | Task 20 step 3 |
| Direction 0 product page meets the speed budget in mobile emulation; the owner checks it inside Instagram | Task 14 `lighthouserc.cjs` budget in CI | Task 20 step 3 |
| A decision record states, with measurements, whether we keep Workers and Astro | — | Task 20 `0004` and `0005` records |

### Beliefs to verify (each closed in the named task, with evidence in `docs/decisions/0003-milestone-1-beliefs.md`)

| # | Belief | Verified in |
| --- | --- | --- |
| B1 | A Worker can be placed near Frankfurt (explicit placement hint for `aws:eu-central-1`) | Task 17 |
| B2 | Hyperdrive caches read queries by default, and disabling caching gives read-your-writes | Task 17 |
| B3 | Hyperdrive's transaction-mode pooling keeps a multi-statement transaction on one connection | Task 17 |
| B4 | 200 concurrent checkout transactions through Hyperdrive queue rather than fail when they exceed origin connections | Task 19 |
| B5 | Neon accepts `CREATE ROLE` and `GRANT/REVOKE` in SQL, and branches inherit those roles and privileges | Task 17 |
| B6 | A Worker preview version can carry its own Hyperdrive binding, and the account's Hyperdrive config limit covers the open pull requests | Task 18 |
| B7 | Cloudflare Access can protect the Worker's `workers.dev` and preview URLs | Task 18 |
| B8 | Access one-time-PIN login works inside Instagram's in-app browser on iOS and Android | Task 20 |
| B9 | Astro's client router keeps `transition:persist` elements (bag, canvas) alive inside Instagram's browser on iOS and Android | Task 20 |
| B10 | `pg` runs on Workers with `nodejs_compat` through the Astro Cloudflare adapter | Task 12 |
| B11 | Neon and Fly.io list prices match the plan's cost table | Task 17 |

## Review Focus

1. **Double-tapped "Place order" on a slow Instagram connection, or a retried request** → exactly one order, and the second response returns the same order number. Pinned in Task 6 (`returns the same order for a repeated idempotency key`, `parallel duplicate submissions create one order`).
2. **Phone typed with Arabic-Indic digits, `+20`/`0020`/`20` prefixes, spaces or dashes** → one normalised customer; landlines and wrong lengths are refused with a field error, not a server error. Pinned in Task 6 (`normalisePhone` table test) and Task 13 (`e2e/checkout-validation.spec.ts`).
3. **A bag saved in the browser whose price changed or whose stock ran out since it was added** → the customer sees the new total or the missing item and confirms again; no order at a stale price. Pinned in Task 6 (`price_changed`, `out_of_stock`) and Task 13 (`stale bag shows the new total`).
4. **Two staff acting on the same order at once, or confirming an order the expiry job just cancelled** → one action wins, the other gets a clear conflict with the current state, and stock moves once. Pinned in Task 7 (`concurrent confirm and cancel`, `confirm after expiry is a conflict`) and Task 16 (conflict message test).
5. **Instagram's in-app browser with storage blocked or cleared** → the bag still works for the visit (in-memory fallback) and nothing throws. Pinned in Task 13 (`bag works when localStorage throws`).

---

## File structure

```
package.json · pnpm-workspace.yaml · tsconfig.base.json · eslint.config.js
.dependency-cruiser.cjs · vitest.workspace.ts · playwright.config.ts · lighthouserc.cjs
docker-compose.yml                      local Postgres
.github/workflows/ci.yml · preview.yml · preview-cleanup.yml · staging.yml
packages/contract/src/index.ts          typed data, Zod schemas, CommerceActions
packages/core/src/
  money.ts · phone.ts · address.ts · governorates.ts
  db.ts                                 Db/Tx interface, Node pool and per-request implementations
  migrate.ts · migrations/*.sql
  catalogue.ts                          read published products/variants
  stock.ts                              ledger operations
  states.ts                             transition tables for order/payment/fulfilment
  audit.ts                              audit event writer
  pricing.ts                            pure bag pricing
  checkout.ts                           COD checkout transaction
  order-actions.ts                      confirm, cancel, expire
  webhooks.ts · outbox.ts
  rules.ts                              rule checker; bin: scripts/check-rules.ts
  seed/catalogue.ts · seed/run.ts
packages/core/test/                     harness + tests per module
packages/api/src/
  app.ts                                createApp(deps) → Hono
  storefront-routes.ts · admin-routes.ts · webhook-routes.ts
  auth.ts                               Access JWT → Staff
  permissions.ts                        route × role matrix
packages/ui/src/                        tokens.css, Button, Dialog, Field primitives
packages/shop/src/                      bag store, shop client (CommerceActions), BagDrawer, CheckoutForm
directions/d0-baseline/src/             Direction 0 pages (home, product, bag, checkout, confirmation)
directions/x1-studio/src/               exploratory product page with motion hero
apps/admin/src/                         React admin (Today, Orders, Order detail, Audit)
apps/web/                               Astro app, wrangler.jsonc, routes, API mount, media route
apps/node-control/                      Node server for the PoC control + Dockerfile + fly.toml
poc/concurrency.ts                      deployed-target concurrency runner
e2e/                                    Playwright specs
docs/decisions/                         0001 toolchain · 0002 defaults · 0003 beliefs · 0004 runtime · 0005 storefront
```

---

### Task 1: Monorepo, toolchain and CI quality gate (with money)

**Files:**
- Create: root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `vitest.workspace.ts`, `.nvmrc`, `.github/workflows/ci.yml`
- Create: `packages/core/package.json`, `packages/core/src/money.ts`, `packages/core/test/money.test.ts`
- Create: `docs/decisions/0001-toolchain.md`, `docs/decisions/0002-milestone-1-defaults.md`

**Interfaces:**
- Produces: `type Lang = 'ar' | 'en'` (exported from `@dose/contract` in Task 10; define it in `money.ts` now and move it then), `assertPiastres(n: number): number`, `formatEgp(piastres: number, lang: Lang): string`.
- Produces: root scripts `pnpm check` (typecheck + lint + boundaries + test), `pnpm test`, `pnpm typecheck`, `pnpm lint`.

- [ ] **Step 1: Write the failing test** `packages/core/test/money.test.ts`

```ts
test('formats whole pounds without decimals, Western digits in both languages', () => {
  expect(formatEgp(125_000, 'en')).toBe('EGP 1,250');
  expect(formatEgp(125_000, 'ar')).toBe('1,250 ج.م');
});
test('shows piastres only when non-zero', () => {
  expect(formatEgp(125_050, 'en')).toBe('EGP 1,250.50');
});
test('rejects non-integers, negatives and unsafe integers', () => {
  for (const bad of [1.5, -1, Number.MAX_SAFE_INTEGER + 1, NaN]) expect(() => assertPiastres(bad)).toThrow();
});
```

- [ ] **Step 2: Run it to see it fail** — `pnpm vitest run packages/core/test/money.test.ts` → FAIL, module not found.
- [ ] **Step 3: Set up the workspace** — pnpm workspaces over `packages/*`, `directions/*`, `apps/*`; TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; ESLint flat config with `typescript-eslint` strict; Vitest workspace. Pin exact versions (latest stable today). Write `0001-toolchain.md` (versions and why) and `0002-milestone-1-defaults.md` (the interpretations table above, status "proposed until the owner approves").
- [ ] **Step 4: Implement `money.ts`** — `formatEgp` uses `Intl.NumberFormat('en-US')` for the digits in both languages, so Arabic gets Western digits by construction.
- [ ] **Step 5: Run** `pnpm check` → PASS.
- [ ] **Step 6: Add `ci.yml`** — on pull request and push to `main`: install with frozen lockfile, `pnpm check`, `gitleaks detect --no-banner`, `pnpm audit --prod --audit-level high`. Push a branch and confirm the run is green on GitHub.
- [ ] **Step 7: Commit** — `git commit -m "chore: workspace, toolchain and CI gate with money formatting"`

---

### Task 2: Enforced code boundaries

**Files:**
- Create: `.dependency-cruiser.cjs`, `packages/contract/package.json` + `src/index.ts` (stub export), `packages/ui`, `packages/shop`, `directions/d0-baseline`, `directions/x1-studio` package skeletons
- Create: `test/boundaries/boundaries.test.ts`, `test/boundaries/fixtures/bad-direction/index.ts`

**Interfaces:**
- Produces: `pnpm boundaries` (part of `pnpm check`); package names `@dose/contract`, `@dose/core`, `@dose/api`, `@dose/ui`, `@dose/shop`, `@dose/d0-baseline`, `@dose/x1-studio`, `@dose/admin`, `@dose/web`.

Rules (dependency-cruiser, severity `error`):
1. `directions/**` → only `@dose/contract`, `@dose/ui`, `@dose/shop`, `react`, `astro` and their own files.
2. `packages/ui`, `packages/shop`, `packages/contract`, `apps/admin` → never `@dose/core`, `@dose/api`, `pg`.
3. `packages/core` → never `hono`, `astro`, `react`, any `@dose/*` except `@dose/contract`.
4. No direction imports another direction.

- [ ] **Step 1: Write the failing test** — runs dependency-cruiser programmatically on the fixture and on the real tree:

```ts
test('a direction importing commerce code fails the build', async () => {
  const result = await cruise(['test/boundaries/fixtures/bad-direction'], config);
  expect(result.output.summary.violations.map(v => v.rule.name)).toContain('directions-only-contract-ui-shop');
});
test('the real tree has no violations', async () => {
  const result = await cruise(['packages', 'directions', 'apps'], config);
  expect(result.output.summary.error).toBe(0);
});
```

The fixture is `import { checkout } from '@dose/core';` inside a file under a path the config treats as `directions/**` (configure the fixture path into rule 1).

- [ ] **Step 2: Run** → FAIL (no config).
- [ ] **Step 3: Write `.dependency-cruiser.cjs`** with the four rules; exclude the fixture from `pnpm boundaries` but include it in the test.
- [ ] **Step 4: Run** `pnpm check` → PASS. Temporarily add the bad import to `directions/d0-baseline/src/index.ts`, run `pnpm boundaries`, confirm it exits non-zero, remove it.
- [ ] **Step 5: Commit** — `feat: enforce package boundaries; directions cannot import commerce code`

---

### Task 3: Postgres, migrations, roles and the test-database harness

**Files:**
- Create: `docker-compose.yml` (Postgres, port 54329), `packages/core/src/db.ts`, `packages/core/src/migrate.ts`, `packages/core/migrations/0001_roles_and_audit.sql`, `packages/core/test/harness.ts`, `packages/core/test/global-setup.ts`, `packages/core/test/db.test.ts`
- Modify: `.github/workflows/ci.yml` (Postgres service container)

**Interfaces:**
- Produces:
  ```ts
  interface Tx { query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<R[]> }
  interface Db extends Tx { transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>; close(): Promise<void> }
  function createPoolDb(connectionString: string, opts?: { max?: number }): Db      // Node: pg.Pool
  function createRequestDb(connectionString: string): Db                            // Workers: one pg.Client per request, lazy connect, close() ends it
  function migrate(ownerConnectionString: string): Promise<string[]>                // applied file names, in order, idempotent
  // test harness
  function withTestDb(): Promise<{ app: Db; owner: Db; appUrl: string; ownerUrl: string; drop(): Promise<void> }>
  ```
- `0001_roles_and_audit.sql` creates role `dose_app` (login, password from env in non-local environments), table `schema_migrations`, and `audit_events(id bigserial pk, at timestamptz default now(), actor_type text check in ('customer','staff','system'), actor_id text, action text, entity text, entity_id text, entity_version int, reason text, data jsonb not null default '{}')`; grants `dose_app` `SELECT, INSERT` on `audit_events` and usage on its sequence; revokes `UPDATE, DELETE, TRUNCATE`.
- `withTestDb` clones `dose_test_template` (migrated once in `global-setup.ts`) with `CREATE DATABASE … TEMPLATE`, so each test file gets a fresh database in milliseconds.

- [ ] **Step 1: Write the failing tests** `db.test.ts`

```ts
test('migrations are idempotent', async () => {
  const { ownerUrl } = await withTestDb();
  expect(await migrate(ownerUrl)).toEqual([]);           // template already migrated
});
test('rule 12: the app role cannot alter audit events', async () => {
  const { app } = await withTestDb();
  await app.query(`insert into audit_events (actor_type, actor_id, action, entity, entity_id) values ('system','t','x','order','1')`);
  await expect(app.query(`update audit_events set action = 'y'`)).rejects.toThrow(/permission denied/);
  await expect(app.query(`delete from audit_events`)).rejects.toThrow(/permission denied/);
  await expect(app.query(`truncate audit_events`)).rejects.toThrow(/permission denied/);
});
test('a failed transaction leaves nothing behind', async () => {
  const { app } = await withTestDb();
  await expect(app.transaction(async tx => {
    await tx.query(`insert into audit_events (actor_type, actor_id, action, entity, entity_id) values ('system','t','x','order','1')`);
    throw new Error('boom');
  })).rejects.toThrow('boom');
  expect(await app.query(`select 1 from audit_events`)).toHaveLength(0);
});
```

- [ ] **Step 2: Run** `docker compose up -d && pnpm vitest run packages/core/test/db.test.ts` → FAIL.
- [ ] **Step 3: Implement** `db.ts`, `migrate.ts` (files sorted by name, each in its own transaction, recorded in `schema_migrations`), the migration and the harness.
- [ ] **Step 4: Run** → PASS. Add the Postgres service to `ci.yml`; push; CI green.
- [ ] **Step 5: Commit** — `feat(core): postgres access, migrations, app role that cannot alter audit`

---

### Task 4: Catalogue and stock ledger

**Files:**
- Create: `packages/core/migrations/0002_catalogue_and_stock.sql`, `packages/core/src/stock.ts`, `packages/core/src/catalogue.ts`, `packages/core/test/stock.test.ts`, `packages/core/test/stock.property.test.ts`, `packages/core/test/factories.ts`

**Interfaces:**
- Schema:
  - `products(id uuid pk, slug text unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'), status text check in ('draft','published'), name_ar, name_en, story_ar, story_en, label_copy_ar, label_copy_en text not null, created_at)`
  - `product_images(id uuid pk, product_id fk, r2_key text, alt_ar, alt_en text not null, position int)`
  - `variants(id uuid pk, product_id fk, sku text unique, kind text check in ('full','sample','tester'), size_ml int check > 0, price_piastres int check > 0, status text check in ('active','archived'))`
  - `stock_levels(variant_id pk fk, on_hand int not null default 0, reserved int not null default 0, check (reserved >= 0 and reserved <= on_hand))`
  - `stock_movements(id bigserial pk, variant_id fk, reason text check in ('received','reserved','released','sold','returned','adjusted'), on_hand_delta int, reserved_delta int, source_key text unique not null, actor_type text, actor_id text, at timestamptz default now())`
  - Movement deltas, fixed: received `(+q, 0)`, reserved `(0, +q)`, released `(0, −q)`, sold `(−q, −q)`, returned `(+q, 0)`, adjusted `(±q, 0)`.
- Produces:
  ```ts
  type Actor = { type: 'customer' | 'staff' | 'system'; id: string };
  function receiveStock(tx: Tx, a: { variantId: string; quantity: number; sourceKey: string; actor: Actor }): Promise<'applied' | 'duplicate'>;
  class InsufficientStock extends Error { constructor(readonly variantId: string) }
  function reserveStock(tx: Tx, a: { variantId: string; quantity: number; sourceKey: string; actor: Actor }): Promise<'reserved' | 'duplicate'>;  // throws InsufficientStock
  function releaseStock(tx: Tx, a: { variantId: string; quantity: number; sourceKey: string; actor: Actor }): Promise<'applied' | 'duplicate'>;
  function sellReserved(tx: Tx, a: { variantId: string; quantity: number; sourceKey: string; actor: Actor }): Promise<'applied' | 'duplicate'>;
  function getStock(tx: Tx, variantId: string): Promise<{ onHand: number; reserved: number; available: number }>;
  function listPublishedProducts(tx: Tx): Promise<ProductRow[]>;        // with variants, images, available
  function getPublishedProduct(tx: Tx, slug: string): Promise<ProductRow | null>;
  ```
- Each operation inserts the movement first (`on conflict (source_key) do nothing returning id`); no row → `'duplicate'` and no counter change. Then updates `stock_levels` by the same deltas. `reserveStock` uses `update … set reserved = reserved + $q where variant_id = $v and on_hand - reserved >= $q returning`; no row → throw `InsufficientStock`, so the caller's transaction rolls back the movement it just inserted. Checkout (Task 6) catches it and turns it into `out_of_stock`.
- Test factories: `makeProduct(owner: Db, overrides?)`, `makeVariant(owner, productId, overrides?)` with stock.

- [ ] **Step 1: Write the failing tests** `stock.test.ts`

```ts
test('rule 3: cannot reserve more than is free', async () => {
  /* receive 2, reserve 2 → reserved; reserve 1 → throws InsufficientStock; getStock = {onHand:2, reserved:2, available:0} */
});
test('rule 5: the same source key moves stock once', async () => {
  /* receiveStock twice with sourceKey 'receipt:1' → 'applied' then 'duplicate'; onHand === quantity */
});
test('the database refuses reserved > on_hand even without the helpers', async () => {
  await expect(owner.query(`update stock_levels set reserved = on_hand + 1 where variant_id = $1`, [v])).rejects.toThrow(/check/);
});
```

`stock.property.test.ts` (fast-check, 500 runs): random sequences of `receive | reserve | release | sell | adjust` with random quantities; after each sequence `getStock` equals the sum of movement deltas and `0 ≤ reserved ≤ onHand`.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** migration, `stock.ts`, `catalogue.ts`, factories.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(core): catalogue schema and append-only stock ledger`

---

### Task 5: Orders, payments, state machines and audit

**Files:**
- Create: `packages/core/migrations/0003_orders.sql`, `packages/core/src/states.ts`, `packages/core/src/audit.ts`, `packages/core/src/pricing.ts`, `packages/core/src/governorates.ts`, `packages/core/test/states.test.ts`, `packages/core/test/pricing.property.test.ts`, `packages/core/test/orders-schema.test.ts`

**Interfaces:**
- Schema:
  - `create sequence order_number_seq start 10001`; `orders.number text unique default 'D' || nextval('order_number_seq')`.
  - `customers(id uuid pk, phone_e164 text unique check (phone_e164 ~ '^\+201[0125][0-9]{8}$'), name text, email text null, created_at)`
  - `orders(id uuid pk, number, checkout_key uuid unique not null, customer_id fk, recipient_name, recipient_phone, governorate text, area, street, building, landmark null, lang text check in ('ar','en'), direction text not null, channel text check in ('web','manual'), payment_method text check in ('cod'), subtotal, discount_total, delivery_fee, total int not null, order_state text, payment_state text, fulfilment_state text, version int not null default 1, created_at)`, with checks: all money `>= 0`, `discount_total <= subtotal`, `total = subtotal - discount_total + delivery_fee`, and each state column in its allowed set.
  - `order_lines(id uuid pk, order_id fk, variant_id fk, sku, name_ar, name_en text, unit_price, quantity, line_discount, line_total int, check (quantity between 1 and 10), check (line_total = unit_price * quantity - line_discount), check (line_discount between 0 and unit_price * quantity))`
  - `payments(id uuid pk, order_id fk, method text, amount int check >= 0, state text, attempt int default 1, provider_ref text null, unique (order_id, attempt))`
  - `reservations(id uuid pk, order_id fk, variant_id fk, quantity int check > 0, status text check in ('held','consumed','released'), expires_at timestamptz)`
  - `governorate_delivery(governorate text pk, fee_piastres int check >= 0, cod_enabled bool, placeholder bool)` seeded for all 27 governorates at 7,000, `placeholder = true`.
  - `settings(key text pk, value jsonb)` seeded with `cod_confirmation_window_hours = 48`.
  - Grants to `dose_app`: `SELECT, INSERT, UPDATE` on these tables; no `DELETE`.
- Produces:
  ```ts
  type OrderState = 'pending' | 'confirmed' | 'cancelled';
  type PaymentState = 'awaiting_collection' | 'voided';           // 'collected' arrives with Bosta (M3/M4)
  type FulfilmentState = 'unfulfilled';                            // shipment states arrive in M3
  const ORDER_TRANSITIONS: Record<OrderState, readonly OrderState[]>;   // pending→confirmed, pending→cancelled
  const PAYMENT_TRANSITIONS: Record<PaymentState, readonly PaymentState[]>; // awaiting_collection→voided
  function canTransition<S extends string>(table: Record<S, readonly S[]>, from: S, to: S): boolean;
  function writeAudit(tx: Tx, e: { actor: Actor; action: string; entity: string; entityId: string; entityVersion?: number; reason?: string; data?: Record<string, unknown> }): Promise<void>;
  type PricedLine = { variantId: string; sku: string; nameAr: string; nameEn: string; unitPrice: number; quantity: number; lineDiscount: number; lineTotal: number };
  function priceBag(lines: Omit<PricedLine, 'lineDiscount' | 'lineTotal'>[], deliveryFee: number):
    { lines: PricedLine[]; subtotal: number; discountTotal: number; deliveryFee: number; total: number };
  const GOVERNORATES: readonly { code: string; nameAr: string; nameEn: string }[];   // Egypt's 27, codes like 'cairo', 'giza'
  ```
- Decision record `0002` gets the order-number entry marked as used.

- [ ] **Step 1: Write the failing tests**

`pricing.property.test.ts` (rule 1, fast-check, 5,000 bags of 1–10 lines, prices 1–10,000,000 piastres, quantities 1–10, delivery 0–50,000):
```ts
expect(r.total).toBe(r.subtotal - r.discountTotal + r.deliveryFee);
expect(r.subtotal).toBe(sum(r.lines.map(l => l.lineTotal)));
expect(r.discountTotal).toBeLessThanOrEqual(r.subtotal);
for (const n of [r.total, r.subtotal, r.discountTotal, ...r.lines.map(l => l.lineTotal)]) expect(Number.isSafeInteger(n) && n >= 0).toBe(true);
```

`orders-schema.test.ts`: inserting an order whose `total` ≠ `subtotal - discount_total + delivery_fee`, a negative amount, a discount above subtotal, an unknown state, or a line whose `line_total` does not match each fail with a check violation (one `test.each` row per case).

`states.test.ts`: `canTransition(ORDER_TRANSITIONS, 'pending', 'confirmed') === true`; `('confirmed','pending')`, `('cancelled','confirmed')`, `('cancelled','cancelled')` are `false`; every state appears as a key.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** migration, `states.ts`, `audit.ts`, `pricing.ts`, `governorates.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(core): orders, payments, reservations, state tables, audit and pricing`

---

### Task 6: Cash-on-delivery checkout

**Files:**
- Create: `packages/core/src/phone.ts`, `packages/core/src/address.ts`, `packages/core/src/checkout.ts`, `packages/core/test/phone.test.ts`, `packages/core/test/checkout.test.ts`, `packages/core/test/checkout.concurrency.test.ts`

**Interfaces:**
- Consumes: Task 4 stock operations, Task 5 schema, `priceBag`, `writeAudit`.
- Produces:
  ```ts
  function normalisePhone(input: string): { ok: true; e164: string } | { ok: false };
  type AddressInput = { governorate: string; area: string; street: string; building: string; landmark?: string };
  function validateAddress(a: AddressInput): { ok: true; value: AddressInput } | { ok: false; fields: (keyof AddressInput)[] };
  type CheckoutCommand = {
    idempotencyKey: string;                 // uuid generated when the checkout page loads
    lang: Lang; direction: string; surface: 'storefront' | 'studio';
    lines: { sku: string; quantity: number }[];
    quotedTotal: number;
    customer: { name: string; phone: string };
    address: AddressInput;
    now: Date;
  };
  type CheckoutOutcome =
    | { ok: true; orderNumber: string; total: number; replayed: boolean }
    | { ok: false; code: 'price_changed'; quote: Quote }
    | { ok: false; code: 'out_of_stock'; skus: string[] }
    | { ok: false; code: 'invalid'; fields: string[] }
    | { ok: false; code: 'checkout_disabled' };
  type Quote = ReturnType<typeof priceBag>;
  function quoteBag(tx: Tx, lines: { sku: string; quantity: number }[], governorate?: string): Promise<Quote | { unknownSkus: string[] }>;
  function placeCodOrder(db: Db, cmd: CheckoutCommand): Promise<CheckoutOutcome>;
  ```
- `normalisePhone`: map Arabic-Indic `٠–٩` and Persian `۰–۹` digits to ASCII; strip spaces, dashes, dots, parentheses; strip a leading `+20`, `0020` or `20` when followed by 10 digits; strip a leading `0`; accept only `1[0125]` followed by 8 digits; return `+20` + those 10 digits.
- `placeCodOrder`, in one transaction, in this order:
  1. `surface === 'studio'` → `checkout_disabled` before touching the database.
  2. Validate (lines 1–10 each, ≤ 10 lines, no duplicate SKUs, name 1–100 chars, phone, address, governorate in `GOVERNORATES` with `cod_enabled`) → `invalid`.
  3. If an order with this `checkout_key` exists → return it with `replayed: true`.
  4. Re-price from the database (`quoteBag`); if `total !== quotedTotal` → `price_changed` with the new quote.
  5. Reserve each line in ascending `variant_id` order (fixed lock order) with source key `reserve:<orderId>:<variantId>`; any shortfall → roll back, `out_of_stock` with the short SKUs.
  6. Upsert customer by `phone_e164`; insert order (states `pending` / `awaiting_collection` / `unfulfilled`), lines with name and price snapshots, payment, reservations (`held`, `expires_at = now + cod_confirmation_window_hours`).
  7. `writeAudit` action `order.placed`, actor `customer:<phone_e164>`, entity version 1.
  - A unique violation on `checkout_key` (two parallel submissions) → roll back and return the existing order with `replayed: true`.

- [ ] **Step 1: Write the failing tests**

`phone.test.ts` — table test:
```ts
test.each([
  ['01012345678', '+201012345678'], ['+20 101 234 5678', '+201012345678'], ['0020-1012345678', '+201012345678'],
  ['201512345678', '+201512345678'], ['٠١٢٣٤٥٦٧٨٩٠', '+201234567890'], ['(011) 2345-6789', '+201123456789'],
])('%s → %s', (input, e164) => expect(normalisePhone(input)).toEqual({ ok: true, e164 }));
test.each(['0223456789', '0131234567', '010123456', '010123456789', 'abc', ''])('rejects %s', i =>
  expect(normalisePhone(i)).toEqual({ ok: false }));
```

`checkout.test.ts`:
- `places an order, reserves stock and writes order.placed` — after success: order states `pending/awaiting_collection/unfulfilled`, `version = 1`, lines snapshot names and prices, stock reserved = quantity, one audit event with `actor_type = 'customer'`, order number matches `/^D\d{5,}$/`.
- `returns the same order for a repeated idempotency key` — second call returns the same `orderNumber`, `replayed: true`; one order row; reserved unchanged.
- `parallel duplicate submissions create one order` — 10 parallel calls with one key → 1 order, all outcomes share the order number.
- `price_changed when the quoted total is stale` — update the variant price after quoting → `price_changed`, quote total equals new price + delivery; no order, no reservation.
- `out_of_stock names the short SKUs and reserves nothing` — two lines, second short → outcome lists only the second SKU; stock of the first unchanged.
- `refuses in the studio` — `surface: 'studio'` → `checkout_disabled`, no rows written.
- `invalid lists the bad fields` — bad phone and empty street → `fields` contains `customer.phone` and `address.street`.
- `same customer for differently typed phones` — orders with `01012345678` and `+20 10 1234 5678` share one customer row.

`checkout.concurrency.test.ts` (rule 3, the section G figure): variant with 10 units, 200 parallel `placeCodOrder` calls with distinct keys and phones through `createPoolDb(url, { max: 50 })`; repeat 100 times (fresh stock each run):
```ts
expect(outcomes.filter(o => o.ok)).toHaveLength(10);
expect(outcomes.filter(o => !o.ok && o.code === 'out_of_stock')).toHaveLength(190);
expect(await countOrders(run)).toBe(10);
expect(await checkRules(owner)).toEqual([]);      // added in Task 9; until then assert stock = {onHand:10, reserved:10}
```
Tag it `@slow`; it runs in CI on every change.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `phone.ts`, `address.ts`, `checkout.ts`.
- [ ] **Step 4: Run** → PASS, including 100 concurrency runs.
- [ ] **Step 5: Commit** — `feat(core): cash-on-delivery checkout with fixed-order reservation and idempotency`

---

### Task 7: Confirm, cancel and expire

**Files:**
- Create: `packages/core/src/order-actions.ts`, `packages/core/test/order-actions.test.ts`, `packages/core/test/reservations.model.test.ts`

**Interfaces:**
- Consumes: Task 4 `releaseStock`, `sellReserved`; Task 5 transition tables, `writeAudit`.
- Produces:
  ```ts
  type CancelReason = 'customer_request' | 'unreachable' | 'duplicate' | 'suspected_fraud' | 'out_of_stock' | 'confirmation_window_expired' | 'other';
  type ActionOutcome = { ok: true; version: number } | { ok: false; code: 'conflict'; current: { orderState: OrderState; version: number } } | { ok: false; code: 'not_found' | 'invalid' };
  function confirmOrder(db: Db, a: { orderNumber: string; expectedVersion: number; actor: Actor; method: 'whatsapp' | 'phone'; note?: string }): Promise<ActionOutcome>;
  function cancelOrder(db: Db, a: { orderNumber: string; expectedVersion: number; actor: Actor; reason: CancelReason; note?: string }): Promise<ActionOutcome>;
  function expireStaleOrders(db: Db, now: Date, limit?: number): Promise<{ cancelled: string[] }>;
  ```
- Each action: `update orders set order_state = $to, version = version + 1 where number = $n and order_state = $from and version = $expected returning` → no row = `conflict` with the current state. Then, in the same transaction:
  - confirm: `update reservations set status = 'consumed' where order_id = $id and status = 'held' returning`; for each, `sellReserved` with source key `sold:<reservationId>`; audit `order.confirmed` with `method`, `note`.
  - cancel: `update reservations set status = 'released' where order_id = $id and status = 'held' returning`; for each, `releaseStock` with `release:<reservationId>`; payment `awaiting_collection → voided` (conditional); audit `order.cancelled` with `reason`, `note`. `reason = 'other'` requires a note (else `invalid`).
- `expireStaleOrders`: selects `pending` orders with a `held` reservation past `expires_at`, `for update skip locked`, and cancels each through the same cancel path with actor `system:expiry` and reason `confirmation_window_expired`, using the version it read.

- [ ] **Step 1: Write the failing tests** `order-actions.test.ts`
- `confirm sells reserved stock once and records who` — after confirm: `order_state = 'confirmed'`, `version = 2`, stock `onHand` and `reserved` both down by quantity, audit event `order.confirmed` with `actor_id` = staff email and `entity_version = 2`.
- `cancel releases stock and voids payment` — stock reserved back to 0, onHand unchanged, payment `voided`.
- `cancel with reason other needs a note` → `invalid`.
- `concurrent confirm and cancel` — run both with `expectedVersion: 1` in parallel 50 times on fresh orders: exactly one `ok`, the other `conflict`; stock moved by exactly one movement per reservation.
- `confirm after expiry is a conflict` — order expired by `expireStaleOrders(now + 49h)`, then `confirmOrder(expectedVersion: 1)` → `conflict` with `current.orderState = 'cancelled'`.
- `expiry ignores orders inside the window` — `expireStaleOrders(now + 47h)` cancels nothing.

`reservations.model.test.ts` (rule 4, fast-check `fc.commands`, 300 runs): commands `Place`, `Confirm`, `Cancel`, `Expire(advanceHours)`, `CrashMidway(action)` (the action runs inside a transaction that throws after its first statement). Model: per order, reservation status. After every command: each reservation has flipped at most once; `sum(held quantities) = stock_levels.reserved`; no `held` reservation on a non-pending order.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `order-actions.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(core): confirm, cancel and expiry with conditional transitions`

---

### Task 8: Webhook ingestion and the outbox

**Files:**
- Create: `packages/core/migrations/0004_webhooks_outbox.sql`, `packages/core/src/webhooks.ts`, `packages/core/src/outbox.ts`, `packages/core/test/webhooks.test.ts`, `packages/core/test/outbox.test.ts`

**Interfaces:**
- Schema: `webhook_receipts(id bigserial pk, provider text, event_id text, received_at timestamptz default now(), payload jsonb, unique (provider, event_id))`; `outbox(id bigserial pk, kind text, dedupe_key text unique, payload jsonb, status text check in ('pending','claimed','done'), attempts int default 0, claimed_until timestamptz null, provider_ref text null, created_at, done_at null)`.
- Produces:
  ```ts
  function ingestEvent<P>(db: Db, e: { provider: string; eventId: string; payload: P }, apply: (tx: Tx, payload: P) => Promise<void>): Promise<'applied' | 'duplicate'>;
  function enqueue(tx: Tx, m: { kind: string; dedupeKey: string; payload: unknown }): Promise<void>;     // on conflict do nothing
  interface OutboxHandler { lookup(dedupeKey: string): Promise<string | null>; send(payload: unknown, dedupeKey: string): Promise<string> }
  function deliverNext(db: Db, handlers: Record<string, OutboxHandler>, now: Date, leaseSeconds?: number): Promise<'delivered' | 'reconciled' | 'idle' | 'no_handler'>;
  ```
- `ingestEvent`: one transaction: `insert into webhook_receipts … on conflict do nothing returning id`; no row → `'duplicate'`, else `apply(tx)`. A parallel duplicate blocks on the unique index until the first commits, then sees the conflict.
- `deliverNext`: claim one row (`pending`, or `claimed` with an expired lease) via `update … where id = (select id … for update skip locked limit 1)`, setting `status = 'claimed'`, `attempts + 1`, `claimed_until = now + lease` (default 60 s); commit the claim. If `attempts > 1`, call `lookup(dedupeKey)` first: found → mark `done` with that ref, `'reconciled'`. Else `send`, then mark `done`. In M1 the production handler registry is empty; real handlers arrive with Bosta (M3).

- [ ] **Step 1: Write the failing tests**

`webhooks.test.ts` (rule 8, section G criterion):
```ts
test('the same webhook ten times in parallel changes state once', async () => {
  const order = await placeTestOrder();
  const results = await Promise.all(Array.from({ length: 10 }, () =>
    ingestEvent(app, { provider: 'test', eventId: 'evt-1', payload: { orderNumber: order.number } },
      (tx, p) => confirmInTx(tx, p.orderNumber))));
  expect(results.filter(r => r === 'applied')).toHaveLength(1);
  expect(await orderVersion(order.number)).toBe(2);
  expect(await auditCount(order.number, 'order.confirmed')).toBe(1);
});
test('a failed apply does not record the event, so a retry applies it', /* apply throws once, then succeeds → 'applied' */);
test('out-of-order distinct events each apply once', /* evt-2 before evt-1 → both 'applied' once */);
```
(`confirmInTx` is the confirm path from Task 7 refactored to accept a `Tx`; expose it as `confirmOrderInTx(tx, …)` from `order-actions.ts`.)

`outbox.test.ts` (rule 11):
- `a worker killed between saving and sending sends once` — enqueue; handler `send` records the call then throws (simulating a crash after the provider accepted it); advance `now` past the lease; `deliverNext` again → `lookup` finds the ref → `'reconciled'`; total `send` calls = 1.
- `a crash before sending retries the send` — handler throws before recording → second `deliverNext` sends; total successful sends = 1.
- `two workers never claim the same message` — 20 parallel `deliverNext` on 5 messages → 5 `'delivered'`, 15 `'idle'`.
- `enqueue with the same dedupe key keeps one message`.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** migration, `webhooks.ts`, `outbox.ts`; extract `confirmOrderInTx` / `cancelOrderInTx` in `order-actions.ts` (the `Db` versions wrap them).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(core): idempotent webhook ingestion and exactly-once outbox delivery`

---

### Task 9: The rule checker

**Files:**
- Create: `packages/core/src/rules.ts`, `packages/core/scripts/check-rules.ts`, `packages/core/test/rules.test.ts`
- Modify: `packages/core/test/checkout.concurrency.test.ts` (assert `checkRules` is empty after each run)

**Interfaces:**
- Produces: `type Violation = { rule: number; detail: string; ref?: string }`; `function checkRules(db: Db): Promise<Violation[]>`; `pnpm rules:check` (exits 1 and prints violations when any).
- One query per rule implemented so far:
  - 1: orders whose totals do not add up or whose lines do not sum to `subtotal`.
  - 3: `stock_levels` with `reserved < 0` or `reserved > on_hand`.
  - 4: per variant, sum of `held` reservations ≠ `reserved`; `held` reservations on non-pending orders; `consumed` reservations on non-confirmed orders.
  - 5: `stock_levels` ≠ sum of movement deltas per variant.
  - 6: state combinations outside the allowed set (e.g. `cancelled` order with payment not `voided`); `orders.version` ≠ max `entity_version` of its order audit events.
  - 8 and 11: the unique constraints on `webhook_receipts(provider, event_id)` and `outbox(dedupe_key)` exist (catalog query).
  - 12: `has_table_privilege('dose_app', 'audit_events', 'UPDATE'|'DELETE'|'TRUNCATE')` is false for all three.
- Runs as `dose_owner` (it must read privileges and bypass nothing).

- [ ] **Step 1: Write the failing tests** `rules.test.ts` — a clean database returns `[]`; then, as owner, corrupt one thing per rule (`test.each`: set `reserved` without a movement, flip a reservation to `held` on a confirmed order, bump `orders.version` without an audit event, grant `UPDATE` on `audit_events` to `dose_app`, …) and assert `checkRules` returns a violation with that rule number.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `rules.ts` and the script; wire it into the concurrency test.
- [ ] **Step 4: Run** → PASS (100 concurrency runs, checker empty after each).
- [ ] **Step 5: Commit** — `feat(core): rule checker with one query per commerce rule`

---

### Task 10: The contract and the storefront API

**Files:**
- Modify: `packages/contract/src/index.ts`
- Create: `packages/api/src/app.ts`, `packages/api/src/storefront-routes.ts`, `packages/api/src/webhook-routes.ts`, `packages/api/test/storefront.http.test.ts`, `packages/api/test/webhooks.http.test.ts`, `apps/node-control/src/server.ts`

**Interfaces:**
- Produces in `@dose/contract` (types plus Zod schemas for every request body):
  ```ts
  type Lang = 'ar' | 'en';
  type ImageView = { src: string; alt: string; width: number; height: number };
  type VariantView = { sku: string; kind: 'full' | 'sample' | 'tester'; sizeMl: number; price: number; available: boolean };
  type ProductView = { slug: string; name: string; story: string; labelCopy: string; images: ImageView[]; variants: VariantView[] };
  type BagLine = { sku: string; quantity: number };
  type BagView = { lines: { sku: string; name: string; unitPrice: number; quantity: number; lineTotal: number }[]; subtotal: number; deliveryFee: number; total: number; unavailable: string[] };
  type CheckoutInput = { idempotencyKey: string; lang: Lang; direction: string; lines: BagLine[]; quotedTotal: number; customer: { name: string; phone: string }; address: { governorate: string; area: string; street: string; building: string; landmark?: string } };
  type CheckoutResult = /* CheckoutOutcome minus `replayed`, with `quote` as BagView */;
  interface CommerceActions {
    addToBag(sku: string, quantity?: number): void; updateLine(sku: string, quantity: number): void; removeLine(sku: string): void;
    lines(): BagLine[]; subscribe(fn: (lines: BagLine[]) => void): () => void;
    quote(lang: Lang, governorate?: string): Promise<BagView>;
    checkout(input: Omit<CheckoutInput, 'lines' | 'direction'>): Promise<CheckoutResult>;
  }
  const checkoutInputSchema: z.ZodType<CheckoutInput>; const bagQuoteSchema: z.ZodType<{ lang: Lang; lines: BagLine[]; governorate?: string }>;
  ```
- Produces in `@dose/api`:
  ```ts
  type ApiDeps = { db: () => Db; env: 'local' | 'test' | 'preview' | 'staging' | 'production'; now: () => Date;
                   verifyStaff: (req: Request) => Promise<Staff | null>; webhookProviders: Record<string, WebhookProvider> };
  type WebhookProvider = { verify(req: Request, rawBody: string): Promise<{ eventId: string; payload: unknown } | null>; apply(tx: Tx, payload: unknown): Promise<void> };
  function createApp(deps: ApiDeps): Hono;
  ```
- Routes: `GET /api/products?lang=` → `ProductView[]`; `GET /api/products/:slug?lang=` → `ProductView` or 404; `POST /api/bag/quote` → `BagView`; `POST /api/checkout` → 201 `{ ok: true, orderNumber, total }`, 409 for `price_changed`/`out_of_stock`, 422 for `invalid`, 403 for `checkout_disabled`; `POST /api/webhooks/:provider` → 200 `applied|duplicate`, 401 when `verify` returns null, 404 for unknown providers.
- `POST /api/checkout` sets `surface: 'studio'` when the `Referer` path starts with `/studio/` (defence in depth; the studio client never calls it — Task 15).
- `db()` returns a fresh `Db` per request; the app closes it at the end of the request.
- `apps/node-control/src/server.ts` runs `createApp` with `@hono/node-server` and `createPoolDb(process.env.DATABASE_URL)`.

- [ ] **Step 1: Write the failing tests** with `app.request(...)` against a test database:
  - `GET /api/products?lang=ar` returns Arabic names and Latin slugs; draft products are absent.
  - `POST /api/checkout` with a valid body → 201 and an order number; with a stale `quotedTotal` → 409 with `code: 'price_changed'` and a `quote`; with `Referer: https://x/studio/en/products/paradise` → 403 `checkout_disabled`; with a body failing the schema (e.g. quantity 11) → 422.
  - `webhooks.http.test.ts`: a test provider (HMAC over the raw body with a test secret) — 10 parallel identical posts → exactly one `applied`, order version 2; a bad signature → 401 and no receipt row; unknown provider → 404.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** contract, app, routes, node server.
- [ ] **Step 4: Run** → PASS. Start `apps/node-control` against local Postgres and `curl` `/api/products?lang=en`; expect JSON with both seeded test products.
- [ ] **Step 5: Commit** — `feat(api): typed contract and storefront API on Hono, runnable on Node`

---

### Task 11: Staff authentication, roles and the admin API

**Files:**
- Create: `packages/core/migrations/0005_staff.sql`, `packages/api/src/auth.ts`, `packages/api/src/permissions.ts`, `packages/api/src/admin-routes.ts`, `packages/api/test/auth.test.ts`, `packages/api/test/permissions.test.ts`, `packages/api/test/admin.http.test.ts`

**Interfaces:**
- Schema: `staff(id uuid pk, email citext unique, name text, role text check in ('owner','operations','marketing','accountant'), active bool default true)`.
- Produces:
  ```ts
  type Role = 'owner' | 'operations' | 'marketing' | 'accountant';
  type Staff = { id: string; email: string; name: string; role: Role };
  function createAccessVerifier(o: { teamDomain: string; audience: string; jwks?: JWTVerifyGetKey; env: ApiDeps['env']; lookup: (email: string) => Promise<Staff | null> }): (req: Request) => Promise<Staff | null>;
  const ADMIN_ROUTES: readonly { method: 'GET' | 'POST'; path: string; allow: readonly Role[] }[];
  ```
- `createAccessVerifier`: reads `Cf-Access-Jwt-Assertion`, verifies with `jose.jwtVerify` against `https://<teamDomain>/cdn-cgi/access/certs`, `audience`, issuer `https://<teamDomain>`; takes `email`; returns the active staff row or null. Only when `env === 'local'` does it accept `X-Dev-Staff-Email` instead; in every other env that header is ignored.
- `ADMIN_ROUTES` (the single source of truth; middleware enforces it, the test iterates it):

  | Method | Path | Allow |
  | --- | --- | --- |
  | GET | `/api/admin/me` | all four |
  | GET | `/api/admin/today` | owner, operations, accountant |
  | GET | `/api/admin/orders` (`?state=&q=` phone or order number) | owner, operations, accountant |
  | GET | `/api/admin/orders/:number` (detail + timeline) | owner, operations, accountant |
  | POST | `/api/admin/orders/:number/confirm` `{ expectedVersion, method, note? }` | owner, operations |
  | POST | `/api/admin/orders/:number/cancel` `{ expectedVersion, reason, note? }` | owner, operations |
  | GET | `/api/admin/audit` (`?cursor=`) | owner |

- Today response: `{ toConfirm: { count: number; oldestWaitingMinutes: number | null; orders: OrderSummary[] } }`. Timeline: audit events for the order, oldest first, each `{ at, actorType, actorLabel, action, reason?, note? }`. Confirm/cancel map `conflict` → 409 with the current state, `invalid` → 422. Admin responses set `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow`. Searching by `q` normalises phones with `normalisePhone`.

- [ ] **Step 1: Write the failing tests**
  - `auth.test.ts`: a token signed by a local test JWKS with the right audience → staff; wrong audience, expired, unsigned, unknown email, inactive staff → null; `X-Dev-Staff-Email` works only in `local` (`test.each` over the other four envs → null).
  - `permissions.test.ts`: for every route in `ADMIN_ROUTES` × every role, the request returns 403 when the role is not allowed and not 403 when it is; no staff → 401. Also: every admin route registered on the Hono app appears in `ADMIN_ROUTES` (read the app's route list; fail on any missing).
  - `admin.http.test.ts`: a placed order appears in `today.toConfirm.orders`; `confirm` with the current version → 200 and the timeline shows `order.placed` by the customer then `order.confirmed` by the staff member's name; `confirm` with a stale version → 409 with `current.orderState`; `cancel` with `reason: 'other'` and no note → 422; `GET /api/admin/orders?q=01012345678` finds the order placed with `+201012345678`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** migration, `auth.ts`, `permissions.ts`, `admin-routes.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(api): Access-verified staff, role matrix and admin order API`

---

### Task 12: The web app shell, languages, media and seed

**Files:**
- Create: `apps/web/astro.config.mjs`, `apps/web/wrangler.jsonc`, `apps/web/src/env.ts`, `apps/web/src/pages/api/[...path].ts`, `apps/web/src/pages/media/[...key].ts`, `apps/web/src/pages/index.astro` (redirect), `apps/web/src/middleware.ts`, `apps/web/src/worker-scheduled.ts`
- Create: `packages/core/seed/catalogue.ts`, `packages/core/seed/run.ts`, `packages/core/seed/images/` (owner's photos, or placeholders named `PLACEHOLDER-*.jpg`)
- Create: `playwright.config.ts`, `e2e/shell.spec.ts`

**Interfaces:**
- Consumes: `createApp` (Task 10), `createRequestDb`, `createAccessVerifier`, `expireStaleOrders`, `deliverNext`.
- Produces: `apps/web` builds one Worker. Bindings: `HYPERDRIVE` (Hyperdrive; locally `localConnectionString` → local Postgres as `dose_app`), `MEDIA` (R2), vars `ENVIRONMENT`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`. Compatibility flag `nodejs_compat`. Cron trigger every 5 minutes runs `expireStaleOrders` then `deliverNext` until `'idle'` (max 50).
- `/` redirects to `/ar` when `Accept-Language` prefers Arabic, else `/en`. Layout sets `<html lang dir>`. `GET /media/<key>` streams from R2 with `Cache-Control: public, max-age=31536000, immutable` (keys are content-hashed by the seed).
- Seed (`pnpm seed --target <ownerUrl> --media local|r2`): Paradise and Blanc, 50ML `full` variants, real bilingual copy and label copy from O3 (or `PLACEHOLDER —` prefixed text until then), images uploaded to R2 under `products/<slug>/<sha256>.jpg`, stock received with source key `seed:<sku>`; two staff rows for local use (owner, operations) with `@example.test` emails. Idempotent.
- Playwright projects: `iphone` (WebKit, iPhone 13) and `pixel` (Chromium, Pixel 7); `webServer` runs `astro build && wrangler dev` against local Postgres with `ENVIRONMENT=local`.

- [ ] **Step 1: Write the failing test** `e2e/shell.spec.ts`:
  - `/` with `Accept-Language: ar-EG` redirects to `/ar`; with `en-US` to `/en`.
  - `/ar` has `<html lang="ar" dir="rtl">`; `/en` has `lang="en" dir="ltr"`.
  - `GET /api/products?lang=ar` through the Worker returns the seeded products (proves B10: `pg` via Hyperdrive binding locally).
  - A seeded image URL returns 200 with an `image/*` content type and the immutable cache header.
- [ ] **Step 2: Run** `pnpm e2e e2e/shell.spec.ts` → FAIL.
- [ ] **Step 3: Implement** the Astro app with the Cloudflare adapter, API mount (`ALL` handler passing the request to `createApp(...).fetch`), media route, middleware, scheduled handler, seed.
- [ ] **Step 4: Run** → PASS on both projects. Record B10 in `0003-milestone-1-beliefs.md` (local evidence; confirmed on Cloudflare in Task 17).
- [ ] **Step 5: Commit** — `feat(web): Astro worker shell with languages, API mount, media and seed`

---

### Task 13: Direction 0 storefront: home, product, bag, checkout, confirmation

**Files:**
- Create: `packages/ui/src/tokens.css`, `Button.tsx`, `Dialog.tsx` (focus trap, `Escape`, return focus, `aria-modal`), `Field.tsx` (label, hint, error with `aria-describedby`)
- Create: `packages/shop/src/bag-store.ts`, `packages/shop/src/shop-client.ts`, `packages/shop/src/BagDrawer.tsx`, `packages/shop/src/CheckoutForm.tsx`, `packages/shop/src/i18n.ts`, `packages/shop/test/bag-store.test.ts`
- Create: `directions/d0-baseline/src/{Layout.astro, HomePage.astro, ProductPage.astro, CheckoutPage.astro, ConfirmationPage.astro, tokens.css}`
- Create: `apps/web/src/pages/[lang]/index.astro`, `[lang]/products/[slug].astro`, `[lang]/checkout.astro`, `[lang]/orders/[number]/thanks.astro`
- Create: `e2e/checkout.spec.ts`, `e2e/checkout-validation.spec.ts`, `e2e/a11y.spec.ts`

**Interfaces:**
- Consumes: `@dose/contract` types and schemas; API routes from Task 10.
- Produces:
  ```ts
  function createBagStore(storage?: Pick<Storage, 'getItem' | 'setItem'>): { lines(): BagLine[]; set(lines: BagLine[]): void; subscribe(fn): () => void };  // key 'dose.bag.v1'; any storage error → in-memory
  function createShopClient(o: { surface: 'storefront' | 'studio'; direction: string; fetch?: typeof fetch; store?: ReturnType<typeof createBagStore> }): CommerceActions;
  ```
- The bag island and the checkout form live in `@dose/shop` (hardened, styled only through tokens); `d0-baseline` composes them. The bag island uses `transition:persist="bag"` and Astro's client router is enabled in the D0 layout.
- Pages are server-rendered from `@dose/core` reads via the app's own server code (the page files in `apps/web` load data and pass `ProductView` props to the direction's page component; directions never fetch commerce data themselves).
- Checkout form: name, phone (`inputmode="tel"`, `autocomplete="tel"`), governorate select (27, in the page's language), area, street, building, optional landmark, a plain-language cash-on-delivery note, the bag summary with delivery fee and total, and "Place order". `idempotencyKey` is `crypto.randomUUID()` created when the form mounts and kept until success. On `price_changed` the summary updates and the button reads "Confirm new total"; on `out_of_stock` the short lines are marked and removable. On success: clear the bag, go to `/<lang>/orders/<number>/thanks`.
- Prices render through `formatEgp` inside `<bdi>` so Western digits and currency keep their order in RTL.
- All customer-facing strings come from `packages/shop/src/i18n.ts` (`ar` and `en` objects with identical keys; a unit test asserts identical key sets).

- [ ] **Step 1: Write the failing tests**
  - `bag-store.test.ts`: `bag works when localStorage throws` (storage whose methods throw → add, update and read still work in memory); stored lines survive a new store instance with working storage; malformed stored JSON → empty bag, no throw; quantities clamp to 1–10.
  - `e2e/checkout.spec.ts`, for `ar` and `en` on both phone projects: home → product (Paradise) → add to bag → open bag (count 1) → navigate to Blanc → bag still shows 1 → checkout → fill a valid test customer (`010` number generated per test) → place order → thanks page shows a `D\d{5,}` order number → `GET /api/admin/orders/<n>` (dev header, owner) shows `pending`.
  - `double tap places one order` — click "Place order" twice quickly; the admin API lists exactly one order for that phone.
  - `stale bag shows the new total` — seed the bag, change the variant price through the owner DB helper, submit → new total shown, button "Confirm new total", second submit succeeds at the new price.
  - `e2e/checkout-validation.spec.ts`: `٠١٠١٢٣٤٥٦٧٨` is accepted; `0223456789` shows the phone error in the page's language; empty street shows its error; errors are announced (`aria-invalid`, `aria-describedby`).
  - `e2e/a11y.spec.ts`: axe on home, product, checkout and thanks in both languages → no `serious` or `critical` violations; the bag dialog traps focus and `Escape` closes it, returning focus to the bag button.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** primitives, shop package, Direction 0 pages and app routes.
- [ ] **Step 4: Run** `pnpm e2e` → PASS on both projects.
- [ ] **Step 5: Commit** — `feat(storefront): Direction 0 in Arabic and English with bag and COD checkout`

---

### Task 14: Speed and accessibility gates in CI

**Files:**
- Create: `lighthouserc.cjs`
- Modify: `.github/workflows/ci.yml` (e2e job and Lighthouse job against the local Worker build)

**Interfaces:**
- Lighthouse CI, mobile preset (default Lighthouse mobile emulation and throttling), 3 runs per URL, median, on `/en/products/paradise` and `/ar/products/paradise`:
  - `largest-contentful-paint` ≤ 2500 (error)
  - `resource-summary:script:size` ≤ 112640 (error; transfer bytes, per the approved interpretation)
  - `categories:accessibility` ≥ 0.95 (error)
- CI uploads the Lighthouse reports and Playwright traces as artefacts.

- [ ] **Step 1: Write the failing gate** — add `lighthouserc.cjs` with the assertions and temporarily add a 200 KB dummy script import to `ProductPage.astro`.
- [ ] **Step 2: Run** `pnpm lhci` → FAIL on `resource-summary:script:size`. Remove the dummy import.
- [ ] **Step 3: Run** `pnpm lhci` → PASS; record LCP and JS bytes for both languages in `docs/progress.md`.
- [ ] **Step 4: Add both jobs to `ci.yml`**; push; CI green.
- [ ] **Step 5: Commit** — `ci: speed budget and accessibility gates for the Direction 0 product page`

---

### Task 15: Studio slice: a second direction behind staff login, checkout refused

**Files:**
- Create: `directions/x1-studio/src/{ProductPage.astro, MotionHero.tsx, tokens.css}`
- Create: `apps/web/src/pages/studio/[lang]/products/[slug].astro`, `apps/web/src/studio-guard.ts`
- Create: `apps/web/test/studio-guard.test.ts`, `e2e/studio.spec.ts`
- Modify: `lighthouserc.cjs` (studio page, same budget, warn-only)

**Interfaces:**
- Consumes: `ProductView` (Task 10), `createShopClient({ surface: 'studio', direction: 'x1-studio' })` (Task 13), `createAccessVerifier` (Task 11).
- Produces: `function guardStudio(req: Request, verify: (r: Request) => Promise<Staff | null>): Promise<Response | null>` — returns a 401/403 response, or null to continue. Every `/studio/*` response sets `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow`. `robots.txt` disallows `/studio/` and `/admin/`.
- `/studio/<lang>/products/<slug>` renders X1's product page from the same `ProductView` the storefront uses. X1 replaces the whole page (its own layout and navigation) and adds `MotionHero`: a 2D canvas animation with `transition:persist="hero"`, paused when hidden, a static frame under `prefers-reduced-motion`. On mount it sets `canvas.dataset.instance` to a random id once.
- The studio shop client's `checkout()` returns `{ ok: false, code: 'checkout_disabled' }` without a network call; X1's checkout button shows "Checkout is disabled in the studio" / "الدفع غير متاح في الاستوديو".

- [ ] **Step 1: Write the failing tests**
  - `studio-guard.test.ts`: no staff → 401; staff → null (continue); the cache and robots headers are set on studio responses.
  - `e2e/studio.spec.ts` (dev header as owner): `/en/products/paradise` and `/studio/en/products/paradise` show the same product name, price and label copy from one `ProductView`, with different layouts (D0 root has `data-direction="d0-baseline"`, X1 has `data-direction="x1-studio"`); in the studio, add to bag then press checkout → the disabled message, and Playwright records no `POST /api/checkout`; a direct `POST /api/checkout` with a studio `Referer` → 403; navigating Paradise → Blanc inside the studio keeps the same `canvas.dataset.instance` and the bag count; without the dev header the studio returns 401.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the X1 direction, motion hero, guard and route.
- [ ] **Step 4: Run** `pnpm check && pnpm e2e` → PASS (boundaries confirm X1 imports nothing from core).
- [ ] **Step 5: Commit** — `feat(studio): exploratory product page from the same contract; checkout refused`

---

### Task 16: Admin slice: Today, orders, timeline, confirm and cancel, audit log

**Files:**
- Create: `apps/admin/src/{AdminApp.tsx, api.ts, routes/Today.tsx, routes/Orders.tsx, routes/OrderDetail.tsx, routes/Audit.tsx, ConfirmDialog.tsx, CancelDialog.tsx, i18n.ts}`
- Create: `apps/web/src/pages/admin/[...path].astro` (mounts `AdminApp` with `client:only="react"`; guarded like the studio)
- Create: `apps/admin/test/*.test.tsx` (React Testing Library), `e2e/order-to-admin.spec.ts`

**Interfaces:**
- Consumes: the admin routes and response shapes from Task 11.
- Produces: an admin SPA at `/admin` (React Router, `basename="/admin"`), English UI for M1 (Arabic admin is not in section G), usable at 375 px wide.
  - **Today:** "Orders to confirm" with count and oldest waiting time, refreshed every 5 s and on window focus; each row opens the order.
  - **Orders:** table with search box (phone or order number) and state filter.
  - **Order detail:** customer, address, lines, totals, the three states with plain-language explanations, timeline, and "Confirm" / "Cancel" buttons shown only to roles that may use them.
  - **ConfirmDialog:** method (WhatsApp / phone call) required, optional note; a WhatsApp click-to-chat link `https://wa.me/<digits>` opens prefilled with a short bilingual confirmation message in the order's language.
  - **CancelDialog:** reason required from the seven `CancelReason`s, note required for "Other".
  - A 409 shows "This order changed while you were looking at it: it is now <state>." and reloads the order.
  - **Audit:** owner only; newest first, paged by cursor.

- [ ] **Step 1: Write the failing tests**
  - Component tests: Confirm is disabled until a method is chosen; Cancel with "Other" requires a note; a 409 response shows the conflict message with the current state; an operations user sees Confirm and Cancel, an accountant sees neither; the Audit link is visible only to the owner.
  - `e2e/order-to-admin.spec.ts` (section G criterion 1, both languages, both phone projects): place an order on the storefront → within 10 s it is on Today without a manual reload → open it → confirm via WhatsApp as the operations user → the order shows `confirmed`, and the timeline lists "Placed by customer +2010…" then "Confirmed by <operations name> · WhatsApp"; the owner's Audit page shows the same two events.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the admin app and mount.
- [ ] **Step 4: Run** `pnpm check && pnpm e2e` → PASS.
- [ ] **Step 5: Commit** — `feat(admin): Today view, order queue and detail with timeline, confirm and cancel, audit log`

---

### Task 17: Cloud environments and staging (needs O2)

**Files:**
- Modify: `apps/web/wrangler.jsonc` (envs `staging`, `poc`, `production`; placement; Hyperdrive and R2 bindings; cron)
- Create: `.github/workflows/staging.yml`, `docs/runbooks/environments.md`, `apps/web/src/pages/api/_diag/read-your-writes.ts` (non-production only, staff only)
- Modify: `docs/decisions/0003-milestone-1-beliefs.md`, create `docs/decisions/0006-environments-and-data-separation.md`

**Interfaces:**
- Neon: project `dose-production` (Frankfurt, `aws-eu-central-1`): migrated, empty, no Worker bound to it in M1. Project `dose-nonprod` (Frankfurt): branch `main` (migrated) → `seed` (catalogue and staff seeded, no customers) → children `staging` and `poc`. Two separate projects mean no nonprod credential can reach production. Migration `0006_env_identity.sql` adds `env_identity(name text)`; each branch gets its row when created (see Task 18).
- Cloudflare: Hyperdrive configs `dose-staging` and `dose-poc` created with caching disabled, each pointing at its branch as `dose_app`; R2 buckets `dose-media-nonprod` and `dose-media-prod`; Worker `dose-web` with `staging` and `poc` environments on `workers.dev`, placement hint for `aws:eu-central-1`; Access applications for the staging and poc hostnames (whole host; one-time PIN; the owner's and the reviewer's emails), producing `ACCESS_AUD` per app; an Access service token for CI and the PoC runner.
- GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `NEON_API_KEY`, `NEON_NONPROD_PROJECT_ID`, `NEON_PROD_PROJECT_ID`, `NONPROD_OWNER_URL` (migrations), `CF_ACCESS_CLIENT_ID/SECRET`. Production database credentials are not stored in GitHub in M1.
- `staging.yml`: on push to `main` after CI passes — run migrations on `staging`, `wrangler deploy --env staging`, run `e2e/order-to-admin.spec.ts` against the staging URL with the Access service token.
- `GET /api/_diag/read-your-writes`: writes a row to a `diag` table and immediately reads it back through Hyperdrive 20 times; returns `{ consistent: boolean, colo, placement }`.

- [ ] **Step 1: Check prices (B11)** — read Neon's and Fly.io's pricing pages and record the figures against the cost table in `0003`. Stop and tell the owner if either exceeds the plan's range.
- [ ] **Step 2: Create the resources** listed above with the owner's accounts (owner present for anything needing billing).
- [ ] **Step 3: Verify B5** — on `dose-nonprod/main`, migrations create `dose_app` and the audit privileges; create a fresh child branch and run `rules.test.ts`'s rule-12 query there → no violation. Record.
- [ ] **Step 4: Verify B1, B2, B3** — deploy `poc`; call `/api/_diag/read-your-writes` → `consistent: true`; record the reported colo/placement; repeat once with a temporary Hyperdrive config that has caching enabled and record whether reads went stale (then delete that config); run `checkout.concurrency.test.ts` logic once through the deployed `poc` Worker (one run of 200) → exactly 10 orders. Record each in `0003`.
- [ ] **Step 5: Add `staging.yml`**, merge to `main`; the workflow deploys staging and the staging e2e passes.
- [ ] **Step 6: Write** `0006` (projects, branches, roles, why production is a separate project) and `docs/runbooks/environments.md` (how to create, reset and delete each environment).
- [ ] **Step 7: Commit** — `infra: Neon projects, Hyperdrive without caching, Access-protected staging`

---

### Task 18: A preview and database branch for every change (needs O2)

**Files:**
- Create: `.github/workflows/preview.yml`, `.github/workflows/preview-cleanup.yml`, `test/preview/preview-isolation.test.ts`

**Interfaces:**
- `preview.yml` on `pull_request` (opened, synchronize): (1) create or reuse Neon branch `preview/pr-<n>` from `seed` in `dose-nonprod`; (2) run migrations; (3) create or update Hyperdrive config `dose-pr-<n>` (caching disabled) for that branch; (4) `wrangler versions upload --env staging --preview-alias pr-<n>` with that Hyperdrive binding; (5) run the isolation test; (6) comment the preview URL on the pull request; (7) fail if more than 300 seconds passed between the workflow's start and the comment, and write the duration to the job summary.
- `preview-cleanup.yml` on `pull_request` closed: delete the Neon branch and the Hyperdrive config.
- `preview-isolation.test.ts` (runs inside `preview.yml` with the preview's connection details):
  ```ts
  test('the preview database is a nonprod branch', async () =>
    expect(await neonEndpointHosts(NEON_NONPROD_PROJECT_ID)).toContain(PREVIEW_DB_HOST));   // Neon API: list the project's endpoints
  test('preview credentials cannot connect to production', async () => {
    await expect(connect(withHost(PREVIEW_APP_URL, PROD_DB_HOST))).rejects.toThrow(/password authentication failed|role .* does not exist|not found/i);
  });
  test('the preview holds no customers or orders', async () => {
    expect(await count('customers')).toBe(0); expect(await count('orders')).toBe(0);
  });
  test('the deployed preview reports a nonprod database', async () => {
    const r = await fetchWithAccess(`${PREVIEW_URL}/api/_diag/db-identity`); expect((await r.json()).identity).toBe(`nonprod:preview/pr-${PR}`);
  });
  ```
  (`PROD_DB_HOST` is the production endpoint's hostname — not a secret; no production credential exists in CI.) Each database records what it is in a one-row table `env_identity(name text)`, written when the branch is created (`production`, `nonprod:seed`, `nonprod:staging`, `nonprod:poc`, `nonprod:preview/pr-<n>`); a Worker cannot read the real database host through Hyperdrive, so it asks the database. Add `GET /api/_diag/db-identity` (non-production only, staff only) returning `{ identity }`. Task 17 adds the table to the migrations and writes the rows for the branches it creates.

- [ ] **Step 1: Write** the isolation test and the workflows.
- [ ] **Step 2: Verify B6** — open a test pull request; confirm the preview version uses its own Hyperdrive binding (`/api/_diag/db-identity` reports `preview/pr-<n>`'s branch) and check the account's Hyperdrive config limit; record in `0003`.
- [ ] **Step 3: Verify B7** — enable Access on the Worker's `workers.dev` and preview URLs; an unauthenticated request to the preview URL is redirected to the Access login; record.
- [ ] **Step 4: Run** the test pull request end to end: the preview comment appears in under 300 s, the isolation tests pass, and closing the pull request deletes the branch and config.
- [ ] **Step 5: Prove the duration gate fails** — temporarily add a 320 s sleep step, confirm the job fails, remove it.
- [ ] **Step 6: Record** the measured times of three consecutive pull requests in `docs/progress.md`.
- [ ] **Step 7: Commit** — `ci: per-change preview with its own Neon branch, isolation test and five-minute gate`

---

### Task 19: Proof of concept 1: Workers versus the Node container (needs O2)

**Files:**
- Create: `apps/node-control/Dockerfile`, `apps/node-control/fly.toml` (region `fra`), `apps/node-control/src/poc-auth.ts`
- Create: `poc/concurrency.ts`, `apps/web/src/pages/poc/latency.astro` (non-production only, staff only)
- Create: `docs/decisions/0004-runtime-workers-or-container.md` (draft with measurements)

**Interfaces:**
- The container runs `createApp` from `@dose/api` on Node against the `poc` branch (`dose_app`), behind `Authorization: Bearer <POC_TOKEN>` (random, destroyed after Gate 1), CORS allowing only the poc Worker origin.
- `poc/concurrency.ts --target <url> --runs 100 --concurrency 200 --units 10` with env `POC_OWNER_URL` and Access service-token or bearer headers: per run, reset a dedicated `poc-concurrency` variant to 10 units through the owner connection, fire 200 checkouts with distinct keys and generated test phones, then assert exactly 10 `201`s, 190 `409 out_of_stock`, 10 orders for that run in the database, and `checkRules` empty. Prints a per-run line and a final summary; exits 1 on any failed run.
- `/poc/latency`: on the owner's phone, runs 50 checkouts against the Worker and 50 against the container, interleaved, each a full `POST /api/checkout` for a `poc-latency` variant with large stock; shows p50, p95 and p99 per target, the ratio `worker_p95 / container_p95`, the network type if the browser exposes it, and a "copy results" button producing JSON.
- Decision rule (section A, unchanged): if the Worker's p95 measured from a phone in Egypt is more than 1.5 × the container's, the core moves to the container.

- [ ] **Step 1: Deploy** the container to Fly.io Frankfurt and the `poc` Worker; smoke both with `GET /api/products?lang=en`.
- [ ] **Step 2: Run** `poc/concurrency.ts` against the Worker (100 runs) and against the container (100 runs). Both must pass (B4: if the Worker fails from connection limits, record the error and the Hyperdrive/Neon limits involved, and stop for the owner).
- [ ] **Step 3: Run** `/poc/latency` from a desktop browser as a reference measurement; record it (it does not decide).
- [ ] **Step 4: Draft `0004`** with both concurrency summaries and the reference latency; the phone measurement is added in Task 20.
- [ ] **Step 5: Commit** — `poc: concurrency runner and latency page for Workers versus Node container`

---

### Task 20: Field checks on the owner's phones and the Gate 1 decision records (needs O2, O4)

**Files:**
- Modify: `docs/decisions/0003-milestone-1-beliefs.md`, `docs/decisions/0004-runtime-workers-or-container.md`
- Create: `docs/decisions/0005-storefront-astro-or-react-router.md`, `docs/runbooks/field-check-m1.md`
- Modify: `docs/progress.md`

The owner does steps 2–4 with a written checklist (`field-check-m1.md`); the implementer prepares, observes over a call or from the owner's screenshots, and records.

- [ ] **Step 1: Write** `field-check-m1.md`: the links (sent to the owner in an Instagram DM so they open in Instagram's browser), what to tap, what to screenshot, and what counts as pass.
- [ ] **Step 2: Criterion 1 on the iPhone and the Android, in Instagram:** log in through Access (B8); place a COD order in Arabic and one in English on staging; open the admin on the phone; each order is on Today within seconds; confirm one; its timeline and the Audit page show the owner's name. Record pass/fail and screenshots.
- [ ] **Step 3: Persistence and speed in Instagram (B9, criterion 6):** on both phones, open the Direction 0 Paradise page, add to bag, move to Blanc and back; the bag keeps its count and does not flash. Open the studio X1 page, move Paradise → Blanc; the hero keeps animating without restarting and the bag persists; press checkout → the disabled message. Note how the D0 page feels; record the CI Lighthouse figures alongside.
- [ ] **Step 4: Latency from a phone in Egypt (criterion 7):** the owner runs `/poc/latency` on the Android on mobile data (and Wi-Fi if possible) and copies the results JSON.
- [ ] **Step 5: Write `0004`** — measurements, the 1.5× rule applied, and the decision: keep Workers or move the core to the container. **Write `0005`** — the persistence and canvas results on both phones against the speed budget, and the decision: keep Astro or move the storefront to React Router. If either says switch, stop and present it to the owner before M2.
- [ ] **Step 6: Close beliefs** — every row in `0003` has a result and evidence; any belief that failed has a note on what it changes.
- [ ] **Step 7: Gate 1 summary** in `docs/progress.md`: each section G acceptance criterion with its evidence link; destroy the `POC_TOKEN` and the container if `0004` keeps Workers.
- [ ] **Step 8: Commit** — `docs: Gate 1 decision records with measurements`

---

## Execution notes

- Tasks 1–16 need nothing from outside the repository and can start as soon as O1 is given. Tasks 17–20 start when O2 arrives; if it is late, Tasks 1–16 continue and the Gate 1 date moves, not the scope.
- Order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 are sequential (each extends the schema). 10 → 11 follow. 12 → 13 → 14 → 15 → 16 follow 11. Task 15 and Task 16 touch different files and may run in parallel once 13 is merged.
- Money, login and webhook code (Tasks 3–11, 17, 18) is flagged in each pull request for the senior reviewer once engaged; until then the plan's tests are the only check, which section E calls out as a risk.
