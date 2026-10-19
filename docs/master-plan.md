# DÖSE Platform Master Plan

Oct 19, 2026 · @Abdelhmeed Elshorbagy

**My recommendation.** Build DÖSE as one custom TypeScript platform: an Astro storefront, a React admin and a narrow commerce core on Cloudflare Workers, with **Postgres on Neon replacing D1** as the database. Four independent reviews tested this against WooCommerce, Medusa, Vendure, Next.js, SvelteKit, React Router and a plain Node server. It holds, with that one significant change and a set of guardrails. Design work starts in week 1 on the real application and continues throughout: there is no launch direction chosen up front, because the launch direction is whichever one you approve once it passes the gates. Launch is gated on evidence of correctness, security and readiness, not on a sales count. The honest engineering estimate is launch-ready in about 10 to 14 weeks with a part-time senior reviewer, longer if Paymob, Bosta or the lawyer are slow. The first milestone is two weeks of working software that also tests the two riskiest technical choices while they are still cheap to reverse.

Final refinement, 19 October. This version replaces the technology, playground, launch and roadmap sections of earlier versions; those remain in the doc's history. Nothing has been built or set up. Facts marked as beliefs below are checked before the code that depends on them is merged.

## What changed in this refinement

| Area | Before | Now | Why |
| --- | --- | --- | --- |
| Database | D1 (SQLite) | Postgres on Neon, through Hyperdrive | Transactions and row locks make each money rule plain SQL instead of a constraint trick; standard tooling; every preview gets its own database branch |
| Commerce engine | Custom core | Custom core, kept; Medusa and Vendure rejected | Medusa's roles and permissions now sit behind an enterprise licence and its promotions have no priority or stacking; Vendure has no returns model; both need extra servers and a codebase the reviewer does not know |
| Business settings | Fixed launch features | Configurable in the admin, within a deliberate, closed set of options | You run the business without a developer for ordinary changes |
| Admin | Forms for launch | A designed product: a Today inbox, work queues, roles and approvals | Most of the daily work happens there |
| Shipping | One-click Bosta creation | Created automatically on confirmation; batch packing, automatic pickup, an exception inbox, return check-in, cash reconciliation | Removes a daily task and puts controls where money moves |
| Design | Pick a direction in phase 0; new work after launch | Design lanes from week 1 on the real app; directions can replace navigation and whole pages; you switch the live direction in the admin | Your requirement; safety comes from a contract and gates, not from waiting |
| Launch gate | 20 delivered orders | Evidence: tests, security review, live-money checks per payment method, an operations rehearsal, speed and accessibility | A sales count measures demand, not readiness |
| Timeline | 6–9 weeks to a private launch | 10–14 weeks to launch-ready, plus outside dependencies | The scope grew: configurable promotions, a designed admin, returns and reconciliation |

## What we are actually building

We are building DÖSE's own operating system for selling direct, with a beautiful storefront as its most visible part. Because DÖSE starts from nothing, it owns the customer relationship, the order data and the checkout from the first order, with no platform in between.

The platform is four products sharing one core:

1. **A brand medium.** A bilingual storefront where each scent's story, label and bottle are the experience. Instagram sends people to it, and they should buy in two taps.
2. **A back office built for how Egypt actually buys.** Cash on delivery, InstaPay transfers and Bosta shipping are the daily reality. The admin should confirm, ship, track and reconcile cash without spreadsheets or copying between apps.
3. **A growth engine on owned data.** Customer history, repeat purchases, influencer codes, and conversion data sent back to Meta. Starting clean means it is collected properly from the first visitor.
4. **A studio.** The live application doubles as the place where new visual directions are tried on real products and real data, seen only by you, then promoted to customers.

Success should be measured by outcomes, not feature count:

- Instagram visit to order conversion on a phone.
- Delivered-order rate (cash-on-delivery refusals are the hidden cost of Egyptian e-commerce).
- Minutes of staff work per order.
- Repeat purchase rate.
- Page speed inside Instagram's in-app browser.

One honest point first. The most expensive part of this platform is not hosting. It is the development and the ongoing ownership of running your own commerce software, with no platform vendor's support desk behind it. The plan below is built to keep that ownership small.

## What we know, assume and don't know

Nine facts are verified, six are working assumptions, and twelve unknowns decide the plan's economics and scope. Change a status here as you confirm things; the plan follows the table.

| Item | Status | Source, or why it matters |
| --- | --- | --- |
| DÖSE is a new store: the Shopify account was suspended for unpaid fees, with no customers or order history to keep | Verified | You told me |
| doseeg.com is registered at GoDaddy, independently of Shopify | Verified | You told me |
| Brand identity, products, pricing and discount rules carry over; the old store does not | Verified | You told me |
| Paradise and Blanc, 50ML, with their exact label copy | Verified | Your product photos |
| Payments: cash on delivery, InstaPay or wallet, and cards through Paymob | Verified | You told me; your Paymob account was connected through Shopify |
| Shipping by Bosta, priced per governorate, free above a threshold, shipments created automatically | Verified | You told me; you used Bosta's Shopify app |
| Arabic and English, with an admin page for products and prices | Verified | Your choices |
| Low recurring costs matter more than convenience | Verified | You told me |
| Traffic is small | Verified | You told me |
| Catalogue stays under about 30 products | Assumed | Assumed; shapes search, filtering and admin design |
| Tens to low hundreds of orders a month after launch | Assumed | Assumed from "users isn't big"; there is no order history to check it against |
| Most visitors arrive from Instagram on phones | Assumed | Assumed; drives performance and checkout design |
| Egypt-only delivery, prices in EGP | Assumed | Assumed |
| One to three people handle orders | Assumed | Assumed; drives how much the admin automates |
| DÖSE curates designer and niche scents and gives each its own name and story | Assumed | From earlier internal notes, not confirmed for this plan; raises legal questions (section on risks) |
| Expected monthly orders, average order value and share paid by card | Unknown | Decides when automation (WhatsApp messages, reconciliation) pays for itself |
| Whether your Paymob account works for a direct integration; its fees and enabled methods | Unknown | Decides checkout options, per-order cost and when cards can launch |
| Bosta account status outside Shopify, price per governorate, cash-collection terms | Unknown | Decides shipping logic and reconciliation |
| Where doseeg.com points today, and whether email runs on it | Unknown | Decides how the domain moves without breaking anything; I could not check it from here |
| How DÖSE sells now, while there is no store | Unknown | If orders arrive through Instagram or WhatsApp, the admin should take them too |
| Full product list: variants, sizes, testers, gift sets, stock levels | Unknown | Shapes the data model |
| The discount rules you want to keep | Unknown | You asked to preserve them; I have not seen them yet |
| Cash-on-delivery refusal rate you expect | Unknown | Decides how much fraud and confirmation tooling is needed on day one |
| Tax registration (VAT, e-receipt obligations) and legal entity details | Unknown | May make receipts a launch requirement |
| Return and exchange policy for perfumes | Unknown | Needed for checkout terms and the admin |
| The features and requirements we have not discussed yet | Unknown | The architecture leaves room, but priorities depend on them |
| Launch date, development budget, and who maintains the platform afterwards | Unknown | Decides pace and how much we automate versus document |

## A. Final architecture

One codebase with a narrow commerce core, deployed to Cloudflare Workers, with the money in Postgres. The core is written so it also runs on a plain Node server, so leaving Workers (including for a host in Egypt, if the law requires it) is a deployment change, not a rewrite.

| Part | Decision | Why, and the trade-off |
| --- | --- | --- |
| Runtime | **Keep** Cloudflare Workers (paid plan) | Previews per branch, scheduled jobs, queues and two-factor login with almost no operations work. Trade-off: Workers features exist only on Cloudflare, so they sit behind adapters, and the core's tests also run on Node |
| Database | **Change** D1 to Postgres on Neon, Frankfurt | D1 can prevent overselling, but only by packing every rule into one batch of constraints with no logic between reading and writing. Postgres gives transactions, row locks, standard backups and a database branch per preview. Trade-off: about $20–25 more a month, and a database outside Cloudflare |
| Connection | Hyperdrive with caching off for commerce; Worker placed near the database | Hyperdrive pools connections per transaction, so multi-step transactions work. Without placement, a Worker in Cairo would pay a Frankfurt round trip on every query |
| Background work | **New:** an outbox table in Postgres, delivered by scheduled jobs and queues | Every outside action (a Bosta shipment, a refund, a message) is recorded in the same transaction as the decision. Queues deliver; they never decide |
| Storefront | **Keep** Astro, with interactive parts as React islands | Least JavaScript by default on phones inside Instagram's browser; islands share components with the admin. Persistent motion across pages is tested in milestone 1 |
| Admin | **Keep** a React app at /admin | Queues, tables and forms are React's strongest ground |
| Commerce engine | **Reconsidered;** stay custom | Medusa and Vendure were examined at their current versions; see below |
| Admin login | Cloudflare Access as the outer gate; roles enforced in the app | Access proves identity with two-factor. The app decides what each person may do, and logs it |
| Images | **Keep** R2 | Unchanged |

**Alternatives rejected, briefly.**

- **WooCommerce.** Fastest to a first sale, but it fights the design ambition and needs plugin upkeep forever.
- **Medusa v2.** Its role-based permissions are now enterprise-licensed. Its promotions have no priority or stacking. It needs a server, a worker and Redis. No Paymob or Bosta plugin was found.
- **Vendure.** The better engine fit: open-source roles, a stock ledger, an Arabic admin. But it has no returns model, is GPL-licensed and built on NestJS and GraphQL. It stays the fallback if the custom core runs late.
- **Next.js.** Its page transitions are still marked experimental, and it runs on Workers only through an adapter.
- **SvelteKit.** Excellent for motion, but it splits away from the React admin.
- **A Node server on Fly.io.** Not rejected: it is the control in the proof of concept, and the fallback if Workers fails it.
- **Supabase.** Point-in-time recovery costs about $100 a month extra; Neon includes it.

**Hard to change later:** Postgres and the money schema, the decision not to adopt an engine, and the hosting country once customer data accumulates. **Cheap to change later:** the Postgres host, the storefront framework, and Workers versus a container, as long as the adapters and outbox exist.

**Diagram: architecture.** One deployment serves customers, staff and the studio; the money lives in Postgres.

- **People:** Customers (phones, from Instagram) use the Storefront. You and staff (login with two-factor) use the Studio and the Admin.
- **Inside one Cloudflare Workers deployment:**
  - Storefront (Astro, live direction) · Studio (unreleased designs) · Admin (React, roles)
  - All three call the **Commerce core** (plain TypeScript: orders, payments, stock, promotions, delivery, audit, outbox)
  - The core uses Hyperdrive (pooled, uncached) · R2 storage (product images) · Queues and cron (deliver outbox, jobs)
- **Outside Cloudflare:** Hyperdrive connects to **Postgres on Neon** (Frankfurt; preview branches), the only core part outside Cloudflare.
- **Outside services** (calls out, webhooks in): Paymob (hosted card checkout) · Bosta (shipments, status updates) · Email service (order and shipping emails) · Meta (pixel, conversions, feed) · Backups (nightly dump, restore drills).

**How the code is divided.** A shared contract (typed data and actions), the commerce core (server only), accessible interface primitives, one folder per design direction, one per campaign template, and the storefront and admin apps. The build fails if a design direction imports commerce code. That rule is what lets design move fast without touching money.

**Two uncertainties, tested before they become hard to undo** (in milestone 1):

1. **Workers versus a container.** The same core runs on Workers with Hyperdrive and on a Node server in Frankfurt. Both must pass the concurrency tests. If the Worker's checkout latency (95th percentile, measured from a phone in Egypt) is more than 1.5 times the container's, the core moves to the container.
2. **Astro versus React Router.** A product page with a bag that persists across pages and a motion hero, opened in Instagram's browser on iOS and on a mid-range Android. If Astro cannot keep the persistent elements and the canvas working within the speed budget, the storefront moves to React Router; the core and contract are unaffected.

Two details are still beliefs to confirm in that milestone: that the Worker can be placed near Frankfurt, and how Hyperdrive caches by default.

## Commerce correctness

A stock ledger, a transaction or an event log does not make a system correct by itself. What does: a short list of rules that must always hold, each enforced by the database where possible, and each proven by a test that tries to break it. The independent commerce review produced these; I agree with all twelve.

**The main records.**

| Record | Holds | Notes |
| --- | --- | --- |
| Product | Name, story, label copy, images, scent profile (family, notes by stage, intensity, season, occasion), in Arabic and English | Slugs stay Latin in both languages so links survive |
| Variant | Size, price, SKU | Prices in whole piastres, never decimals; a 50ML bottle, a sample and a tester are variants of one product |
| Bundle | A set of variants sold together at its own price | Discovery and gift sets later, without remodelling |
| Stock movement | Variant, quantity, reason (received, reserved, sold, released, returned, adjusted), who, when | Stock on hand is the sum of movements, so every unit can be traced |
| Customer | Phone (primary), name, email, addresses | Phone is the identity in Egypt; email optional |
| Consent | Channel (email, WhatsApp, SMS), granted or withdrawn, when, where, the wording shown | Needed for the data protection law; kept as history, never overwritten |
| Address | Governorate, city or area, street, building, landmark | Mapped to Bosta's own city and zone codes |
| Order | Buyer, recipient, lines, totals, delivery fee, discount, payment method, channel (web or manual), status | Each line keeps a snapshot of name, price and discount at order time |
| Payment | Method, provider reference, amount, state | One order can have several attempts |
| Shipment | Bosta tracking number, status history, cash collected | Updated by Bosta webhooks, checked daily |
| Discount | Code, rule, limits, owner (for influencer codes) | Usage counted per order |
| Funnel event | Product viewed, added to bag, checkout started, order placed, confirmed, delivered, refused | First-party; feeds reports and the server-side conversions sent to Meta |
| Event log | Who changed what, when | Every admin action and every external message |

**The rules that must always hold.**

| # | Rule | How it is enforced | How it is proven |
| --- | --- | --- | --- |
| 1 | Totals add up: total = subtotal − discounts + delivery; nothing negative; discount never exceeds subtotal | Database checks; one pricing function writes the lines and the total in one transaction | Property-based tests on thousands of random bags |
| 2 | The price charged is the price quoted | The server re-prices at the moment of ordering; if an offer ended meanwhile, the customer confirms again | Test: an offer expires between quote and order |
| 3 | Never sell what does not exist: 0 ≤ reserved ≤ on hand | A database check, plus a conditional update that reserves only if enough is free; multi-item bags lock items in a fixed order | 200 simultaneous checkouts for 10 units: exactly 10 succeed, repeated 100 times |
| 4 | Every reservation is used or released exactly once | Each reservation flips status once, in the same transaction as the stock counter | Random sequences of reserve, expire, confirm and cancel, including a worker killed midway |
| 5 | Stock history explains stock, and a shipment or return is applied once | Append-only stock movements with a unique source key | Replay: the same return applied twice moves stock once |
| 6 | An order moves only along allowed paths | Three separate states (order, payment, fulfilment); each change is a conditional update from allowed states, with a version number and an event record | Model-based state-machine tests |
| 7 | A card order is paid only on proof | Paymob's signature verified, success confirmed, not voided or refunded, amount and currency equal to the attempt; any mismatch is quarantined and alerted | Tampered and forged callbacks |
| 8 | One provider event changes state once | Unique keys on the provider's transaction and on each received webhook, recorded in the same transaction | The same callback ten times, in parallel and out of order |
| 9 | Refunds never exceed what was paid; returns never exceed what was delivered | Conditional updates and database checks; one refund in flight per payment | Two staff refunding the same order at once |
| 10 | Promotion limits and budgets are never exceeded | Counters updated conditionally inside the order transaction; per-customer limits keyed on the normalised phone | Limit of 10, 30 simultaneous orders |
| 11 | Every outside action happens exactly once | Outbox record written with the decision; delivery claims records one at a time and checks with the provider before any retry | Worker killed between saving and sending: one Bosta shipment, one refund |
| 12 | Every change is attributable | Audit record in the same transaction; the application's database role cannot edit or delete audit records | Test that the role cannot alter them |

**Failure cases, decided in advance.**

- **Card.** Stock is held 30 minutes by default (adjustable). If the customer closes the tab, the callback or a 10-minute inquiry job settles it; a missing callback never marks a payment failed. A payment that succeeds after the hold expired re-reserves stock if it can; otherwise it is voided or refunded automatically and you are alerted.
- **InstaPay.** Held 12 hours by default, shorter during campaigns. Staff verify by order number; a transfer arriving after expiry becomes a manual decision.
- **Cash on delivery.** Confirmation within an adjustable window, then cancelled with a warning. Refused at the door: the parcel returns to you, and stock comes back only after staff inspect it, since a seal may be broken.
- **Bosta.** Statuses only move forward, apart from a few known detours; an hourly re-check repairs shipments that went quiet.
- **Returns and exchanges** never edit the original order. Each returned item refunds its share of what was actually paid, discounts included; an exchange is a linked new order.

**Diagram: order lifecycle.** Nothing ships until payment is verified or the cash order is confirmed.

1. **Order placed:** stock reserved.
2. **Waiting for payment or confirmation:** Card (Paymob callback verified) · InstaPay or wallet (transfer checked by admin) · Cash on delivery (confirmed on WhatsApp).
   - Failed, unpaid or no answer → **Cancelled**, stock released.
3. Verified, checked or confirmed → **Confirmed**: Bosta shipment created automatically.
4. Packed at the daily cut-off, picked up → **With Bosta**: tracked; checked hourly.
5. Then either:
   - **Delivered** (cash collected if cash order) → **Cash reconciled** against Bosta's payout report; or
   - **Refused or returned** (flagged, phone number noted) → **Inspected and restocked**; card payments refunded.

The confirmation gate protects margin: an unconfirmed cash order that is shipped and refused costs delivery both ways, with no sale.

**Resilience.** Neon's point-in-time restore, plus a nightly encrypted dump stored separately. A monthly restore drill, followed by the rule checks. A nightly checker runs one query per rule above and alerts on any violation. Reconciliation jobs compare against Paymob (every 10 minutes for stale payments, daily for settlement) and Bosta (hourly status, weekly cash). Kill switches stored in the database can pause checkout, any payment method or any promotion within seconds.

**Not yet verified, checked in sandbox before dependent code is merged:** Paymob's exact list of signed fields, its refund retry behaviour and the same-day window for voids; Bosta's official status codes and cancellation behaviour.

## B. Business and product foundation

The rule: you configure what changes with the business (prices, stock, offers, delivery fees, content, staff). Code holds what must never be wrong: how money, stock and order states behave. A few things are designed so they can be added later without a rebuild. Each setting exists because a real decision needs it, not because a platform could have it.

| Area | You configure in the admin | Stays in code | Designed to add later |
| --- | --- | --- | --- |
| Catalogue | Products, variants, bilingual copy, images, scent profile, publish and schedule | The data model and the scent-profile vocabulary | New profile fields |
| Pricing | Price, compare-at price, product cost (for margin) | Whole-piastre money and rounding | Customer-group prices |
| Inventory | Stock receipts, adjustments with reasons, low-stock thresholds | The stock ledger and reservation rules | Several stock locations |
| Promotions | Campaigns, codes or automatic offers, eligibility, schedule, limits, budget, priority, exclusivity | How discounts are calculated, stacked and split across items | New offer types, customer segments |
| Bundles and sets | Fixed sets of existing products at their own price | How set stock is deducted per item | Mix-and-match sets |
| Delivery | Fee per governorate, free-delivery threshold, delivery promise per governorate, daily cut-off, pickup slot, cash on delivery on or off per governorate | The Bosta integration and status mapping | A second courier |
| Payments | Methods on or off, cash-order limit, InstaPay details, prepaid delivery for flagged customers | The Paymob integration and payment rules | Instalments |
| Storefront | Campaign pages from code-built templates, banners, announcement bar, FAQ, policies, the live design direction | Layouts, motion and the design system | New templates, through design work |
| Customers | Notes, tags, block or prepay-only | Identity by normalised phone number | Segments |
| Messages | Bilingual templates for order and shipping messages | When each message is sent | Automated WhatsApp |
| Marketing | Pixel and analytics IDs, influencer codes and links | The event list and how attribution is recorded | Events to more platforms |
| Tax | VAT on or off and rate; prices shown with VAT included | The VAT calculation | Electronic receipts, if required |
| Staff | People, roles, approval limits | The permission model | Custom roles |

**Promotions, specifically.** A closed set of offer types: percentage or fixed off the order or chosen products, free delivery, a gift with purchase, a set price for a bundle, and quantity tiers. Each has eligibility (products or collections, minimum spend or quantity, first order, governorate), a schedule in Cairo time, total and per-customer limits, an optional budget, a priority number and an exclusive flag. The builder previews the result on a sample bag and warns about clashes, and every order shows "why this price". Deliberately not configurable: formulas or scripting, per-offer stacking rules, and edits to a live offer's benefit (it is cloned as a new version instead). Buy-X-get-Y and customer segments come later, in code.

**The admin as a product.** Sections: Today, Orders, Fulfilment, Catalogue and stock, Customers, Promotions, Storefront, Insights, Settings.

- **Today** shows only what needs action, with counts and waiting time: orders to confirm, transfers to verify, flagged orders, orders to pack before the cut-off, Bosta exceptions, returns arriving, unreconciled cash, low stock in days of cover, campaigns starting or ending.
- **Queues, not lists.** Confirming cash orders is a keyboard-driven queue with the WhatsApp message prefilled; the next order loads by itself. Packing is one session at the cut-off: one bulk label print, then scan or tick.
- **Everywhere:** search by phone, order or tracking number; saved views; bulk actions that preview their effect; ten seconds of undo on non-financial actions; a plain-language explanation of every status; a full timeline on each order covering customer, staff, Bosta and payment. Confirming and packing work on a phone.

**Fulfilment, end to end.**

| Step | How it works | Control |
| --- | --- | --- |
| Order placed | Automatic: phone normalised, address matched to Bosta's city and zone codes, prices frozen |  |
| Risk flags | Automatic: duplicate within 24 hours, past refusal, invalid phone, cash order over a limit | Flags send an order to review; nothing is rejected automatically |
| Payment or confirmation | Card: automatic on Paymob's signed callback. InstaPay: staff verify by order number. Cash: one-tap WhatsApp confirmation | Amount mismatches go to the owner; unanswered cash orders cancel after a warning |
| Shipment | Created automatically on confirmation, with the order number as Bosta's reference so it cannot be created twice | Cash amount computed and locked; orders above a value limit need the owner |
| Packing and pickup | One packing session at the daily cut-off; pickup requested automatically on working days with packed orders | Staff can override the pickup |
| Tracking | Bosta's status updates plus an hourly re-check; the customer receives tracking messages | Bosta's updates are unsigned, so each one is confirmed by fetching the delivery from Bosta |
| Exceptions | Each lands in Today with Bosta's reason and a suggested next step |  |
| Refused or returned | The order becomes "returning"; on arrival staff inspect it and restock, quarantine or write off | Reason required; write-offs need the owner |
| Returns and exchanges | Return pickup and exchange delivery through Bosta's own delivery types | Approval and refund limits by role |
| Cash reconciliation | Bosta's payout report imported and matched by tracking number | Mismatches and overdue payouts go to Today; the owner signs off |

Not yet confirmed with Bosta: its official status codes, bulk-label parameters, whether payouts are available by API (I assume a report export), and staging keys, which are requested from its technical support.

**Roles.** Owner: everything, including approvals, settings and staff. Operations: confirm, pack, exceptions, returns, stock with reasons, and refund requests. Marketing and content: products in draft, promotions to schedule, storefront content, and no customer phone numbers. Accountant: read-only finance and exports. The owner approves refunds and write-offs above a limit, large or open-ended promotions, and payout mismatches. With one to three people, two-person rules would block work, so they switch on only when there is a second approver.

**Product priorities.** Launch includes what customers need to choose and trust. The first 90 days add what needs real orders to be useful. Later waits for evidence.

| Idea | When | Why |
| --- | --- | --- |
| Structured scent profiles and a Paradise-versus-Blanc comparison | Launch | With two scents, a clear comparison beats a quiz |
| Delivery promise per governorate | Launch | Trust, at almost no cost |
| Cash on delivery explained plainly; WhatsApp help | Launch | How Egyptian customers buy |
| Gifting: a note, prices hidden on the slip, a wrap option | Launch | Ramadan, Eid and Mother's Day on 21 March are gifting peaks |
| Unboxing card with a QR code to the scent guide | Launch | Cheap, and it starts the repeat relationship |
| Discovery set with its price credited toward a full bottle | First 90 days | The main barrier to buying perfume online; depends on whether samples are feasible (unknown) |
| Day-7 follow-up and review request | First 90 days | Early warning, and social proof |
| Verified reviews from delivered orders | First 90 days | Needs some orders first |
| Back-in-stock and new-drop alerts | First 90 days | Also powers limited drops |
| Occasion campaign pages | First 90 days | Uses the promotion and campaign tools already built |
| Scent finder quiz | Later | Worth it from about four scents |
| Referral rewards | Later | Needs volume to check it does not raise refusals |
| Phone-based accounts with one-time codes | Later | Order lookup by phone covers it until then |

**Not building:** points loyalty (thank-you codes do the job), password accounts, subscriptions (a 50ML bottle is bought too rarely), a native app, a page builder.

**Insights from the start.** Delivered revenue, not placed; margin after product cost, delivery, refusals and discounts; cash in transit and overdue; refusal rate by governorate and by first versus repeat customer; confirmation rate and time; delivered revenue per influencer code and promotion; days of stock cover; repeat purchase rate. These need events and attribution captured from the first order, which is why they are designed now.

**Expensive to change once orders exist, so decided now:** separate order, payment and fulfilment states; the order number scheme, which is also Bosta's reference; money in whole piastres frozen per item; customer identity by normalised phone; addresses stored with Bosta's codes; the SKU and set structure; stock as a ledger; bilingual fields and /ar and /en addresses; promotions recorded per item; event and attribution capture; consent at checkout; the audit log and reason codes.

## C. Development and creative workflow

Commerce and design run as two lanes from week 1, on the same application. Safety does not come from waiting. It comes from a contract between the lanes and a gate before anything reaches customers.

**The contract.** Every design consumes the same typed data (product, collection, campaign, bag, navigation, language) and calls the same commerce actions (add to bag, update, checkout, notify me). Analytics events fire inside the commerce layer, tagged with the design that produced them, so no design can forget or fake them.

| A direction may replace | Shared and hardened, styled only through tokens |
| --- | --- |
| Colours, type, spacing, motion, transitions | Bag logic and checkout |
| Navigation, in any form | Payment, and forms for Egyptian phone numbers and addresses |
| Whole pages: home, collection, product, campaign | Accessible dialogs, menus and focus handling |
| Mobile-only compositions | Search-engine data, consent, analytics events |

A direction that imports commerce code fails the build. That is how a direction can replace the product page or the navigation without touching money.

**Three kinds of creative work.** A **direction** changes the whole site. A **study** redesigns one surface inside the live direction, such as a new product page. A **campaign** is a presentation built in code, with content, products and dates you set in the admin. You fill fields the code defined; you do not arrange blocks, so it is not a page builder.

**Where work is seen.**

- **A preview link for every change.** Its own database branch with the real catalogue and no customers, sandbox payments, behind your login. Full checkout testing happens here.
- **The studio on the live site.** The real catalogue, read-only, your login only, never cached or indexed; checkout refuses to run there.
- **Customers see only the live direction.**

**Going live is your act.** The admin lists only directions that are eligible. A direction is eligible when:

- tests pass in both languages;
- accessibility and speed budgets pass;
- Impeccable's detector is clean, or every exception has a written reason;
- Taste Skill's inspector shows no failures on persuasion pages;
- the independent critique has no open serious issues;
- your phone review is recorded.

You switch the live direction; the previous one stays ready and one click restores it. Automation can make a direction eligible; only you can make it live, and the switch is logged with your name and the exact version.

**Keeping it healthy.** At most three directions in exploration, plus the live one and the previous one. Each has an end date six weeks out that you renew or let lapse. A lapsed direction is deleted and kept as screenshots and critiques in a lookbook. Every contract change must work with every active direction, which is what keeps the number small.

**How Taste Skill and Impeccable are used.** As thinking tools, not checklists.

- **Exploring.** Taste Skill's inventory of what only DÖSE has (the crystal mountain, the walnut sphere, the engraved ovals) and its one-sentence idea test. Impeccable's concept seeding deals unfamiliar visual worlds and always keeps one conventional "standing exit", so choosing the familiar is a conscious decision, not a default.
- **Critiquing.** A fresh session with no build context runs Impeccable's two-agent critique on the preview. A second fresh session scores screenshots with Taste Skill's rubric. Their disagreements are reported, not averaged.
- **Refining.** Their named moves (bolder, quieter, typeset, animate) become a shared vocabulary for your notes.
- **Quality floor.** Impeccable's detector and Taste Skill's inspector run in CI. A clean run is evidence, never approval.
- **Where they fall short.** Neither covers Arabic typesetting, so Arabic gets its own rules (no letter-spacing, larger sizes and taller lines, a designed counterpart for the labels' spaced capitals) and a native reader's review. Some Taste Skill bans conflict with engraved labels; exceptions are allowed with a written reason. Taste Skill runs only on persuasion pages, never on bag or checkout. Impeccable's telemetry is switched off.

**Rhythm.** In weeks 1–2 the contract is frozen and Direction 0 is built: a functional baseline that is also the permanent fallback. Then come two-week rounds with up to three directions:

- **Day 1:** brief and seeding.
- **Days 2–5:** first screen, home and product page on real data.
- **Week 2:** navigation, discovery and mobile for the survivors.
- **Friday:** phone review, then continue, revise or stop.

Suggested focus by round: home and product page, then navigation and discovery, then a campaign template, transitions and Arabic. Five to eight real customers, recruited on Instagram, try the survivors on preview links; that finds problems but does not prove conversion. No A/B tests at this traffic.

**Typography to test** (candidates, not decisions): Alexandria and Markazi Text (free, Arabic and Latin), Noto Kufi Arabic, the Thmanyah families (free; licence to check for self-hosting) and 29LT Zarid Serif (commercial). Arabic usually needs 110–125% of the Latin size and taller lines; prices use Western digits by explicit choice.

## D. Implementation sequencing

Four lanes run in parallel after the first milestone. Work that waits on someone outside our control is marked, so a delay there never stalls the rest. The estimate assumes a part-time senior reviewer; without one, expect about half as long again.

**Diagram: implementation sequencing.** Commerce, admin and design run in parallel; launch-ready in 10 to 14 weeks. Engineering estimate with a part-time reviewer; * marks work that waits on an outside party.

| Lane | Milestone 1 (weeks 1–2) | Build (about 5–6 weeks) | Complete (about 2–4 weeks) | Readiness (1–2 weeks) |
|---|---|---|---|---|
| Commerce | Schema and ledger · COD checkout slice · State machines | Catalogue, pricing · Promotions v1 · Reservations, TTLs | Returns, refunds · Reconciliation jobs · Kill switches | Security review · Restore drill · Invariant checks |
| Admin | Access and roles · Orders, timeline · Audit log | Today inbox · Confirmation queue · Catalogue and stock | Promotion builder · Fulfilment, returns · Insights v1 | Ops rehearsal · Runbooks · Staff training |
| Integrations | Proof of concept · Neon, Hyperdrive · Previews, branches | Bosta staging * · Email · Meta pixel | Paymob cards * · Meta conversions · Bosta payouts * | Live-money checks * · Domain move * · Legal pages * |
| Design | Direction 0 baseline, then two-week rounds with up to three directions in the studio. The launch direction is whichever one you approve once it is eligible. | | | |

Gates: **Gate 1** after milestone 1 (proof passed, architecture locked) · **Gate 2** after Build (money tests pass, senior sign-off) · **Launch gate** after Readiness (evidence of readiness, not a sales count).

**Why longer than the previous estimate.** The 6–9 weeks assumed fixed launch features. Configurable promotions, a designed admin with queues and approvals, returns and reconciliation add roughly four to five weeks of careful work. Better to say so now than to discover it in week 8.

**Outside dependencies, kept separate from the engineering estimate.**

| Dependency | Needed by | If it is late |
| --- | --- | --- |
| Bosta staging keys and answers (status codes, payouts, bulk labels) | Week 4 | Shipping work slips, and this one blocks launch |
| Product list, prices, stock levels | Week 3 | The catalogue uses clearly marked placeholders |
| Tax answer (VAT registration, e-receipts) | Week 5 | Price display and receipts wait |
| Paymob direct integration (keys, enabled methods) | Week 8 | Launch with cash on delivery and InstaPay; cards follow |
| Lawyer: data protection, hosting abroad, scent naming, returns | Before any customer data: the waitlist page, then launch | The waitlist page waits, then launch waits |
| Photography, logo files, Arabic copy | Before a direction can become eligible | Design continues on current assets |
| GoDaddy access | When you approve moving the domain | Everything runs on a preview address meanwhile |

**An early, worthwhile release.** After milestone 1, once the lawyer approves the privacy notice, doseeg.com can show the real application in coming-soon mode: Direction 0, the two scents, Instagram and WhatsApp links, and a waitlist with consent recorded. The list becomes the first invitation list at launch.

**What waits until after launch.** Everything marked "First 90 days" or "Later" in the product priorities, automated WhatsApp messages, and new promotion types. Each item pulled forward moves the launch.

**Milestones and gates.** Gate 1 closes milestone 1: the proof of concept passed and the architecture is locked. Gate 2 closes the build phase: money tests pass and the senior engineer has signed off the core. The launch gate is described in section E.

## E. Quality and release

I write most of the code. You review outcomes. A freelance senior engineer reviews anything touching money, security or infrastructure, about four hours a week. I recommend that retainer strongly: without it, the riskiest code would be checked only by the system that wrote it.

**Working rhythm.** Every change is a pull request with a preview link and a short note in plain language: what changed, how to check it on your phone, what could break. A weekly demo on staging, on your phone. Decisions are recorded in the repository as short decision records, with runbooks, so anyone who joins later understands why the system is the way it is.

| Environment | Data | Payments and shipping | Who sees it |
| --- | --- | --- | --- |
| Local | Real catalogue, generated customers and orders | Paymob test keys, mocked Bosta | Developer |
| Preview, one per change | Own database branch: real catalogue, no customers | Sandboxes only | You and the reviewer, behind your login |
| Staging | Real catalogue, generated test orders | Sandboxes, full webhook round trips | You and the reviewer |
| Production | Real | Live keys | Customers, plus your private studio |

No real customer data leaves production, and preview databases are never copied from it. Live keys exist only in production, and a build fails if they appear anywhere else.

**Automatic gates on every change.** Type checks and linting. Property-based tests of pricing and promotions. Integration tests against real Postgres for the order lifecycle and every webhook. The concurrency, replay and crash tests from the commerce rules. Browser tests on phone-sized screens in Arabic and English: browse, add to bag, check out by each method, see the confirmation. A permission test of every admin route against every role. Accessibility checks, speed budgets and screenshot comparison for every active direction. Dependency and secret scans.

**Checked by people.** Motion feel, Arabic copy and typography, photography, and every change to money, login or webhooks, which the senior engineer signs off. A monthly restore drill. Releases deploy only from the main branch after staging passes; rolling back takes one action, and errors alert your phone.

**The launch gate: evidence, not sales.** A sales count measures demand, not readiness, and should not hold a release hostage. The store opens when all of this is true:

- **Correctness.** The ten critical tests and the nightly rule checker have stayed green on staging for a week.
- **Payments.** Every path works in sandbox: pay, fail, expire, late success, refund, void, partial refund. Then live-money checks: you place real orders with each enabled method, including a card payment that is refunded.
- **Shipping.** A Bosta staging round trip, then live orders: one cash order delivered to you, one refused and returned, labels printed and a pickup made.
- **Security.** The reviewer's sign-off on money, login and webhook code. Permission tests pass. Rate limits and bot protection on checkout. No known critical vulnerabilities.
- **Operations.** You and your staff run ten staged orders from placement to reconciliation using only the admin and the runbooks. Alerts reach a phone. A restore drill succeeds.
- **Experience.** The live direction passed the design gate. On a mid-range Android: largest content shown within 2.5 seconds and responses within 200 milliseconds. No serious accessibility issues on the buying path. Arabic reviewed by a native reader.
- **Legal.** The lawyer approved the privacy notice, terms and returns policy, and hosting abroad is cleared.

**Opening.** A quiet opening: the waitlist is invited first, then the store is open to everyone, without paid promotion. For two weeks there is a daily review of errors, payments and fulfilment, with kill switches ready. Announce widely once a week has passed without a serious incident.

## Risks

The two most urgent risks are still legal: Egypt's data protection law, reportedly enforced from about 31 October 2026, and the way DÖSE names its scents. Both need a lawyer before any customer data is collected. Hosting on Neon in Frankfurt and on Cloudflare is a transfer abroad, which may need a licence.

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Data protection law (151 of 2020) enforced from about 31 October 2026; fines reported at EGP 200,000 to 2 million; hosting abroad may need a licence | High | High | Lawyer review now; privacy notice in both languages; consent records from the first sign-up; no customer data until cleared; the core can move to an Egyptian host if required |
| Naming and describing scents in relation to other brands (trademark, misleading claims, relabelling or decanting rules) | Unknown | High | Questions to the lawyer before launch; no other brands' names in product data, ads or search terms until cleared |
| Outside dependencies (Paymob, Bosta, the lawyer) arrive late | High | Medium | All requested in week 1; launch without cards if needed; other work continues |
| Scope grows during the build, as features still to discuss arrive | High | Medium | Each new feature is placed on the priorities table with a reason; anything added to launch visibly moves the launch date |
| Bugs in money or order logic in custom code | Medium | High | The twelve rules and their tests, the senior reviewer, daily reconciliation, kill switches |
| The promotion engine produces a wrong price | Medium | High | A closed set of offer types, property-based tests, a preview before publishing, "why this price" on every order, a promotions kill switch |
| Cash orders refused at the door | High | Medium | Confirmation before shipping, refusal history, prepaid delivery for flagged customers |
| Only the AI really understands the system | Medium | High | DÖSE owns the code and accounts; decision records and runbooks; common, well-documented libraries; the retained engineer |
| Creative work slows the site or delays launch | Medium | Medium | Speed budgets per direction, static fallbacks, Direction 0 always launchable, three-direction cap and end dates |
| Workers or Hyperdrive behave worse than expected | Medium | Medium | Tested in milestone 1 against a container; adapters make the move a deployment change |
| Electronic receipts become mandatory for DÖSE | Unknown | Medium | Orders hold the tax fields so receipts can be issued or exported later |

Dependence on Cloudflare is lower than in the previous version: the database is standard Postgres, backed up outside Neon, and the core runs on Node as well as on Workers.

## Operating costs

Running costs are about $25–35 a month before usage-based fees. That is higher than the previous $5–6 because the database is now always-on Postgres, so the first visitor never waits for it to wake. The development time and the reviewer remain the real costs.

| Cost | Monthly | Notes |
| --- | --- | --- |
| Cloudflare Workers, paid plan | $5 | Includes Hyperdrive, scheduled jobs and a queue allowance |
| Neon Postgres, Launch plan | About $19–25 | A small compute unit always on, plus storage and history; list prices, to check before committing |
| Preview database branches | A few dollars | Ten included, then about $1.50 each (secondary source) |
| Images on R2 | Free up to 10 GB |  |
| Transactional email | Free up to 3,000 a month, then about $20 |  |
| Error alerts | Free tier |  |
| Senior engineer review | About 4 hours a week, at a rate you agree | Recommended, not mandatory |
| Paymob, per card payment | Your contract | Reported at about 2.5–2.95% plus a fixed fee |
| Bosta, per shipment | Your contract | Third-party lists show roughly EGP 65–95 by zone |
| WhatsApp, once automated | Reported at about $0.0036 per utility message in Egypt from 1 October 2026 | From provider notices, not Meta's own rate card; manual click-to-chat is free |

You have decided to build rather than rent. The comparison with a hosted store (a monthly plan, apps and 2% of card sales on Shopify Basic) remains useful only for judging when each automation pays for itself.

## F. Remaining decisions

Decided, and recorded so it is not revisited: DÖSE builds its own platform, with no Shopify migration or rollback.

**Blocking: needed before milestone 1 starts.**

- [ ] Authorise milestone 1, as described in section G.
- [ ] Account ownership: Cloudflare, Neon and GitHub accounts created in DÖSE's name with your email, with access given to me. Nothing is created on your behalf without this. Expected cost during milestone 1: about $5–25.
- [ ] The senior reviewer, yes or no. If yes, they are needed from week 3, when the data model is reviewed. I can draft the brief for finding one.

**Blocking later, by when each is needed.**

- [ ] **This week, because the other side takes time:** the Paymob direct-integration request, the Bosta staging keys and questions (section B), and booking the lawyer.
- [ ] **By week 3:** product list, variants, prices, stock levels and product costs.
- [ ] **By week 5:** VAT registration, and whether electronic receipts apply.
- [ ] **By week 6:** who handles orders, so roles and approval limits can be set.
- [ ] **Before the waitlist page:** the lawyer's answer on hosting abroad, and the privacy notice.
- [ ] **Before launch:** the returns and exchange policy for perfumes; the launch direction, once one is eligible; approval to move doseeg.com's nameservers.

**Safe to decide later** (defaults hold until then): reservation times and confirmation windows; the cut-off and pickup slot; delivery fees per governorate and the free-delivery threshold (set in the admin before launch, not in code); the first promotions; fonts; when to add discovery sets, reviews and referrals; when to automate WhatsApp.

**Still to discuss:** the features and ideas you mentioned. Each will be placed on the priorities table with a reason. None needs to block milestone 1, because the architecture leaves room for them.

## G. First milestone: foundation and proof (two weeks)

The goal: working software you can use on your phone, plus evidence for the two technical choices that would be expensive to reverse.

**Deliverables.**

1. **Repository and CI.** The code divided as in section A, with the boundaries enforced. CI runs type checks, unit and property tests, integration tests on real Postgres, browser tests, and accessibility and speed checks.
2. **Environments.** Staging, plus a preview for every change, each with its own Neon branch seeded from the catalogue and holding no customer data. Everything runs on Cloudflare preview addresses; doseeg.com is not touched.
3. **Commerce slice.** The schema for products, variants, the stock ledger, reservations, orders, cash-on-delivery payments, audit and outbox; the order state machines; a cash-on-delivery checkout from bag to confirmation.
4. **Admin slice.** Behind Cloudflare Access with roles enforced in the app: a first Today view, the order list and order detail with its timeline, confirm and cancel with reasons, and the audit log.
5. **Storefront slice.** Direction 0 in Arabic and English, with the real Paradise and Blanc copy and photographs: home, product page, bag and checkout.
6. **Studio slice.** A second, exploratory product page rendered from the same contract in the studio, proving a direction can replace a whole page. Checkout is disabled there.
7. **Proof of concept.** The concurrency, replay and crash tests from the commerce rules; checkout latency on Workers versus the Node container; the persistent-bag and motion test in Instagram's browser; and a written decision record with the measurements.

**Acceptance criteria.**

- From your phone, you place a cash-on-delivery order on staging, in Arabic and in English. It appears in the admin's Today view within seconds. You confirm it, and its timeline and audit entries show who did what.
- 200 simultaneous checkouts for 10 units produce exactly 10 orders, across 100 runs, and the rule checker reports nothing.
- The same webhook sent ten times in parallel changes state once.
- Opening a change creates its preview and database branch in under five minutes, and a test proves a preview cannot reach production data.
- In the studio, the same product renders in both designs, and checkout refuses to run.
- The Direction 0 product page meets the speed budget in mobile emulation (largest content within 2.5 seconds, under 110 KB of JavaScript). You also check it on your own phone inside Instagram.
- The decision record states, with measurements, whether we keep Workers and Astro or switch, before the next milestone starts.

**Not in milestone 1:** payment accounts, Bosta, the domain move, promotions, and anything that collects real customer data. Each needs your approval or an outside answer first.

## Sources

Everything below was found through web searches during this session. I could not open doseeg.com from here, and several figures come from third-party summaries rather than the vendor's own page. Treat prices and legal dates as leads to confirm, not settled facts. Rows marked "You told me" or "Your product photos" in the status table come from you, not from these sources.

- **Seen directly.** Your two product photos (Paradise and Blanc), your answers in this conversation, and your Shopify store refusing API access (since explained: the account is suspended).
- **Cloudflare.** [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) · [Workers limits](https://developers.cloudflare.com/workers/platform/limits) · [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) · [D1 limits](https://developers.cloudflare.com/d1/platform/limits) · [R2 pricing](https://developers.cloudflare.com/r2/pricing) · [Queues pricing](https://developers.cloudflare.com/queues/pricing/) · [Workers previews](https://developers.cloudflare.com/workers/previews/) · [Astro on Cloudflare](https://docs.astro.build/hi/guides/integrations-guide/cloudflare/) · [Cloudflare acquires Astro](https://convergedigest.com/cloudflare-acquires-astro-to-push-faster-server-first-web-development/)
- **Payments.** [Paymob unified checkout](https://developers.paymob.com/paymob-docs/developers/checkout-experiences/unified-checkout-redirection) · [Paymob callback HMAC](https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/hmac/hmac-transaction-callback) · [Paymob APIs](https://developers.paymob.com/paymob-docs/integration-paths/apis) · [Paymob void](https://developers.paymob.com/paymob-docs/developers/manage-payment-apis/void) · [Kashier InstaPay](https://developers.kashier.io/docs/accept-payments/instapay) · [Paymob for WooCommerce](https://woocommerce.com/products/paymob/) · [Instant payment network FAQ (HSBC Egypt)](https://www.egypt.hsbc.com/ways-to-bank/instant-payment-network/faqs/)
- **Shipping.** [Bosta API docs](https://docs.bosta.co/) · [Bosta Node SDK](https://github.com/bostaapp/bosta-nodejs) · [Bosta for WooCommerce](https://wordpress.org/plugins/bosta-fulfillment/)
- **Shopify and Meta.** [Third-party payment providers](https://help.shopify.com/en/manual/payments/third-party-providers) · [Shopify Payments countries](https://help.shopify.com/en/manual/payments/shopify-payments/supported-countries) · [Export orders](https://help.shopify.com/manual/orders/export-orders) · [Export discount codes](https://help.shopify.com/en/manual/discounts/export-discount-codes) · [Meta catalogue after Shopify](https://help.marpipe.com/en/articles/15948800-how-to-remove-shopify-as-the-primary-data-source-in-a-meta-catalog) · [Google free listings countries](https://support.google.com/merchants/answer/13692890) (an older snapshot; Egypt was not listed)
- **Law and tax.** [PDPL executive regulations (CMS)](https://cms.law/en/are/legal-updates/egypt-s-pdpl-executive-regulations-issued-one-year-compliance-countdown-begins) · [PDPL countdown (Kennedys)](https://www.kennedyslaw.com/en/thought-leadership/article/2026/egypt-s-personal-data-protection-law-the-compliance-countdown-has-begun) · [Egypt data privacy update (Clyde & Co)](https://www.clydeco.com/fr/insights/2026/01/egypt-regulatory-update-on-data-privacy) · [Consumer Protection Law 181/2018](https://eg.andersen.com/wp-content/uploads/2025/07/Law-No.-181-of-2018.pdf) · [Electronic receipts mandate (KPMG)](https://kpmg.com/us/en/taxnewsflash/news/2025/07/tnf-egypt-new-taxpayers-required-to-comply-with-mandate-to-issue-electronic-receipts-for-b2c-transactions.html)
- **Alternatives and services.** [Medusa deployment](https://docs.medusajs.com/learn/deployment/general) · [Vercel fair use](https://vercel.com/docs/limits/fair-use-policy) · [Neon pricing](https://neon.com/pricing) · [WhatsApp pricing](https://developers.facebook.com/docs/whatsapp/pricing) · [Resend free tier (third party)](https://automationatlas.io/answers/resend-free-tier-explained-2026/)

**Added in this refinement.** Four independent reviews. They read the Medusa (v2.21.2) and Vendure (v3.8.0) repositories directly, Bosta's official SDK on GitHub, and Paymob's official Node SDK. Several vendor documentation sites could not be opened from here, so some facts come from search extracts; those are marked as beliefs in the text.

- [Hyperdrive connection pooling](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/) · [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/) · [Worker placement hints](https://developers.cloudflare.com/changelog/2026-01-22-explicit-placement-hints/) · [Neon with Workers](https://developers.cloudflare.com/workers/databases/third-party-integrations/neon/) · [D1 transactions and trade-offs](https://event-driven.io/en/cloudflare_d1_transactions_and_tradeoffs/)
- [Neon plans](https://neon.com/docs/introduction/plans) · [Supabase point-in-time recovery](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery) · [Fly.io pricing](https://fly.io/docs/about/pricing/)
- [Medusa repository](https://github.com/medusajs/medusa) · [Vendure roles](https://docs.vendure.io/current/core/core-concepts/roles) · [Astro view transitions](https://docs.astro.build/en/guides/view-transitions/) · [React Router view transitions](https://reactrouter.com/how-to/view-transitions)
- [Bosta delivery types (official SDK)](https://github.com/bostaapp/bosta-nodejs/blob/master/src/utils/deliveryTypes.js) · [Paymob Node SDK](https://github.com/paymobaccept/paymob-node) · [Paymob create intention](https://developers.paymob.com/paymob-docs/developers/intention-apis/create-intention)
- [Data protection executive regulations (Al Tamimi)](https://www.tamimi.com/law_update_articles/from-policy-to-practice-egypt-issues-executive-regulations-of-the-personal-data-protection-law/) · [WhatsApp pricing from 1 October 2026 (YCloud)](https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-october-1-2026)
- [Alexandria](https://fontsource.org/fonts/alexandria) · [Markazi Text](https://fonts.google.com/specimen/Markazi+Text)
