# Junior PostHog Architecture: Affiliate Starter Pass + Reward Campaign Funnel

Last updated: 2026-05-24

## Why This Exists

Junior's growth loop is now clear:

1. A clipper sees a Junior reward/promo clip.
2. They click or scan an affiliate link.
3. They start the Affiliate Starter Pass.
4. They activate the desktop.
5. They create a Whop bounty workspace.
6. They export bounty clips.
7. They convert to Solo/Growth/Autopilot.
8. The referring affiliate earns 50% MRR after paid conversion.

PostHog needs to answer one business question:

> Does paying for reward-campaign views create retained paid MRR?

The dashboard should let Daniel estimate:

```text
£2,500 reward budget
→ number of reward clips
→ total views
→ starter pass activations
→ bounty exports
→ paid conversions
→ still active after 30 days
→ gross/net MRR
```

## Rule

Do not track personal data.

Never send:

- email
- full name
- video filenames
- local file paths
- transcript text
- access tokens
- JWTs
- raw Whop/Stripe payloads

Use IDs only:

- `clerk_id`
- `backend_user_id`
- `affiliate_id`
- `offer_id`
- `campaign_id`
- `clip_id`
- `bounty_id`

## Event Naming

Use lower snake case.

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

## Events

### reward_clip_viewed

Purpose: joins Whop reward campaign views to downstream conversions.

Important: PostHog cannot magically know social views unless we send or sync them. For v0.1 this can be emitted by a backend sync/manual import when Whop submissions report view counts.

Properties:

```ts
{
  campaign_id: string;
  bounty_id?: string;
  affiliate_id?: string;
  clip_id?: string;
  platform: "youtube" | "tiktok" | "instagram" | "x" | "other";
  view_count: number;
  view_count_source: "whop_submission" | "manual_import" | "platform_api";
}
```

### affiliate_link_clicked

Purpose: measures the first click/scan from a promo clip to Junior.

Emit from marketing/account app when landing with `?ref=` or `?a=`.

Properties:

```ts
{
  affiliate_id: string;
  campaign_id?: string;
  clip_id?: string;
  source_platform?: "youtube" | "tiktok" | "instagram" | "x" | "unknown";
  offer_id?: string;
}
```

### starter_pass_started

Purpose: measures the moment a user successfully redeems a starter pass.

Emit only after:

- user is created/signed in
- card requirement is satisfied, if enabled
- backend creates the credit grant

Properties:

```ts
{
  affiliate_id: string;
  offer_id: string;
  grant_id: string;
  credits_total: number;
  expires_days: number;
  card_on_file: boolean;
  byok_required: boolean;
}
```

### desktop_activated

Purpose: measures whether web signups actually make it into the desktop.

Existing backend event may already exist. Ensure it includes offer/ref properties when available.

Properties:

```ts
{
  affiliate_id?: string;
  offer_id?: string;
  grant_id?: string;
  tier: "free" | "solo" | "growth" | "autopilot";
  activation_source: "desktop_connect" | "sync" | "manual";
}
```

### first_bounty_workspace_created

Purpose: core activation event. This is more meaningful than signup.

Emit once per user, first time a project with `whop_bounty_id` is created.

Properties:

```ts
{
  affiliate_id?: string;
  offer_id?: string;
  grant_id?: string;
  bounty_id: string;
  source_type: "detected_url" | "pasted_url" | "upload";
  allowed_platforms?: string[];
}
```

### bounty_clip_exported

Purpose: measures real product value and burns trial credits.

Emit for every exported clip from a bounty-linked project.

Properties:

```ts
{
  affiliate_id?: string;
  offer_id?: string;
  grant_id?: string;
  bounty_id: string;
  project_slug: string;
  export_count: number;
  credits_remaining?: number;
  fit_score?: number;
}
```

### starter_pass_exhausted

Purpose: tells us whether the 100-credit limit is doing its job.

Emit when either:

- credits reach zero
- the 30-day window expires

Properties:

```ts
{
  affiliate_id: string;
  offer_id: string;
  grant_id: string;
  credits_used: number;
  days_since_start: number;
  reason: "credits_used" | "expired";
}
```

### subscription_activated

Purpose: paid conversion.

Already exists in backend analytics. Ensure it includes affiliate/starter pass attribution.

Properties:

```ts
{
  affiliate_id?: string;
  offer_id?: string;
  grant_id?: string;
  tier: "solo" | "growth" | "autopilot";
  plan_price_gbp?: number;
  billing_provider: "clerk" | "whop";
}
```

### subscription_still_active_day_30

Purpose: retention quality. Avoid optimizing for users who immediately cancel.

Emit from a backend scheduled job/check, not the frontend.

Properties:

```ts
{
  affiliate_id?: string;
  offer_id?: string;
  grant_id?: string;
  tier: "solo" | "growth" | "autopilot";
  plan_price_gbp?: number;
  billing_provider: "clerk" | "whop";
  days_active: 30;
}
```

## Required Dashboard

Create dashboard:

```text
Affiliate Starter Pass Funnel
```

Charts:

1. Reward campaign views by `campaign_id`
2. Views → affiliate link clicks
3. Clicks → starter pass started
4. Starter pass started → desktop activated
5. Desktop activated → first bounty workspace created
6. First bounty workspace → first bounty clip exported
7. First export → subscription activated
8. Subscription activated → still active at day 30
9. Paid users by `affiliate_id`
10. Paid MRR by `affiliate_id`
11. Paid users by `campaign_id`
12. Cost per paid user by `campaign_id`
13. Credits used before conversion
14. Starter passes exhausted vs expired

## Business Benchmarks

For campaign analysis, use these fields:

```text
reward_budget_gbp
reward_cpm_usd
total_views
starter_pass_started_count
paid_user_count
day_30_active_paid_user_count
gross_mrr_gbp
affiliate_share_mrr_gbp
net_mrr_gbp
```

Initial reward campaign assumption:

```text
Reward payout: $3 / 1,000 views
Average clip: 10,000 views
Cost per 10k-view clip: $30
£2,500 budget ≈ ~100 clips ≈ ~1M views
```

Success thresholds for a £2,500 test:

```text
Bad:       under 100 paid users
Okay:      100-250 paid users
Good:      250-500 paid users
Excellent: 500-1,000 paid users
Insane:    1,000+ paid users
```

## Implementation Boundaries

Do not block the bounty workspace release on this.

Phase 1:

- Add event constants/types.
- Add safe tracking calls where events already naturally happen.
- Ensure backend analytics sanitizer strips sensitive fields.
- No dashboard automation required yet; Daniel can create charts manually.

Phase 2:

- Add starter pass ledger.
- Add credit burn event.
- Add `/me` credit balance fields.
- Add backend scheduled retention event for day 30.

Phase 3:

- Sync/import Whop Content Reward view counts.
- Join reward views to `campaign_id`, `affiliate_id`, and downstream conversions.

## Surfaces To Be Careful With

### Desktop

- Do not break Queue.
- Do not break Inbox.
- Do not break Settings.
- Do not make PostHog mandatory for app function.
- If PostHog key is absent, tracking should no-op.

### Backend

- Do not send emails/names/tokens to PostHog.
- Do not treat trial signup as paid conversion.
- Do not pay affiliate commission until first successful paid invoice.
- Do not emit day-30 retention from frontend.

### Partner App

- Existing affiliate IDs are Whop affiliate record IDs.
- Keep referral URLs stable.
- Do not replace affiliate IDs with display usernames.

## Acceptance Criteria

The analytics implementation is acceptable when:

- Events are emitted with the exact names above.
- No PII/secrets are sent.
- Missing PostHog config does not throw.
- Existing `subscription_activated` includes `affiliate_id` when known.
- A starter-pass user can be followed from click → desktop activation → bounty workspace → export → paid conversion.
- Dashboard can answer: "What did £2,500 of reward-campaign spend produce in paid MRR?"

