# 0008 - DÖSE runs in its own Cloudflare account

- **Status:** accepted (owner, 2026-10-20)
- **Date:** 2026-10-20

## Context

The master plan (section F, "Account ownership", and the risk "Only the AI really understands the system") calls for Cloudflare, Neon and GitHub accounts in DÖSE's name, so that DÖSE owns its infrastructure outright. Before Task 17, the only Cloudflare account reachable from the development machine was the owner's existing account, which already holds the resources of another business, Onqur (for example the `onqur-artwork` R2 bucket).

## Decision

DÖSE gets a separate Cloudflare account, created by the owner under their existing login and put on the Workers paid plan. Every DÖSE resource (Workers, Hyperdrive configs, R2 buckets, Access applications, and later the doseeg.com zone) is created in that account and nowhere else. Deployments target it by account ID (`CLOUDFLARE_ACCOUNT_ID`), so a mistaken deploy cannot land in the Onqur account.

## Consequences

- DÖSE's billing, access and audit trail stay separate from Onqur's. A reviewer or a future maintainer can be given access to DÖSE alone, and DÖSE can be handed over without untangling shared resources.
- The owner's one login administers both accounts. Wrangler's OAuth login can see both, so every wrangler command and CI deploy names the DÖSE account ID explicitly.
- Task 17 waits until the DÖSE account exists and its ID is known.

## Evidence

`wrangler whoami` on 2026-10-20 listed one account, "Abdelhmeed.mohsen@gmail.com's Account", and `wrangler r2 bucket list` showed `onqur-artwork` in it. The owner chose the separate account when asked the same day.
