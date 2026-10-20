# 0009 - Milestone 1 runs on free tiers; paid plans are decided at launch

- **Status:** accepted (owner, 2026-10-20)
- **Date:** 2026-10-20
- **Changes:** the master plan's Milestone 1 cost line ("about $5–25" in section F) and the "Workers paid plan" wording in Milestone 1 prerequisite O2. The architecture is unchanged, and so are the launch-time choices in the plan's cost table (Workers paid, Neon Launch).

## Context

The owner does not want to pay for anything while DÖSE has no customers. The plan assumed the Cloudflare Workers paid plan ($5 a month) and the Neon Launch plan from Milestone 1. Creating DÖSE's own Cloudflare account (decision 0008) is free: one login can create up to five Free accounts, if the login is at least 7 days old.

## Decision

Milestone 1 (Tasks 17–20: staging, previews, the proof of concept, the field checks) runs on the free tiers of Cloudflare, Neon and Fly.io. Upgrading is a separate owner decision, taken only when a measured limit blocks the work or before launch, when production needs always-on Postgres and point-in-time restore.

## Consequences, and how Milestone 1 works within the limits

| Limit (free tier, October 2026) | Effect on Milestone 1 | How we handle it |
| --- | --- | --- |
| Workers: 10 ms CPU per request and per cron run (waiting on the database does not count) | Server-rendered pages or checkout could exceed it | Measured in Task 17. If it is exceeded, that is new evidence for the owner, and the Workers-versus-container decision (Task 20) records it |
| Workers: 100,000 requests a day; Hyperdrive: 100,000 queries a day | The 100-run concurrency proof against the Worker (20,000 checkouts, about 10 queries each) exceeds one day's query allowance | Split the Worker runs across days (about 40 runs a day), or the owner upgrades for that month only |
| Cron triggers: 5 per account | Milestone 1 uses one | None needed |
| Neon Free: 10 branches per project, 0.5 GB, compute sleeps after 5 minutes idle | Previews are limited to what fits beside seed, staging and poc (about 6 open at once); the first request after idle is slow | Preview cleanup on close (Task 18); warm the database before every latency measurement (Task 19) |
| Fly.io: no free tier for new organisations, only a trial (about 2 hours of machine runtime or 7 days) | The Node control container cannot run continuously | Start the container only for the measurements and stop it in between; if the trial runs out, the owner adds a card (cost: cents) or the control moves to another Frankfurt host, recorded as its own decision |

## Evidence

- Cloudflare changelog, 2026-08-04: free accounts from the dashboard, up to 5, login at least 7 days old.
- Cloudflare Workers limits and pricing pages: 10 ms CPU, 100,000 requests a day, 5 cron triggers, Hyperdrive on the free plan with 100,000 queries a day.
- Neon pricing and free-plan FAQ: 10 branches per project, 0.5 GB, scale to zero after 5 minutes.
- Fly.io: third-party pricing guides (verified October 2026) report no free tier for new organisations and a short trial. Not confirmed on Fly.io's own page; checked again in Task 17 step 1.
