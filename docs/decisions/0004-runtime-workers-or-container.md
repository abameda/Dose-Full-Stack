# 0004 - Runtime: Cloudflare Workers or a Node container

- **Status:** proposed — the 1.5x rule is exceeded on mobile data, so by the master plan the core moves to
  the container; per the Milestone 1 plan (Task 20 step 5) that switch is presented to the owner before
  Milestone 2, and the owner decides
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

### Latency: from a phone in Egypt (decides)

The plan named the owner's mid-range Android; none was available, so the owner chose the iPhone, which
the master plan's rule permits ("measured from a phone in Egypt"). Owner's iPhone (iPhone17,3, iOS 26.5)
inside Instagram's in-app browser, 2026-10-23, 50 checkouts per target, interleaved, one warm-up each,
0 failures in either run (`docs/evidence/m1/latency-iphone-2026-10-23.json`, every sample included):

| Run | Worker p50 / p95 / p99 | Container p50 / p95 / p99 | p95 ratio | 1.5x rule |
| --- | --- | --- | --- | --- |
| **Mobile data** (14:55 UTC) — deciding | 267 / **379** / 581 ms | 147 / **190** / 208 ms | **1.99** | **exceeded** |
| Wi-Fi (14:56 UTC) | 321 / 682 / 1,227 ms | 165 / 500 / 611 ms | 1.36 | not exceeded |

In the Wi-Fi run both targets slowed together from sample 38 on (container about 150 to 450 ms), a
network change during the run, so it is the noisier of the two. The mobile-data run decides.

### Limits of this comparison (owner instruction, 2026-10-23)

The two targets were not measured on equal terms, and every difference favours the container:

1. **Workers Free.** The Worker ran on the Free plan, whose 10 ms CPU limit its checkout exceeds
   (p50 about 30 ms). Free invocations that run over can be stopped; none of the 100 latency checkouts
   failed, but the concurrency proof did (see above). The master plan's runtime is Workers **paid**.
2. **Cloudflare Access on every Worker request.** Each Worker checkout passed Access at the edge (the
   `CF_Authorization` cookie checked) and had its Access JWT verified in the Worker (RS256). The
   container checked a bearer token by string comparison. Production checkout is public and will have
   neither.
3. **A new database connection per Worker request.** The Worker opens a `pg` connection through
   Hyperdrive for every request (`createRequestDb`), including its authentication handshake; the
   container keeps a warm pool of 20. This is inherent to Workers: an I/O object such as a socket
   cannot outlive the request that opened it, and Hyperdrive's pooling (Worker to Hyperdrive locally,
   Hyperdrive to Neon over warm connections) is Cloudflare's answer to it. It is a likely part of the
   gap and would remain on the paid plan (not measured separately).
4. **Placement hop.** The phone's requests reached Cloudflare in Marseille (`MRS`) and ran in
   Frankfurt (`remote-FRA`), one extra hop; the container's requests went to Fly.io's edge and then
   its Frankfurt machine.
5. **One phone, one network, one time.** 50 checkouts per target on one iPhone and one mobile network;
   the Android named in the plan is pending (owner, 2026-10-23).

How much of the 189 ms p95 gap (379 vs 190 ms) each of 1-3 explains was not measured.

## Decision

**The master plan's rule, applied as written, says the core moves to the container:** on Egyptian
mobile data the Worker's checkout p95 was 1.99 times the container's (limit 1.5), and the Worker has
not passed the concurrency proof on the Free plan while the container passed all 100 runs.

Because the comparison was not like for like (the limits above), and because the plan requires a
switch to be brought to the owner before Milestone 2, this record does not act on it. The owner
chooses one of:

- **A. Move the core to the container** (the rule as written). The Fly.io container becomes the
  commerce runtime from Milestone 2; the storefront can stay on Workers. Cost: an always-on machine
  (about $4-8 a month), and the per-change preview model must be rebuilt for the container.
- **B. Measure again on equal terms, then decide.** Workers paid for the measurement (about $5 for a
  month), an Access bypass for `/api/checkout` on the poc Worker only (so neither target pays for
  login); then repeat the concurrency proof (100 runs) and the phone measurement.
- **C. Keep Workers despite the rule.** A deliberate amendment of the master plan's rule, recorded as
  its own decision with the reason.

The owner's choice and its date are added here; until then the status stays "proposed".

## Consequences (known already)

- On Workers Free, a checkout costs about three times the CPU the plan allows, so any Worker
  production use needs the paid plan (which the master plan assumed: "Cloudflare Workers (paid plan)").
- The container passed every correctness run; its cost is a machine running all the time
  (Fly.io shared-cpu-1x 512 MB in Frankfurt: no free tier; about $4-8 a month at list prices).

## Evidence

Files under `docs/evidence/m1/`, the GitHub Actions runs named above, and the `dose-web-poc` Worker
metrics in the Cloudflare dashboard (read on 2026-10-23).
