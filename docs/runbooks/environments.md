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
