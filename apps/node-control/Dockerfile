# The Node "control" container of the proof of concept (Milestone 1, Task 19): the commerce API
# (`createApp` from @dose/api) on Node, over a `pg` pool. Built from the repository root, which is
# the build context (the workspace and its lockfile live there); see the root .dockerignore:
#
#   docker build -f apps/node-control/Dockerfile -t dose-node-control .
#
# Run it with DATABASE_URL (dose_app), ENVIRONMENT=staging, POC_TOKEN and POC_ALLOWED_ORIGIN
# (src/server.ts). On Fly.io: apps/node-control/fly.toml.

# Build: only @dose/node-control and the workspace packages it needs (@dose/api, @dose/core,
# @dose/contract), with their production dependencies, from the committed lockfile.
FROM node:24.16.0-slim AS build
# The pnpm of the root package.json's `packageManager` (corepack is not used in this repository).
RUN npm install -g pnpm@12.14.0
WORKDIR /repo
COPY . .
# `deploy` copies the package and its workspace dependencies into /app with a node_modules of
# their production dependencies only, resolved from pnpm-lock.yaml.
RUN pnpm --filter @dose/node-control --prod --frozen-lockfile deploy /app

# Run: the deployed package alone, as the unprivileged `node` user of the base image. The files
# stay owned by root, so the process cannot change its own code.
FROM node:24.16.0-slim
# ENVIRONMENT is set here too (fly.toml sets it as well), so the image never starts as `local`,
# which listens unguarded, by accident: outside `local` it refuses to start without POC_TOKEN and
# POC_ALLOWED_ORIGIN.
ENV NODE_ENV=production \
    ENVIRONMENT=staging \
    HOST=0.0.0.0 \
    PORT=4010
WORKDIR /app
COPY --from=build /app /app
USER node
EXPOSE 4010
# tsx runs the TypeScript sources directly: the workspace packages export `.ts` files and import
# without extensions, which Node alone cannot load.
CMD ["node_modules/.bin/tsx", "src/server.ts"]
