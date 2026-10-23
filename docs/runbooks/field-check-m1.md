# Field check: Milestone 1 on your phones (Gate 1)

You need: the iPhone and the mid-range Android, both with Instagram, mobile data on the Android
(Wi-Fi as well if you can), and about 45 minutes. Do every step **inside Instagram's own browser**:
send the links to yourself in an Instagram DM (or from a second account) and tap them there, never
in Safari or Chrome. Take the screenshots named in each step and send them back with the copied
results.

Everything here is staging: test data only. Use a made-up name, any Egyptian mobile number that is
yours or obviously fake (for example `0100 000 0001`), and a made-up address. No real customer data.

## The links

| # | Link | What it is |
| --- | --- | --- |
| L1 | `https://dose-web-staging.dose-platform.workers.dev/ar` | Storefront, Arabic |
| L2 | `https://dose-web-staging.dose-platform.workers.dev/en` | Storefront, English |
| L3 | `https://dose-web-staging.dose-platform.workers.dev/admin` | Admin (Today, orders, audit log) |
| L4 | `https://dose-web-staging.dose-platform.workers.dev/en/products/paradise` | Direction 0 product page (Paradise) |
| L5 | `https://dose-web-staging.dose-platform.workers.dev/studio/en/products/paradise` | Studio: Direction X1 product page |
| L6 | `https://dose-web-poc.dose-platform.workers.dev/poc/latency` | Latency test, Worker versus container |

Staging and the PoC Worker sit behind Cloudflare Access: sign in once per Worker with your email and
the one-time code (the session lasts 24 hours).

**Workers Free note (decision 0004).** A page or a checkout on the Free plan can occasionally fail
with a Cloudflare error page or a blank answer when it uses more than 10 ms of CPU. If that happens,
note which step and the time, screenshot it, and reload; it is part of the evidence, not your mistake.

## Step A: sign in through Access inside Instagram (belief B8) — both phones

1. Tap L2. You should see Cloudflare's sign-in page: enter `abdelhmeed.mohsen@gmail.com`, then the
   code from your email (switch to the mail app and back to Instagram).
2. **Pass:** after the code, the DÖSE storefront opens inside Instagram.
3. Screenshot: the sign-in page, and the storefront after it.
4. Note anything odd: the mail app opening the link outside Instagram, the code page reloading, being
   asked to sign in again on the next link.

## Step B: an order in each language reaches Today (criterion 1) — both phones

1. Open L3 (the admin) and leave it on **Today**. Note the count of orders to confirm.
2. In a second tab, or after switching back: L1 (Arabic). Add Blanc to the bag, check out with cash on
   delivery, and place the order. Note the order number on the thanks page (`D1….`).
3. Back on Today: **pass** if the order is there within about 10 seconds, without reloading.
4. Repeat 2-3 with L2 (English).
5. Open one of the two orders, tap **Confirm**, choose WhatsApp, confirm.
6. **Pass:** the order's timeline shows "Placed by customer" and "Confirmed by Abdelhmeed · WhatsApp";
   the **Audit** page lists the confirmation with your name.
7. Screenshots: the thanks page (AR and EN), Today with both orders, the timeline, the Audit page.

## Step C: the bag persists and the page is quick (belief B9, criterion 6) — both phones

1. L4 (Paradise, Direction 0). Note how long until the bottle photo appears, roughly (instant /
   about a second / slow).
2. Add Paradise to the bag. Tap through to Blanc, then back to Paradise.
3. **Pass:** the bag count stays the same the whole time and the bag does not flash empty.
4. L5 (the studio's X1 page). Watch the moving hero. Tap through to Blanc.
5. **Pass:** the hero keeps moving without restarting from the beginning; the bag count persists.
6. In the studio, open the bag and tap checkout. **Pass:** "Checkout is disabled in the studio".
7. Screenshots: the bag count before and after moving; the studio's checkout message. A 10-second
   screen recording of step 4 if you can.

## Step D: checkout latency from Egypt (criterion 7) — the Android, on mobile data

The container is started just before you do this; tell me when you are ready and wait for my
"go" (it is switched off between measurements to save the trial hours).

1. Turn Wi-Fi off. Open L6 inside Instagram. Sign in if asked.
2. Tap **Run** and wait (100 checkouts, about one to two minutes). Keep the screen on.
3. Tap **Copy results** and paste the text into a message to me (or, if copying fails, select the
   text in the box that appears and copy that).
4. If you can, turn Wi-Fi on and repeat 2-3.
5. Screenshot: the results table.

## What happens with your results

The Arabic and English orders, the timeline and audit screenshots close criterion 1; the
sign-in screenshots close B8; the bag and hero checks close B9 and decide Astro versus React Router
(decision 0005); the latency JSON decides Workers versus the container by the 1.5x rule (decision
0004). Anything that fails is recorded with what it changes, and if a decision says "switch", it is
brought to you before Milestone 2 starts.
