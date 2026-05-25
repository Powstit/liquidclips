# Junior Affiliate Qualification Policy (canonical)

Last updated: 2026-05-24. Approved product policy from Daniel. Do not reinterpret
the commission model. Source handoff: `~/Documents/JNR/CLAUDE_AFFILIATE_QUALIFICATION_EXECUTION.md`.

## Headline
Affiliates can unlock **50% recurring commission**. It is **not** payable
immediately — it is gated behind **Qualified Affiliate status**.

## Qualification gate
An affiliate becomes a Qualified Affiliate when **either**:
1. **Two referred customers become paid Junior customers** using the affiliate's
   tracked link, **or**
2. The affiliate reaches **11,000 Whop-verified views** on approved Junior promo /
   Content Reward submissions.

## When 50% starts
- **Paid-customer path:** customers 1 and 2 earn no commission (they qualify the
  affiliate); **50% recurring starts from customer 3 onward**.
- **Views path:** once 11,000 Whop-verified views are reached, **the next referred
  paid customer and onward earn 50% recurring**.

## Non-negotiable rules
- Active paid Junior subscription required — **Solo or higher**.
- Commission paid **only on successful payments** from referred paid customers.
- Excluded: free sign-ups, trials, test payments, refunds, chargebacks, bot/invalid
  traffic, duplicate referrals, self-referrals.
- **Whop is the source of truth** for affiliate payouts and Whop-verified promo views.
- **No Stripe Connect** affiliate payout build for launch.
- Never claim commission is payable before qualification.
- Subscription lapse pauses eligibility; may resume on reactivation, forward-only.
- Already-paid commission is never clawed back except for fraud/abuse.

## Onboarding flow (built 2026-05-25)

Two checkout paths now exist and both unlock the same backend tier:

- **Direct customers** (organic / Clerk sign-up): sign up via Clerk/Stripe as before; Clerk subscription webhook sets tier.
- **Affiliate-referred customers**: land on `/get` (Whop checkout page); backend `/onboarding/link-whop` endpoint links the Whop membership to the existing or new user record; tier is set via the Whop webhook, not Clerk.

The affiliate → Whop-checkout → `/get` onboarding path and the `/onboarding/link-whop` backend endpoint are implemented. "Affiliate-referred" status is determined by the presence of `affiliate_id` locked at first-touch; both paths preserve that field. Commission accounting remains Whop-managed as before.

## Surfaces (where this is expressed)
- **Public marketing** (`marketing/index.html`, `marketing/affiliates.html`):
  high-level only — "Earn up to 50% recurring commission. Active paid Junior
  subscription required. Terms apply." No exact thresholds.
- **Terms** (`marketing/terms.html#affiliate`): full qualification model.
- **Partner dashboard** (`partner-app`): qualification card + FAQ + PDF link.
- **PDF** (`partner-app/public/Junior-Affiliate-Terms-FAQ.pdf`): branded terms + FAQ.
- **Whop campaign**: copy reflects qualification; 50% enabled via manual/custom rate
  only after a gate is met (dashboard — no native gate, see below).

## Whop config note
Whop has no native "qualify-then-pay" gate. Keep the campaign copy explicit about
qualification, default rate set to non-payable/manual-review where possible, and
flip the affiliate to 50% via per-email custom rate **only after** qualification.
Admin rule: *do not approve commission payout until one of the two gates is met.*

## Out of scope for now (no build during Railway unless Daniel approves)
Qualification-state storage, reading Whop verified views, counting paid referrals,
auto-marking qualified + notify/email + Whop 50% override. Tracked as future
automation only.
