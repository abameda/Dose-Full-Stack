# Environments

## Build and deploy a Worker environment

`apps/web/wrangler.jsonc` declares two cloud environments, `staging` (Worker `dose-web-staging`)
and `poc` (Worker `dose-web-poc`). The top level of the file is local development and the
fail-closed default; it is never deployed, and there is no `production` environment in Milestone 1.

The environment is chosen when the Worker is **built**, not when it is deployed. With
`CLOUDFLARE_ENV` set, the Astro Cloudflare adapter (through `@cloudflare/vite-plugin`) writes
`apps/web/dist/server/wrangler.json` already resolved for that environment (its name, vars,
Hyperdrive binding, placement and crons, with `"targetEnvironment"` set to the environment) and
points `apps/web/.wrangler/deploy/config.json` at it. `wrangler deploy` reads that redirected
configuration, so it is called **without** `--env`. (With `--env` naming another environment it
refuses: "This does not match the target environment … that was used when building the
application". With the same name it is accepted but adds nothing.)

From the repository root, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set (DÖSE's
account, `a61331a1643fa91a513c9cb775d7d619`):

```sh
# staging
CLOUDFLARE_ENV=staging pnpm --filter @dose/web build
pnpm --filter @dose/web exec wrangler deploy

# poc
CLOUDFLARE_ENV=poc pnpm --filter @dose/web build
pnpm --filter @dose/web exec wrangler deploy
```

Always build and deploy as a pair: the deploy uploads whatever environment the last build was for.
To check a build before deploying it, add `--dry-run --outdir <dir>` to the deploy (nothing is
uploaded, no login is needed) and read `apps/web/dist/server/wrangler.json`: `name`,
`targetEnvironment`, `vars.ENVIRONMENT`, `hyperdrive[0].id`, `placement`, `triggers.crons` and an
empty `r2_buckets` must be the environment's.

Notes:

- `pnpm --filter @dose/web build` first writes the seed photos to `apps/web/public/media/`
  (`seed:media`), so they are served as static assets at `/media/<key>` with
  `apps/web/public/_headers`; the cloud environments have no R2 bucket until launch
  (decision 0011). Seed their database with `pnpm seed --media none`.
- Each environment declares `"r2_buckets": []` (decision 0011). Wrangler 4.147.0 still warns
  during the build that the top-level `MEDIA` binding is "not on env.<name>". That is intended:
  the top-level bucket is local development's.
- The Astro adapter adds a `SESSION` KV namespace binding without an ID (Astro sessions; the app
  does not use them). Wrangler 4.147.0's resource provisioning (`provisionBindings`) handles a
  binding without an ID on a real deploy, so expect it to create or ask for a KV namespace on the
  first deploy of each Worker. Not yet observed against Cloudflare.
- Migrate the environment's database before deploying a build that needs the new schema:
  `pnpm migrate --target "$OWNER_URL" --allow-remote`.

## Previews

Every pull request from this repository gets a preview: the change running as a **version of the
`dose-web-staging` Worker** on its own Neon branch. Pull requests from forks get none (no secrets
there).

`.github/workflows/preview.yml` runs on `opened`, `synchronize` and `reopened`; a new push cancels
the run for the previous one. In order:

1. Creates the Neon branch `preview/pr-<n>` from `seed` in the nonprod project, or reuses it.
2. Migrates it (`pnpm migrate`, before the build, so a schema change is applied first) and names it
   `nonprod:preview/pr-<n>` (`pnpm env:identity`; an idempotent write, repeated on every run so a
   cancelled first run cannot leave the branch calling itself `nonprod:seed`, its parent's name).
3. Creates the Hyperdrive config `dose-pr-<n>` (caching disabled, `dose_app` on the branch's
   read-write endpoint, port 5432, database `dose`), or reuses it, updating its origin only when the
   branch's host changed.
4. Builds staging (`CLOUDFLARE_ENV=staging`), then rewrites `apps/web/dist/server/wrangler.json`:
   `hyperdrive[0].id` becomes the preview's config and `vars.ENVIRONMENT` becomes `preview`;
   everything else (Access vars included) stays staging's. Uploads it without `--env` as
   `wrangler versions upload --preview-alias pr-<n>`. The version is never deployed: staging keeps
   serving its own deployed version, and the preview runs no cron.
5. Runs `pnpm test:preview` (`test/preview/preview-isolation.test.ts`): the branch is in the
   nonprod project, the preview's `dose_app` credentials are refused by the production host, the
   branch holds no customers or orders, the preview reports `nonprod:preview/pr-<n>` from
   `/api/_diag/db-identity`, and without Access credentials the preview URL does not reach the app
   (belief B7).
6. Comments the preview URL, the commit and the time taken on the pull request (one comment,
   updated on later runs), and fails when that took more than `PREVIEW_MAX_SECONDS` (300) from the
   run's start. The time is in the job summary either way.

The preview URL is `https://pr-<n>-dose-web-staging.<WORKERS_SUBDOMAIN>.workers.dev`. Preview URLs
exist only once staging has been deployed with `"preview_urls": true` (set in `env.staging`), and
they need the same Cloudflare Access protection as the `workers.dev` URL.

`.github/workflows/preview-cleanup.yml` runs when the pull request closes, merged or not: it deletes
the Neon branch `preview/pr-<n>` and the Hyperdrive config `dose-pr-<n>`, matched by exact name, and
treats a missing one as already deleted, so a re-run passes. It shares the preview's concurrency
group, so a preview still being set up is cancelled first. The uploaded version and its alias stay;
without its Hyperdrive config it reaches no database.

`pnpm test:preview` is not part of `pnpm check`. Without its environment it fails at once and names
every missing variable.

### The free-tier ceiling

Neon Free allows 10 branches per project and Cloudflare Free 10 Hyperdrive configs per account.
`main`, `seed`, `staging` and `poc` use 4 branches, and staging and poc 2 configs, so about **6 pull
requests can have a preview at once**. The next one fails at its Neon branch (or Hyperdrive config)
step: close a pull request, or delete a stuck preview by hand, then re-run it.

### Delete a stuck preview by hand

When cleanup did not run, or a preview is left over. With `NEON_API_KEY` for the nonprod project and
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for DÖSE's account
(`a61331a1643fa91a513c9cb775d7d619`). Check every name before deleting: never `main`, `seed`,
`staging` or `poc`, and never the staging or poc config.

```sh
# Neon: find the branch named preview/pr-<n>, then delete it by its ID
npx -y neonctl@8.0.11 branches list --project-id "$NEON_NONPROD_PROJECT_ID" --no-analytics
npx -y neonctl@8.0.11 branches delete <branch ID> --project-id "$NEON_NONPROD_PROJECT_ID" --no-analytics

# Hyperdrive: find the config named dose-pr-<n>, then delete it by its ID
pnpm --filter @dose/web exec wrangler hyperdrive list
pnpm --filter @dose/web exec wrangler hyperdrive delete <config ID>
```

Re-running the pull request's "Preview cleanup" run in GitHub Actions does the same, for that pull
request only.

## Proof of concept (Milestone 1 only)

Task 19 runs the same commerce core on the `poc` Worker (`dose-web-poc`, Hyperdrive to the Neon
`poc` branch) and on a Node container on Fly.io in Frankfurt (`apps/node-control`, app
`dose-node-control`, `dose_app` on the same branch), proves both under concurrency, and measures
checkout latency from a phone. Decision rule (master plan, section A): if the Worker's p95 measured
from a phone in Egypt is more than 1.5 times the container's, the core moves to the container.
Everything here is torn down after Gate 1.

Commands only: every value comes from an exported shell variable (set from a password manager or
with `read -s`), never from this file or a command line. Run from the repository root.

### The poc database

Before the first run the `poc` branch is migrated and names itself `nonprod:poc` (the runner
refuses any other database):

```sh
pnpm migrate --target "$POC_OWNER_URL" --allow-remote
pnpm env:identity --target "$POC_OWNER_URL" --allow-remote --name nonprod:poc
```

The runner creates the two poc products itself (`poc-concurrency` / `POC-CONCURRENCY` and
`poc-latency` / `POC-LATENCY`, placeholder copy saying they exist only for the proof of concept)
and keeps at least 10,000 units of `POC-LATENCY` free for the latency page. Run it once (even
`--runs 1`) before opening the page.

### The container (Fly.io)

The trial allows about 2 hours of machine time in all (decision 0009): the machine runs only while
measuring. `apps/node-control/fly.toml` repeats these commands in its header.

```sh
fly apps create dose-node-control
# A fresh token, kept in this shell only (the Worker gets the same one, below):
POC_TOKEN="$(openssl rand -hex 32)"
POC_ALLOWED_ORIGIN="https://dose-web-poc.$WORKERS_SUBDOMAIN.workers.dev"
# DATABASE_URL: dose_app on the poc branch. printf is a shell builtin, so no value appears on a
# process's command line; --stage sets the secrets without starting anything.
printf 'DATABASE_URL=%s\nPOC_TOKEN=%s\nPOC_ALLOWED_ORIGIN=%s\n' "$DATABASE_URL" "$POC_TOKEN" "$POC_ALLOWED_ORIGIN" \
  | fly secrets import --app dose-node-control --stage
# Built here by the local Docker (no remote builder), one machine only. The `.` keeps the build
# context at the repository root despite --config.
fly deploy . --config apps/node-control/fly.toml --dockerfile apps/node-control/Dockerfile --local-only --ha=false
```

The image can be checked locally first: `docker build -f apps/node-control/Dockerfile .` (the root
`.dockerignore` keeps the context small). Without `POC_TOKEN` (32 characters or more) or
`POC_ALLOWED_ORIGIN` the container stops at start. Every request needs
`Authorization: Bearer <POC_TOKEN>`, and anything else is a 401, so Fly's health check is TCP only.
Smoke it with `curl -H "Authorization: Bearer $POC_TOKEN" "https://dose-node-control.fly.dev/api/products?lang=en"`.

Stop the machine as soon as a measurement is done, and start it just before the next:

```sh
fly machine list --app dose-node-control
fly machine stop <machine id> --app dose-node-control
fly machine start <machine id> --app dose-node-control
```

`auto_stop_machines` also stops an idle machine and the next request starts it again; that first
request pays the start-up, which is one reason every measurement begins with a warm-up.

### The poc Worker's two settings

The latency page needs the container's origin (`POC_CONTAINER_URL`, a var, `""` in
`wrangler.jsonc`) and its token (`POC_TOKEN`, a Worker secret). With the container's `POC_TOKEN`
in the shell:

```sh
CLOUDFLARE_ENV=poc pnpm --filter @dose/web build
printf '%s' "$POC_TOKEN" | pnpm --filter @dose/web exec wrangler secret put POC_TOKEN --name dose-web-poc
pnpm --filter @dose/web exec wrangler deploy --var POC_CONTAINER_URL:https://dose-node-control.fly.dev
```

Not yet observed against Cloudflare: that `wrangler secret put --name dose-web-poc` targets the poc
Worker while the redirected build configuration is in place, and that `--var` on the deploy reaches
the built configuration. Check with `wrangler secret list --name dose-web-poc` and by opening the
page (it names a missing setting).

### The concurrency proof (`pnpm poc:concurrency`)

Per run, `POC-CONCURRENCY` is reset to exactly `--units` free units (one ledger adjustment through
the owner connection), `--concurrency` checkouts are fired at once, and the run passes only with
exactly `--units` 201s, every other answer a 409 `out_of_stock`, that many orders in the database
for the run's idempotency keys and `checkRules` empty. Any other status, network error or timeout
(60 s) fails the run and is named with its message: that is how belief B4 is judged. The runner
prints a line per run and a summary, appends a JSON line per run with `--out` (relative to the
directory the command is typed in), and exits 1 when any run failed.

```sh
# The Worker, through Access: POC_OWNER_URL, CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET exported
# (the service token is an active staff member on the poc branch).
pnpm poc:concurrency --target "https://dose-web-poc.$WORKERS_SUBDOMAIN.workers.dev" --auth access \
  --runs 40 --concurrency 200 --units 10 --out poc-worker.jsonl

# The container (its machine started): POC_OWNER_URL and POC_TOKEN exported.
pnpm poc:concurrency --target https://dose-node-control.fly.dev --auth bearer \
  --runs 100 --concurrency 200 --units 10 --out poc-container.jsonl
```

Hyperdrive's free plan allows 100,000 queries a day. One run of 200 checkouts costs roughly 1,900
of them (an estimate from the statements one checkout runs, about 15 for a placed order and 9 for a
refusal; not yet measured), so the Worker's 100 runs are split over three days, continuing the
numbering and the evidence file: day 1 `--runs 40`, day 2 `--start 41 --runs 40`, day 3
`--start 81 --runs 20`. Read the day's query count in the Hyperdrive dashboard after day 1 and
adjust the split. The container's runs do not touch Hyperdrive.

### The latency page (`/poc/latency`)

Open `https://dose-web-poc.<subdomain>.workers.dev/poc/latency`, signed in through Access as staff.
`/poc/...` is a staff area (private, not indexed, a 401 without staff) and a 404 in production. The
page prices one unit of `POC-LATENCY`, warms up each target once (not counted: Neon sleeps after 5
minutes, decision 0009, and the container's CORS preflight is cached for the rest), then runs 50
checkouts against the Worker (same origin) and 50 against the container (with the bearer token),
interleaved and one at a time. It shows n, p50, p95, p99 (nearest rank), min and max per target,
the ratio `worker_p95 / container_p95` and whether it exceeds 1.5, the network type where the
browser exposes it, the user agent and the time. "Copy results" puts all of it and every timing on
the clipboard as JSON, or shows it in a box to copy by hand where the clipboard is refused (in-app
browsers). Without `POC_CONTAINER_URL` or `POC_TOKEN` the page says so and runs nothing.

The page sends the container's token to the browser. That is acceptable only because the page is
staff only, private and never in production, and the token is destroyed with the container.

### Teardown after Gate 1

```sh
fly apps destroy dose-node-control                     # machines, secrets and image
pnpm --filter @dose/web exec wrangler secret delete POC_TOKEN --name dose-web-poc
```

Then either delete the whole `poc` Neon branch (by its ID, as for a stuck preview above, after
checking its name is exactly `poc`), or keep the branch and take the two products off sale through
the owner connection (orders reference them, so they are unpublished rather than deleted):

```sql
update variants set status = 'archived' where sku in ('POC-CONCURRENCY', 'POC-LATENCY');
update products set status = 'draft' where slug in ('poc-concurrency', 'poc-latency');
```

Finally remove the proof-of-concept code: `poc/` (and its entries in `pnpm-workspace.yaml`, the
root `package.json` and `vitest.config.ts`), `apps/web/src/pages/poc/`, `poc` in
`apps/web/src/staff-guard.ts`, and `POC_CONTAINER_URL` in `apps/web/wrangler.jsonc`.
