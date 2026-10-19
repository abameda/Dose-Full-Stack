# DÖSE milestone map: Milestone 1 to launch

Derived from `docs/master-plan.md` (sections A to E, with G as the template for detail). This map sequences the plan; it does not change it. Where this file and the master plan disagree, the master plan wins and this file is corrected.

## Overview

| Milestone | Weeks (estimate) | Closes with | Lanes active |
| --- | --- | --- | --- |
| M1 Foundation and proof | 1–2 | **Gate 1**: proof passed, architecture locked | Commerce, Admin, Integrations, Design (Direction 0) |
| *R1 Coming-soon and waitlist (optional release)* | after M1, when cleared | Owner approval + lawyer's privacy notice | Storefront, Integrations |
| M2 Build 1: catalogue, stock and the daily queue | 3–5 | Owner review of the confirmation queue on a phone | All four |
| M3 Build 2: promotions and shipping | 6–8 | **Gate 2**: money tests pass, senior sign-off | All four |
| M4 Complete: money back, cards and reconciliation | 9–11 (up to 12) | Every payment and shipping path works in sandbox | All four |
| M5 Readiness | 12–13 (up to 14) | **Launch gate** (section E): evidence, not sales | All four |
| M6 Quiet opening | 2 weeks after the launch gate | A week without a serious incident | Operations |

The engineering estimate (10 to 14 weeks to launch-ready) assumes a part-time senior reviewer; without one, expect about half as long again. Outside dependencies (marked \*) are tracked separately and never stall the other lanes.

**The design lane runs across every milestone.** Direction 0 is built in M1 and is the permanent fallback. From M2 there are two-week rounds with up to three directions in the studio (brief and seeding, first screens on real data, navigation and mobile for survivors, Friday phone review). Suggested round focus: home and product page (M2), navigation and discovery (M2–M3), a campaign template (M3–M4), transitions and Arabic (M4). The launch direction is whichever one the owner approves once it is eligible (section C); it is not chosen in advance.

**Rules that hold in every milestone.** Every change is a pull request with a preview link and a plain-language note. Money, login, webhook and infrastructure changes are signed off by the senior reviewer. Live keys exist only in production. No real customer data outside production. Decisions are recorded in `docs/decisions/`. Beliefs from the master plan are verified before the code that depends on them is merged.

---

## M1 Foundation and proof (weeks 1–2) → Gate 1

**Goal.** Working software the owner can use on a phone, plus evidence for the two technical choices that would be expensive to reverse (Workers versus a container, Astro versus React Router).

This milestone is specified in full in master plan section G. Its detailed plan is `docs/plans/2026-10-20-milestone-1-foundation-and-proof.md`.

**Deliverables** (section G, unchanged).

1. Repository and CI, with the code divided as in section A and the boundaries enforced (a design direction importing commerce code fails the build).
2. Environments: staging plus a preview per change, each with its own Neon branch seeded from the catalogue and no customer data, on Cloudflare preview addresses only.
3. Commerce slice: schema for products, variants, stock ledger, reservations, orders, cash-on-delivery payments, audit and outbox; the order, payment and fulfilment state machines; a cash-on-delivery checkout from bag to confirmation.
4. Admin slice behind Cloudflare Access with roles enforced in the app: a first Today view, order list, order detail with timeline, confirm and cancel with reasons, the audit log.
5. Storefront slice: Direction 0 in Arabic and English with the real Paradise and Blanc copy and photographs: home, product page, bag, checkout.
6. Studio slice: a second, exploratory product page from the same contract; checkout disabled there.
7. Proof of concept: concurrency, replay and crash tests; checkout latency on Workers versus the Node container; persistent-bag and motion test in Instagram's browser; a decision record with the measurements.

**Acceptance criteria** (section G, unchanged).

- From the owner's phone, a cash-on-delivery order placed on staging in Arabic and in English appears in the admin's Today view within seconds; confirming it shows who did what in its timeline and audit entries.
- 200 simultaneous checkouts for 10 units produce exactly 10 orders, across 100 runs, and the rule checker reports nothing.
- The same webhook sent ten times in parallel changes state once.
- Opening a change creates its preview and database branch in under five minutes, and a test proves a preview cannot reach production data.
- In the studio, the same product renders in both designs, and checkout refuses to run.
- The Direction 0 product page meets the speed budget in mobile emulation (largest content within 2.5 s, under 110 KB of JavaScript), and the owner checks it inside Instagram on their phone.
- The decision record states, with measurements, whether we keep Workers and Astro or switch, before M2 starts.

**Beliefs to verify.** The Worker can be placed near Frankfurt; how Hyperdrive caches by default (and that caching off plus transaction pooling keeps multi-step transactions correct); Neon branch-per-preview timing; Neon list prices before committing.

**Waits on the owner.** Authorising M1; Cloudflare, Neon and GitHub accounts in DÖSE's name with access granted (section F); the senior reviewer yes or no; this week's outside requests (Paymob direct integration, Bosta staging keys and questions, booking the lawyer).

**Not in M1.** Payment accounts, Bosta, the domain move, promotions, anything that collects real customer data.

---

## R1 Coming-soon and waitlist (optional release after M1)

**Goal.** doseeg.com shows the real application in coming-soon mode so the waitlist becomes the first invitation list at launch (section D, "An early, worthwhile release").

**Deliverables.**

1. A coming-soon mode of the storefront: Direction 0, the two scents, Instagram and WhatsApp links, checkout switched off by kill switch.
2. A waitlist form keyed on normalised phone, recording consent per channel with the exact wording shown, in Arabic and English (the consent record from section "Commerce correctness").
3. The lawyer-approved privacy notice in both languages.
4. The domain move, done only after the owner approves changing doseeg.com's nameservers, with a written plan that preserves any email running on the domain.

**Acceptance criteria.**

- A sign-up in either language stores phone, channel, granted-at, source page and the wording shown; withdrawing consent appends a record and never overwrites.
- Checkout cannot be reached in coming-soon mode (browser test and server refusal).
- The privacy notice shown is the version the lawyer approved, and that version is recorded with each consent.
- Before and after the domain move, the domain's existing mail records (if any) resolve identically.

**Waits on.** \* Lawyer's answer on hosting abroad and the privacy notice; \* GoDaddy access and the owner's approval to move the domain. If either is late, R1 waits; nothing else does.

---

## M2 Build 1: catalogue, stock and the daily queue (weeks 3–5)

**Goal.** The owner can run the real catalogue and stock from the admin, and staff can work cash-on-delivery and InstaPay orders through a designed Today inbox and confirmation queue, on a phone.

**Deliverables.**

*Commerce*
1. Catalogue and pricing: products, variants (50ML, sample, tester), bundles, bilingual copy, structured scent profile (family, notes by stage, intensity, season, occasion), publish and schedule, Latin slugs in both languages, compare-at price and product cost; money in whole piastres.
2. Inventory: stock receipts, adjustments with reason codes, low-stock thresholds; stock on hand always the sum of movements (rules 3 and 5).
3. Reservations and holds per payment method with adjustable defaults: cash-on-delivery confirmation window, InstaPay hold (12 hours), card hold (30 minutes, modelled but no card provider yet); expiry jobs through the outbox (rule 4).
4. InstaPay or wallet as a payment method: shown details, staff verification by order number, late transfer becomes a manual decision.
5. Customers identified by normalised Egyptian phone; addresses with governorate, area, street, building, landmark; consent at checkout.
6. Risk flags at order time: duplicate within 24 hours, past refusal, invalid phone, cash order over a limit; flags route to review, never auto-reject.
7. Delivery settings: fee per governorate, free-delivery threshold, delivery promise per governorate, cash on delivery on or off per governorate.
8. Funnel events captured first-party in the commerce layer, tagged with the design direction (product viewed, added to bag, checkout started, order placed, confirmed).

*Admin*
9. Today inbox with counts and waiting times for the M2 item types (orders to confirm, transfers to verify, flagged orders, low stock in days of cover).
10. Keyboard-driven cash confirmation queue with the WhatsApp message prefilled (click-to-chat, not automated) and the next order loading by itself; works on a phone.
11. Catalogue and stock screens; staff and roles (Owner, Operations, Marketing and content, Accountant) with approval limits; settings for the items above.
12. Search by phone or order number, saved views, bulk actions with an effect preview, ten seconds of undo on non-financial actions, plain-language status explanations.

*Integrations*
13. Transactional email for order messages, from bilingual templates set in the admin (provider in sandbox).
14. Meta pixel, configured from the admin's marketing settings.

*Storefront and design*
15. Launch product priorities that need no orders: scent profiles and a Paradise-versus-Blanc comparison, delivery promise per governorate, cash on delivery explained plainly, WhatsApp help.
16. Design rounds 1–2 in the studio.

**Acceptance criteria.**

- The owner creates, edits, schedules and publishes a product with variants and a bundle in both languages without a developer, and the storefront shows it at the scheduled time (Cairo time).
- Every stock figure in the admin equals the sum of its movements, and a property test over random receipt, reserve, release, sell and adjust sequences never breaks 0 ≤ reserved ≤ on hand.
- An unconfirmed cash order and an unverified InstaPay order each expire at their configured time and release stock exactly once, including when the expiry worker is killed midway.
- Staff confirm ten cash orders in a row from the queue on a phone, without leaving it, and each confirmation appears in the timeline and audit log.
- A permission test of every admin route against every role passes; Marketing and content cannot see customer phone numbers.
- The data model has been reviewed by the senior reviewer (needed from week 3), with findings resolved or recorded.
- The checkout still meets the Direction 0 speed budget with the new features.

**Beliefs to verify.** That InstaPay transfers can only be verified manually at this volume (no usable API at launch); click-to-chat prefilled message behaviour on iOS and Android WhatsApp.

**Waits on.** \* Product list, variants, prices, stock levels and costs (week 3; placeholders clearly marked until then); \* the senior reviewer (week 3); who handles orders (week 6, for final roles and limits).

---

## M3 Build 2: promotions and shipping (weeks 6–8) → Gate 2

**Goal.** Confirmed orders become Bosta shipments automatically, promotions price bags correctly within their limits, and the money core is proven and signed off.

**Deliverables.**

*Commerce*
1. Promotions engine v1, the closed set only: percentage or fixed off the order or chosen products, free delivery, gift with purchase, bundle set price, quantity tiers; eligibility (products or collections, minimum spend or quantity, first order, governorate), schedule in Cairo time, total and per-customer limits keyed on normalised phone, optional budget, priority and exclusive flag; discounts recorded per item; a live offer's benefit is cloned as a new version, never edited (rules 1, 2 and 10).
2. "Why this price" stored on every order.
3. VAT on or off with a rate, prices shown VAT-included, tax fields held on orders for later receipts.
4. Outbox delivery hardened for external calls: claims records one at a time and checks with the provider before any retry (rule 11).

*Admin*
5. Order timeline covering customer, staff, Bosta and payment events; Today gains Bosta exceptions.
6. Promotions list and a basic create form (the full builder with preview and clash warnings is M4).

*Integrations*
7. \* Bosta staging: shipment created automatically on confirmation through the outbox, with the order number as Bosta's reference; addresses mapped to Bosta city and zone codes; cash amount computed and locked; webhooks received and each confirmed by fetching the delivery from Bosta; statuses move forward only, apart from known detours; hourly re-check of quiet shipments.
8. Shipping messages to customers (email; tracking link).

*Storefront and design*
9. Gifting at checkout: a note, prices hidden on the slip, a wrap option.
10. Design round 3 (campaign template), with the contract unchanged for active directions.

**Acceptance criteria.**

- Property tests on thousands of random bags and promotion sets: totals always add up, nothing negative, discount never exceeds subtotal, and the price charged equals the price quoted or the customer confirms again (rules 1 and 2).
- A promotion limit of 10 under 30 simultaneous orders is used exactly 10 times (rule 10).
- Killing the worker between saving and sending produces exactly one Bosta staging shipment (rule 11).
- A forged or replayed Bosta status update never changes an order without the confirming fetch, and the same update received ten times changes state once (rule 8).
- The model-based state-machine tests cover every order, payment and fulfilment transition introduced so far (rule 6).
- **Gate 2:** all money tests pass in CI against real Postgres, and the senior reviewer has signed off the commerce core.

**Beliefs to verify** (in Bosta staging, before dependent code is merged). Bosta's official status codes and their mapping; cancellation behaviour; whether creating a shipment with an existing reference is rejected; webhook payload fields.

**Waits on.** \* Bosta staging keys and answers (needed by week 4; this one blocks launch if late); \* tax answer (week 5).

---

## M4 Complete: money back, cards and reconciliation (weeks 9–11, up to 12)

**Goal.** Every way money and parcels come back is handled and reconciled, cards work end to end in sandbox, and the owner can pause anything within seconds.

**Deliverables.**

*Commerce*
1. Returns, refunds and exchanges: returns never edit the original order; each returned item refunds its share of what was actually paid, discounts included; an exchange is a linked new order; one refund in flight per payment (rule 9).
2. Refused or returned parcels: order becomes "returning"; on arrival staff inspect and restock, quarantine or write off, with a reason; write-offs above a limit need the owner.
3. Reconciliation jobs: Paymob stale payments every 10 minutes and settlement daily; Bosta status hourly and cash weekly.
4. Kill switches stored in the database: pause checkout, any payment method or any promotion.
5. The nightly rule checker running one query per rule (all twelve) and alerting on any violation.
6. Backups: nightly encrypted dump stored separately from Neon, plus Neon point-in-time restore.

*Admin*
7. Promotion builder with a preview on a sample bag and clash warnings.
8. Fulfilment: one packing session at the daily cut-off with one bulk label print, then scan or tick; automatic pickup on working days with packed orders, overridable; exception inbox with Bosta's reason and a suggested next step; return check-in.
9. Cash reconciliation: Bosta's payout report imported and matched by tracking number; mismatches and overdue payouts in Today; owner sign-off.
10. Insights v1: delivered revenue, margin after product cost, delivery, refusals and discounts, cash in transit and overdue, refusal rate by governorate and first versus repeat, confirmation rate and time, revenue per influencer code and promotion, days of stock cover, repeat purchase rate.

*Integrations*
11. \* Paymob cards in sandbox: hosted checkout, signed callback verification (signature, success, not voided or refunded, amount and currency equal to the attempt), inquiry job for missing callbacks, late success re-reserves or is voided or refunded automatically with an alert; mismatches quarantined (rule 7).
12. Meta conversions sent server-side from first-party events.
13. \* Bosta payouts (report import, or API if available).

*Storefront and design*
14. Unboxing card with a QR code to the scent guide; campaign pages from code-built templates with content set in the admin.
15. Design round 4 (transitions and Arabic).

**Acceptance criteria.**

- Two staff refunding the same order at once produce one refund, and refunds never exceed what was paid; returns never exceed what was delivered (rule 9).
- Tampered and forged Paymob callbacks never mark a payment paid; the same callback ten times, in parallel and out of order, changes state once (rules 7 and 8).
- Every card path works in sandbox: pay, fail, expire, late success, refund, void, partial refund.
- Applying the same return twice moves stock once (rule 5).
- Each kill switch stops its target within seconds in a staging test, and is logged with who used it.
- A staged payout report with one mismatch and one missing payout produces two Today items and cannot be signed off until resolved.
- The application's database role cannot update or delete audit records (rule 12).
- The nightly checker runs on staging and reports nothing.

**Beliefs to verify** (in sandbox, before dependent code is merged). Paymob's exact list of signed fields; its refund retry behaviour; the same-day void window; Bosta bulk-label parameters; whether Bosta payouts are available by API or only as a report.

**Waits on.** \* Paymob direct integration (keys, enabled methods; needed by week 8). If late, launch proceeds with cash on delivery and InstaPay and cards follow. \* Bosta payout format.

---

## M5 Readiness (weeks 12–13, up to 14) → Launch gate

**Goal.** Evidence that the store is correct, secure and operable, gathered and recorded, so the owner can open it. The launch gate is section E's list, not a sales count.

**Deliverables.**

1. Security review of money, login and webhook code by the senior reviewer; rate limits and bot protection on checkout; dependency and secret scans clean.
2. A restore drill from backup, followed by the rule checks.
3. Operations rehearsal: the owner and staff run ten staged orders from placement to reconciliation using only the admin and the runbooks.
4. Runbooks for daily operations, incidents, kill switches, refunds, restore and rollback; staff training.
5. Alerts reaching the owner's phone; one-action rollback from main.
6. \* Live-money checks: real orders with each enabled method, including a card payment that is refunded; one cash order delivered to the owner, one refused and returned; labels printed and a pickup made.
7. \* Legal pages: privacy notice, terms and returns policy, as approved by the lawyer.
8. \* Domain move, after the owner approves changing doseeg.com's nameservers.
9. The launch direction made live by the owner, from the eligible list (section C).

**Acceptance criteria (the launch gate, section E).**

- **Correctness.** The critical tests and the nightly rule checker have stayed green on staging for a week.
- **Payments.** Every path works in sandbox, then the live-money checks pass for each enabled method.
- **Shipping.** A Bosta staging round trip, then the live delivered and refused orders, labels and pickup.
- **Security.** Reviewer sign-off on money, login and webhook code; permission tests pass; rate limits and bot protection on checkout; no known critical vulnerabilities.
- **Operations.** The ten-order rehearsal completes using only the admin and runbooks; alerts reach a phone; a restore drill succeeds.
- **Experience.** The live direction passed the design gate; on a mid-range Android, largest content within 2.5 s and responses within 200 ms; no serious accessibility issues on the buying path; Arabic reviewed by a native reader.
- **Legal.** The lawyer approved the privacy notice, terms and returns policy, and hosting abroad is cleared.

**Waits on.** \* Lawyer; \* GoDaddy access and nameserver approval; \* live Paymob and Bosta accounts; the returns and exchange policy; photography, logo files and Arabic copy (before a direction can become eligible).

---

## M6 Quiet opening (two weeks after the launch gate)

**Goal.** Open without drama, learn fast, and keep the ability to stop anything.

**Deliverables.**

1. The waitlist invited first (with recorded consent only), then the store open to everyone, without paid promotion.
2. A daily review of errors, payments and fulfilment for two weeks, with kill switches ready; findings logged in `docs/progress.md`.

**Acceptance criteria.**

- A week passes without a serious incident before announcing widely.
- Every incident in the two weeks has a written note and, where needed, a decision record or runbook change.

After M6, the "First 90 days" items from section B (discovery set, day-7 follow-up, verified reviews, back-in-stock alerts, occasion campaign pages) are planned as their own milestones. Each item pulled before launch visibly moves the launch.
