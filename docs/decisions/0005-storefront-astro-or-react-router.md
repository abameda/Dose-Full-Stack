# 0005 - Storefront: keep Astro or move to React Router

- **Status:** accepted on iOS evidence (2026-10-29); the Android half of the check is pending, and this record
  is revisited only if that check fails
- **Date:** 2026-10-29
- **Builds on:** master plan section A ("Astro versus React Router"), beliefs B9 in `0003`

## Context

Master plan, section A: a product page with a bag that persists across pages and a motion hero, opened in
Instagram's browser on iOS and on a mid-range Android. **If Astro cannot keep the persistent elements and the
canvas working within the speed budget, the storefront moves to React Router; the core and contract are
unaffected.** The speed budget (section G, decision 0002): largest contentful paint within 2.5 s and at most
112,640 compressed bytes of JavaScript on the Direction 0 product page, in Lighthouse mobile emulation.

## Measurements

### Speed budget (Lighthouse CI, mobile emulation, median of 3 runs)

| Page | LCP | Script transfer | Accessibility |
| --- | --- | --- | --- |
| Direction 0 product page, English | 1,673 ms | 85,287 bytes | 1.00 |
| Direction 0 product page, Arabic | 1,664 ms | about 85,300 bytes | 1.00 |
| Studio Direction X1 product page (warn-only) | 1,670 ms | 86,655 bytes | 1.00 |

Source: the `lighthouse` job of every CI run (Tasks 14 and 15, `docs/progress.md`); the budget is asserted in
`lighthouserc.cjs` and was proven to fail with a 240 KB dummy script. All three pages are well inside it.

### Persistence and canvas inside Instagram's browser (owner's iPhone, 2026-10-23)

iPhone, iOS 26.5, Instagram 452 in-app browser, staging (`docs/runbooks/field-check-m1.md` step C):

- Direction 0: the bag count stayed the same moving Paradise → Blanc → Paradise, with no flash.
- Studio Direction X1: the bag carried over from the storefront; the canvas hero **kept animating across
  Paradise → Blanc without restarting** (Astro's client router with `transition:persist`); checkout showed
  "Checkout is disabled in the studio".
- The product page appeared promptly on the phone (no slowness noted by the owner).

Android: **not checked** (no Android phone available); recorded as pending, not passed (owner, 2026-10-23).

## Decision

**Keep Astro.** Everything the rule tests held on iOS inside Instagram, and the Direction 0 page meets the speed
budget with about a quarter of the JavaScript budget to spare. Nothing measured points to React Router.

The decision rests on one of the two phones the plan names. The Android check stays an open item of Milestone 1;
if it fails (persistence or canvas lost in Instagram's browser on a mid-range Android), this record is reopened
with that evidence before the storefront's design rounds build on the client router.

## Consequences

- The storefront, the studio and Direction 0 stay on Astro with React islands; no rework.
- Two follow-ups for Milestone 2, neither affecting the decision: on a full reload the bag count shows 0 for a
  moment before the saved bag loads (render it hidden until the bag is read, or keep the count in a cookie);
  Instagram's browser offered to save the checkout's contact details to the shopper's Meta account ("Contact info
  updated"), which the privacy notice should mention.

## Evidence

`docs/progress.md` (Tasks 14 and 15 Lighthouse figures), the CI runs' `lighthouse` job, belief B9 in `0003`, and
the owner's field-check screenshots of 2026-10-23 (kept by the owner; not committed, as one shows personal data).
