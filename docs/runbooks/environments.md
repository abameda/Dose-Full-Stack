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
- The build prints a warning that `r2_buckets` exists at the top level but not on the
  environment. That is intended (decision 0011).
- The Astro adapter adds a `SESSION` KV namespace binding without an ID (Astro sessions; the app
  does not use them). Wrangler 4.147.0's resource provisioning (`provisionBindings`) handles a
  binding without an ID on a real deploy, so expect it to create or ask for a KV namespace on the
  first deploy of each Worker. Not yet observed against Cloudflare.
- Migrate the environment's database before deploying a build that needs the new schema:
  `pnpm migrate --target "$OWNER_URL" --allow-remote`.
