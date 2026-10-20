# 0011 - No R2 in Milestone 1: product images are the Worker's static assets

- **Status:** accepted (owner, 2026-10-21)
- **Date:** 2026-10-21
- **Changes:** the plan's Task 17 resources "R2 buckets `dose-media-nonprod` and `dose-media-prod`" for the
  length of Milestone 1. The master plan's architecture ("Images: keep R2") is unchanged for launch.
  Follows decision 0009 (free tiers, no payment method).

## Context

Task 17 creates R2 buckets for product images. The DÖSE Cloudflare account answered the first R2 call
(`wrangler r2 bucket list`, 2026-10-21) with `Please enable R2 through the Cloudflare Dashboard. [code: 10042]`.
Cloudflare's R2 guide says to "complete the checkout flow to add an R2 subscription", and setup guides
report that this checkout asks for a payment method even when usage stays inside the free allowance
(10 GB). Decision 0009 says no payment method in Milestone 1. Milestone 1 has two product photos
(about 32 KB in the seed).

## Decision

In Milestone 1 the cloud environments (staging, the PoC Worker and every preview) serve the seed photos
as the Worker's static assets: the build writes each photo to `public/media/products/<slug>/<sha256>.jpg`
with exactly the bytes the seed stores, and `public/_headers` gives `/media/*` a one-year immutable cache.
The URLs (`/media/<key>`), the keys and the `product_images` rows are unchanged. The Worker environments
have no R2 binding; the media route answers 404 when there is no bucket. The R2 code path (`MEDIA`
binding, `pnpm seed --media r2`) stays in the repository and is what launch uses.

## Consequences

- A new photo needs a deploy in Milestone 1 (there is no upload path yet anyway; M2 brings the catalogue
  admin, which needs R2).
- Before M2's catalogue work, or at the launch plan decision, the owner enables R2 (a payment method on
  the DÖSE account; expected charge $0 at this volume). That is a new record superseding this one.
- Owner answer: "Skip R2 in M1", 2026-10-21, when asked to choose between this and adding a card.

## Evidence

- `wrangler r2 bucket list` against account `a61331a1643fa91a513c9cb775d7d619`, 2026-10-21: error 10042.
- developers.cloudflare.com/r2/get-started ("Complete the checkout flow to add an R2 subscription to your account").
- Third-party setup guides (tech-insider.org, 2026) report a payment method requested before the first bucket.
