# Junior Master Growth Flywheel Implementation

Last updated: 2026-05-24

> **POLICY UPDATE 2026-05-24 — Commission qualification gate.** The "50% MRR"
> mentions below are now **gated behind Qualified Affiliate status**. An affiliate
> qualifies via **either** (1) two referred paid Junior customers, **or** (2)
> 11,000 Whop-verified views on approved Junior promo / Content Reward
> submissions. 50% recurring then starts from the **third** referred paid customer
> (paid-customer path) or the **next** referred paid customer after view
> qualification (views path). The first two referred paid customers do not earn.
> Active paid Junior subscription (Solo+) required; Whop is payout + verified-views
> source of truth; no Stripe Connect. Canonical: `CLAUDE_AFFILIATE_QUALIFICATION_POLICY.md`.
> This supersedes any flat/immediate-50% wording in this file.

## Current State

The Whop bounty workspace is now shipped and committed as `31133a1` / desktop `v0.4.12`.

Verified:

- Packaged app rebuilt and installed.
- Backend `/healthcheck` returns 200.
- Backend `/whop/bounties` returns live data.
- Desktop sidecar can browse bounties through backend proxy.
- Daniel admin override works.
- `/me` correctly separates raw tier from effective tier.
- Bounty workspace, source setup, richer project context, workspace header, fit pills, fit checklist, and in-progress bounty projects are implemented.

Remaining non-blocker:

- Packaged webview CORS: backend config only allows `http://localhost:3000`, `http://localhost:3500`, and `http://localhost:1420`. Browser-side packaged calls such as notification unread count can 400 unless Tauri origins are included.

## North Star

Junior is not just another AI clipper.

> Junior helps clippers turn paid Whop Content Rewards into submission-ready clips, then lets them earn again by referring other clippers.

The growth loop:

1. Junior runs a pinned Whop Content Reward campaign.
2. Clippers make posts about Junior using Junior.
3. Junior adds the clipper's affiliate QR/link to eligible promo clips.
4. Viewers join through the link and get the Affiliate Starter Pass.
5. New clippers create bounty clips.
6. Some convert to paid.
7. Referring affiliates earn 50% MRR while their own Junior subscription is active.
8. Affiliates keep promoting because their revenue stream depends on staying active.

## Business Rules

### Starter Pass

Default offer:

```text
100 bounty clip exports
30 days
Card required
BYO key/local only
New users only
Then Solo
```

Configurable later:

```text
AFFILIATE_STARTER_CLIP_CREDITS=100
AFFILIATE_STARTER_DAYS=30
```

Do not include hosted AI in this offer unless we explicitly add hosted-credit caps.

### Affiliate Lock-In

Rule:

```text
Only active paid Junior partners receive ongoing 50% MRR payouts.
```

Details:

- Free/trial users may apply to be affiliates.
- Affiliate payouts accrue as pending until the affiliate has an active paid Junior subscription.
- If an affiliate cancels, future commission payments pause.
- If they reactivate, future commission payments resume from that point forward.
- Never claw back already-paid commission.
- Commission should trigger only after the referred customer's first successful paid invoice.

### Pinned Junior Bounty

Add a Junior-owned pinned bounty/campaign in Earn:

```text
Pinned · Junior bounty
Make a clip showing how Junior turns Whop bounties into submission-ready clips.
Reward: configured in Whop Content Rewards.
Bonus: include your Junior affiliate link/QR.
```

Rules:

- Must show Junior on screen.
- Must show the Whop bounty workflow or bounty workspace.
- Must mention/communicate the starter pass.
- Must include tracked affiliate link or QR where possible.
- Submission/payout still happens through Whop Content Rewards.

## Strict Engineering Boundaries

Do not add unrelated features.

- Do not change Stripe/Clerk plan IDs.
- Do not change Solo pricing.
- Do not build a custom marketplace.
- Do not automate Whop submission.
- Do not force every user to become an affiliate.
- Do not watermark every clip.
- Do not include hosted AI in the starter pass.
- Do not pay affiliate commission on free/trial signup.
- Do not replace Whop affiliate IDs with usernames.
- Do not send PII, filenames, transcripts, or tokens to PostHog.

## Implementation Order

### Phase 0: Stabilize App Shell

Do this before PostHog/flywheel work.

1. Fix packaged Tauri CORS.

Backend config currently has:

```text
http://localhost:3000,http://localhost:3500,http://localhost:1420
```

Add packaged Tauri origins as appropriate:

```text
tauri://localhost
https://tauri.localhost
```

Acceptance:

- Packaged app notification bell no longer 400s from CORS.
- Queue still opens.
- Inbox still opens.
- Settings still opens.
- Account/debug section still loads `/me`.

2. Commit existing docs if desired:

- `docs/CLAUDE_AFFILIATE_STARTER_PASS_COPY_SCOPE.md`
- `docs/CLAUDE_POSTHOG_AFFILIATE_FUNNEL_ARCHITECTURE.md`
- this master doc

### Phase 1: Copy Upgrade

Safe copy-only work. No payments change.

#### Landing / Account Hero

Use:

```text
Turn Whop bounties into submission-ready clips.
```

Support:

```text
Junior shows you paid Content Rewards, keeps the bounty brief attached, finds clip-worthy moments, captions and reframes them, then helps you publish and track the submission.
```

CTA:

```text
Start clipping bounties →
```

#### Differentiation

```text
Opus helps you make clips.
CapCut helps you edit clips.
Whop helps you find paid campaigns.

Junior connects the money to the editing workflow.
```

#### Affiliate Page Visual Steps

Create a step section with images/visual cards:

```text
1. Share your Junior link
Give clippers 100 bounty clip exports with your invite.

2. They clip paid bounties
Junior turns Whop Content Rewards into focused editing workspaces.

3. Junior adds your link
Eligible Junior promo clips can include your affiliate QR/link automatically.

4. You earn 50% MRR
When referred clippers become paid users, active partners receive ongoing revenue share.
```

Important wording:

- Say "eligible Junior promo clips", not all clips.
- Say "active partners", not everyone forever.
- Say "when they become paid", not when they join free.

#### Partner Dashboard Share Copy

Replace generic auto-clip copy with:

```text
Junior turns Whop bounties into submission-ready clips. My link gives you 100 bounty clip exports to try it.
```

Email/share:

```text
Found Junior. Pick a Whop bounty, paste the source, and it builds a clipping workspace around the brief. My invite gives you 100 bounty clip exports. Bring your own OpenAI key, card required, then Solo if you keep going.
```

### Phase 2: PostHog Event Architecture

Implement the event plan from:

```text
docs/CLAUDE_POSTHOG_AFFILIATE_FUNNEL_ARCHITECTURE.md
```

Required event chain:

```text
reward_clip_viewed
affiliate_link_clicked
starter_pass_started
desktop_activated
first_bounty_workspace_created
bounty_clip_exported
starter_pass_exhausted
subscription_activated
subscription_still_active_day_30
```

Acceptance:

- PostHog config missing = no-op, never crash.
- Existing `subscription_activated` includes `affiliate_id` when known.
- Events contain IDs only.
- No email/name/token/path/transcript/filename.
- Dashboard can answer: "What did a reward budget produce in retained paid MRR?"

### Phase 3: Affiliate Starter Pass Ledger

Only after Railway/backend is stable.

Add models:

```text
affiliate_offer
- id
- affiliate_id
- offer_type = "bounty_clip_starter"
- clip_credit_limit
- expires_days
- requires_card
- new_users_only
- status = pending | approved | paused
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

Endpoints:

```text
POST /affiliate-offers/redeem
GET /me
POST /usage/clip-exported
```

Rules:

- Burn one credit only when a bounty clip export succeeds.
- Only burn starter credits for projects with `whop_bounty_id`.
- If credits run out, prompt upgrade/continue Solo.
- Trial credits do not unlock hosted Growth features.
- One starter pass per user/customer/device where practical.
- Affiliate must have approved offer status.

### Phase 4: Affiliate QR/Link Overlay

Build only for eligible Junior promo/pinned bounty clips.

Behavior:

- If project is the Junior pinned bounty or explicitly marked as Junior promo, offer the overlay.
- Do not enable by default for normal client/user clips.
- Use existing affiliate link if available.
- If missing, show "Set up affiliate link first."
- Overlay options:
  - QR code bottom-right.
  - Text URL / short referral link.
  - Optional CTA: `100 bounty clips`.

Acceptance:

- No affiliate link = graceful setup prompt.
- Normal bounty/client exports are not watermarked.
- User can preview before export.
- Exported promo clip includes QR/link exactly once.

### Phase 5: Whop Reward Campaign Setup

This is business/admin setup, not app architecture.

Campaign brief:

```text
Make a short showing how Junior turns Whop bounties into submission-ready clips.
```

Submission rules:

- Show Junior on screen.
- Show Earn/Bounty workspace or generated results.
- Mention 100 bounty clip starter pass.
- Include affiliate link/QR if you have one.
- Submit the social post through Whop Content Rewards.

## Projection Model

Base floor assumptions:

```text
Reward payout: $3 / 1,000 views
Free signup rate from views: 3%
Free → paid retained rate: 1%
Solo price: $29.99/mo
Affiliate share: 50%
Net to Junior per paid Solo user: ~$15/mo
```

At $2,500 budget:

```text
~833,000 views
~24,990 free users at 3%
~250 paid users at 1% of free
~$7,497 gross MRR
~$3,748 net MRR after affiliate share
```

Reinvestment rule:

```text
Keep $6,000 net MRR.
Reinvest everything above into reward campaigns.
```

Under no-decay / lock-in assumptions:

- Starting around $10k net MRR can reach ~$100k net MRR around month 4.
- Starting around $10k net MRR can reach ~$1M net MRR around month 7.
- Starting below $6k net MRR stalls unless external budget is added.

## Build Gate

Before shipping any flywheel build:

- `npm run build` passes for changed frontend app(s).
- Python compiles for backend if touched.
- Packaged desktop app still boots.
- Queue opens.
- Inbox opens and notification bell has no CORS error.
- Settings opens.
- `/me` still returns Daniel as effective autopilot/founder when admin env applies.
- Earn still loads live bounties.
- Bounty workspace flow still works.
- No Stripe/Clerk plan IDs changed.

