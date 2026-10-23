# 0004 - Runtime: Cloudflare Workers or a Node container

- **Status:** draft — the deciding measurement (checkout latency from the owner's Android in Egypt) is
  added in Milestone 1 Task 20; the decision below is written then
- **Date:** 2026-10-23
- **Builds on:** master plan section A ("Two uncertainties, tested before they become hard to undo"),
  0009 (free tiers), 0010 (environments)

## Context

The commerce core runs unchanged on two runtimes: the `poc` Worker (`dose-web-poc`, Workers Free,
placement hint `aws:eu-central-1`, Hyperdrive with caching off) and a Node container on Fly.io in
Frankfurt (`dose-node-control`, shared-cpu-1x 512 MB, a `pg` pool of 20), both against the same Neon
branch `poc` (Frankfurt, Free plan). The master plan's rule: **both must pass the concurrency tests,
and if the Worker's checkout latency (95th percentile, measured from a phone in Egypt) is more than
1.5 times the container's, the core moves to the container.**

## Measurements

### Concurrency: 200 simultaneous checkouts for 10 units

The runner (`pnpm poc:concurrency`) resets 10 free units, fires 200 checkouts at once, and passes a
run only with exactly 10 × 201, 190 × 409 `out_of_stock`, nothing else, 10 orders in the database
and the rule checker empty. It ran on a GitHub Actions runner (`.github/workflows/poc-concurrency.yml`)
because the developer machine's network drops 7-9% of 200 simultaneous connections.

| Target | Runs | Passed | Evidence |
| --- | --- | --- | --- |
| Container (Fly.io, Frankfurt) | 100 (1-40, 41-80, 81-100) | **100** | `docs/evidence/m1/proof-container/` (runs 39951315868, 39951336734 attempt 2, 39951362887); every run p50 3.3 s, max 8.5 s |
| Worker (Workers **Free**) | 40 (1-40) | **11** | `docs/evidence/m1/proof-worker-1-40/` (run 39648667940) |

The Worker's 29 failed runs were never a correctness failure: every one of the 40 ended with at most
10 orders and the rule checker empty, and 39 of 40 had exactly 10 × 201 (run 33 placed nothing: its
price lookup got a 503). They failed because some requests got no answer: 291 connection resets, 2
other fetch failures, and 503s with empty bodies (9 in run 34).

**Why:** the Worker's own metrics (dashboard, 24 hours around the runs) show **117 errors, all
"Exceeded CPU Time Limits"**, and none of any other kind (exceptions, memory, load shed). CPU time per
request was **p50 29.6 ms, p90 50.7 ms, p99 77.5 ms** against the Free plan's **10 ms** limit;
Cloudflare tolerates some overrun and kills a share of invocations, which the client sees as a reset
or an empty 503. No error points at Hyperdrive's ~20 origin connections on Free: the 200 concurrent
transactions queued and completed (belief B4, see `0003`).

**Owner decision, 2026-10-23:** stay on Workers Free in Milestone 1 and record this result rather than
upgrade (option 2 of three: upgrade to Workers Paid at $5/month for the measurement; stay on Free and
record; or try to cut checkout CPU below 10 ms first). The remaining 60 Worker runs were not run on
Free: 40 show the failure mode, and more would only spend Hyperdrive's daily allowance. **The Worker
has therefore not passed the concurrency proof; that proof is open until the Workers paid plan is
tried or the core moves to the container.**

### Latency: desktop reference (recorded, does not decide)

`/poc/latency` on the owner's Windows desktop (Chrome 155, home network in Egypt), 2026-10-23
12:29 UTC, 50 checkouts per target, interleaved, after one warm-up each
(`docs/evidence/m1/latency-desktop-reference-2026-10-23.json`):

| Target | p50 | p95 | p99 | Failed |
| --- | --- | --- | --- | --- |
| Worker (through Access, Workers Free) | 267 ms | 504 ms | 635 ms | 0 |
| Container | 192 ms | 246 ms | 280 ms | 0 |

Ratio `worker_p95 / container_p95` = **2.05** (above 1.5). The container's first request after a
stop took 6.6 s (cold start), which the warm-up absorbed. The Worker path includes Cloudflare
Access's check at the edge on every request, which production checkout will not have.

### Latency: from the owner's Android in Egypt (decides)

To be added in Task 20 (`docs/runbooks/field-check-m1.md`, step D): mobile data, and Wi-Fi if possible.

## Decision

To be written in Task 20, applying the 1.5× rule to the phone measurement, with the concurrency
result above. If it says the core moves to the container, it is brought to the owner before
Milestone 2 starts.

## Consequences (known already)

- On Workers Free, a checkout costs about three times the CPU the plan allows, so any Worker
  production use needs the paid plan (which the master plan assumed: "Cloudflare Workers (paid plan)").
- The container passed every correctness run; its cost is a machine running all the time
  (Fly.io shared-cpu-1x 512 MB in Frankfurt: no free tier; about $4-8 a month at list prices).

## Evidence

Files under `docs/evidence/m1/`, the GitHub Actions runs named above, and the `dose-web-poc` Worker
metrics in the Cloudflare dashboard (read on 2026-10-23).
