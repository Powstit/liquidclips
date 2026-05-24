# Junior Affiliate Starter Pass + Whop Rewards Copy Scope

Last updated: 2026-05-24

## Goal

Communicate Junior's strongest wedge without changing Stripe/Clerk pricing:

> Junior helps clippers turn paid Whop Content Rewards into submission-ready clips.

The offer should create a distribution loop:

1. Affiliates promote Junior with a valuable starter pass.
2. Clippers use Junior to make Whop bounty clips.
3. Junior can also run its own Whop Content Reward paying people to post about Junior.
4. More clippers see Junior being used to earn, then join through affiliate links.

## Hard Boundaries

Do not let this spill into a messy payments rebuild.

- Do not change existing Stripe/Clerk plan IDs.
- Do not rename paid tiers.
- Do not make public reusable coupon codes like `JUNIOR100`.
- Do not promise hosted AI credits unless the backend ledger explicitly supports it.
- Do not advertise automatic Whop submission. Current truth: Junior prepares the clip and tracks pasted Whop submission IDs.
- Do not say "free forever for clippers" unless the business intentionally supports that.
- Do not gate normal clipping behind Whop. Whop is the wedge, not the whole product.
- Do not pay affiliate commission on trial signup alone. Commission should trigger after first successful paid invoice.

## Recommended Offer

Use this as the default beta offer:

> Affiliate Starter Pass: 100 free bounty clip exports or 30 days, whichever comes first.

Why 100 instead of 200 first:

- 100 already sounds generous.
- It lets us measure abuse before making the offer larger.
- It is less likely to confuse Solo, which is already unlimited local clipping.
- It gives a clipper enough output to feel the "paid bounty workspace" value.

Make the count configurable:

```text
AFFILIATE_STARTER_CLIP_CREDITS=100
AFFILIATE_STARTER_DAYS=30
```

Daniel can test 200 later by changing env/copy, not by rewriting billing.

## Cost Rule

The free pass should be local/BYO-key only.

Allowed in pass:

- Browse live Whop bounties.
- Create bounty workspaces.
- Import/paste source URLs.
- Local clipping/export.
- Bring-your-own OpenAI key.
- Manual Whop submission preparation/tracking.

Not included in pass unless separately capped:

- Hosted transcription paid by Junior.
- Hosted LLM paid by Junior.
- Autopilot drip scheduling.
- Unlimited connected accounts.
- Agency/team features.

## Affiliate Eligibility

There are two related but separate systems.

### 1. Affiliate Starter Pass

Who can issue it:

- Confirmed/approved Junior affiliates.
- Partner app users with a valid Whop affiliate record.
- Optional manual admin approval before a link becomes active.

Who can redeem it:

- New Junior users only.
- Card required.
- One pass per user.
- One pass per device/install ID where practical.
- One pass per payment customer.
- Expires after 30 days.

Use tracked links, not generic coupons:

```text
https://jnremployee.com/start?ref=aff_xxx&offer=bounty100
```

The backend decides whether the user qualifies. The URL is marketing, not authority.

### 2. Junior's Own Whop Content Reward

This is the brilliant flywheel and should be treated as a campaign, not a billing feature.

Create a Whop Content Reward like:

> Make a short showing how Junior turns a Whop bounty into submission-ready clips.

Rules:

- They must use Junior in the clip.
- They must show the Earn/Bounty workspace or results.
- They submit the social post through Whop Content Rewards.
- They can include their Junior affiliate link.

This means we can pay for posts that demonstrate the product, while affiliates also earn if viewers convert.

Keep this separate from the Starter Pass implementation. Do not blend payouts, affiliate commissions, and clip credits in one table.

## Landing Page Copy Changes

### Hero

Replace generic account/clipper language with:

```text
Turn Whop bounties into submission-ready clips.
```

Supporting copy:

```text
Junior shows you paid Content Rewards, keeps the bounty brief attached, finds clip-worthy moments, captions and reframes them, then helps you publish and track the submission.
```

CTA:

```text
Start clipping bounties →
```

Secondary:

```text
See the affiliate starter pass
```

### Differentiation Section

Add this block:

```text
Opus helps you make clips.
CapCut helps you edit clips.
Whop helps you find paid campaigns.

Junior connects the money to the editing workflow.
```

### Workflow Section

```text
1. Pick a bounty
Browse live Whop Content Rewards inside Junior.

2. Start a bounty workspace
Junior keeps the brief, payout, platforms, and rules attached.

3. Generate submission-ready clips
Captions, reframes, hooks, metadata, and bounty fit checks.

4. Submit and track
Open Whop, paste your submission, and track approval.
```

### Affiliate Offer Copy

```text
Give your audience 100 free bounty clips.

Approved affiliates get a tracked invite link. New clippers add a card, bring their own OpenAI key, and get 100 local bounty clip exports or 30 days, whichever comes first.
```

Short badge:

```text
100 bounty clips · card required · BYO key · 30 days
```

### Signup Copy

When `?offer=bounty100` is present:

```text
Affiliate invite unlocked.
Get 100 free bounty clip exports before Solo billing starts. Bring your own OpenAI key. Cancel before billing.
```

### Pricing Copy

Do not change plan prices.

Add one small note under Free/Solo:

```text
Affiliate Starter Pass: approved invite links can unlock 100 bounty clip exports before Solo billing starts.
```

Clarify Solo:

```text
Solo includes unlimited local clipping with your own OpenAI key.
```

## Backend Scope Later

Do not block copy cleanup on this, but do not launch the offer publicly until this exists.

Recommended models:

```text
affiliate_offer
- id
- affiliate_id
- offer_type = "bounty_clip_starter"
- clip_credit_limit
- expires_days
- requires_card
- new_users_only
- status
- created_at

user_credit_grant
- id
- user_id
- affiliate_id
- offer_id
- grant_type = "affiliate_bounty_clip_starter"
- credits_total
- credits_used
- expires_at
- stripe_customer_id
- clerk_user_id
- device_install_id
- status
- created_at
```

Backend endpoints:

```text
POST /affiliate-offers/redeem
GET /me
POST /usage/clip-exported
```

Rules:

- Burn one credit when a bounty clip export succeeds.
- Only burn credits for projects with `whop_bounty_id`.
- If no credits remain, continue under the user's paid tier.
- If no paid tier/card exists, show upgrade/checkout.
- Trial credits should never unlock hosted Growth features by accident.

## Anti-Abuse Checklist

- Card required before credits activate.
- New users only.
- One active starter grant per user.
- One active starter grant per Stripe customer.
- Record device install ID from desktop.
- Record affiliate ID at signup and do not let users change it later.
- Delay affiliate commission until first successful paid invoice.
- Rate-limit offer redemption by affiliate.
- Admin can pause an affiliate's offer.
- If many users redeem from the same affiliate and never activate/export, flag it.

## Claude Implementation Order

### Phase 1: Copy Only

Safe now:

- Update landing/account copy.
- Update affiliate dashboard copy/share text.
- Add starter pass messaging as "approved invite offer" or "coming soon" if backend ledger is not ready.
- Do not change checkout behavior.
- Do not change plan IDs.
- Do not add public coupon codes.

### Phase 2: Ledger

Only after Railway/backend is stable:

- Add credit grant tables.
- Add redeem endpoint.
- Add `/me` fields for credit balance.
- Add desktop display for credits remaining.
- Add export accounting.

### Phase 3: Whop Content Reward Campaign

Business/admin setup:

- Create Whop Content Reward for posts showing Junior being used.
- Require proof of Junior workspace/results.
- Encourage affiliate links in captions.
- Track source via PostHog/referral IDs.

## Acceptance Criteria

Copy is acceptable when:

- A new visitor understands Junior is for turning paid Whop bounties into clips.
- Affiliates understand what they can give away.
- Clippers understand card/BYO-key/30-day terms.
- The site does not imply hosted AI is free.
- The site does not imply Whop submission is fully automated.
- Existing paid plans still read correctly.

Backend is acceptable when:

- A confirmed affiliate can generate/view a tracked starter link.
- A new user can redeem exactly one starter pass.
- `/me` returns remaining credits.
- Exporting a bounty clip decrements one credit.
- Exhausted/expired users are pushed to Solo cleanly.
- Affiliate commission only starts after paid conversion.

