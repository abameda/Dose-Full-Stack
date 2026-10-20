# 0002 - Milestone 1 defaults

- **Status:** accepted (owner approved 2026-10-20)
- **Date:** 2026-10-20

## Context

The master plan leaves six values open that Milestone 1 needs now. The Milestone 1 plan used the values below until the owner said otherwise; the owner approved all six on 2026-10-20.

## Decision

| Item | Value used | Why it needs a value now |
| --- | --- | --- |
| "Under 110 KB of JavaScript" | Compressed bytes transferred (Lighthouse `resource-summary` script transfer size), <= 112,640 bytes | React islands cannot fit 110 KB uncompressed |
| Order number scheme (also Bosta's reference later) | `D` followed by a sequence starting at `10001` (e.g. `D10001`) | Expensive to change once orders exist (section B) |
| Cash-on-delivery confirmation window | 48 hours, stored in `settings`, then cancelled with reason `confirmation_window_expired` | Rule 4 tests need an expiry; section F lists it as safe to decide later |
| Delivery fee before M2's per-governorate settings | EGP 70 (7,000 piastres) for every governorate, marked placeholder | Totals must include delivery |
| Bag limits | 1-10 units per line, at most 10 lines | A trust-boundary limit on checkout input |
| M1 admin permissions | Owner: all. Operations: read orders, confirm, cancel. Accountant: read orders. Marketing: no order routes. Audit log: Owner only | Section B roles, narrowed to M1 routes |

## Consequences

- Milestone 1 code and tests use these values.
- **Used:** the order number scheme is in force from migration `0003_orders.sql` (`order_number_seq` starts at 10001; `orders.number` defaults to `'D' || nextval(...)`). The same migration seeds the 48-hour confirmation window in `settings` and the EGP 70 placeholder delivery fee for all 27 governorates. The bag limits (1-10 units per line, at most 10 lines) are enforced by `priceBag` and, for quantity, by a check on `order_lines`.
- Changing one is a new decision record that supersedes this one.

## Evidence

Owner approval of the Milestone 1 plan and its interpretations table, 2026-10-20.
