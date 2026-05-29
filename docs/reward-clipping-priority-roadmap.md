# Liquid Clips reward-clipping priority roadmap

> Created 2026-05-28.
> Purpose: turn the new market scope into a focused roadmap. This intentionally cuts or demotes work that does not serve reward-clipping PMF.

## Prioritization rule

Build the smallest version of the campaign money loop:

Campaign -> Brief -> Batch -> Export -> Post URL -> Submission status -> Payout route.

Everything else waits unless it makes that loop clearer or safer.

## P0: Must ship for the new positioning

| ID | Work | Add/change/remove | Owner surface | Why | Notes |
|---|---|---|---|---|---|
| RC-1 | Campaign Brief v1 | Add | Desktop Earn + backend/local storage | Keeps campaign rules beside editing. | Manual entry is acceptable first. Fields: URL, title, payout, platform, rules, source links, payout provider. |
| RC-2 | Browse Rewards connected to briefs | Change | Desktop BrowseRewardsPanel + EarnTab | Side browser must create workflow state, not just browse. | "Save as campaign brief" button is enough for v1. |
| RC-3 | Campaign context strip | Add | Upload/Results | Makes clipping feel campaign-native. | Shows selected campaign, payout, platforms, key rules. |
| RC-4 | Submission Tracker v1 | Add | Earn tab | Users need to know what was posted/submitted/paid. | Manual post URL + manual status first. No social API dependency. |
| RC-5 | Payout routing clarity | Change | Account app + desktop Earn | Prevents Whop/Stripe confusion. | Whop rewards paid by Whop; Liquid Clips affiliate commissions paid through Stripe Connect. |
| RC-6 | Marketing recopy | Change | Marketing | Aligns external promise with actual PMF. | Replace generic AI editor hero with reward-campaign workflow. |
| RC-7 | Auto-publish/drip demotion | Remove from focus | Desktop + marketing + account copy | Avoids overpromising beta publishing. | Keep beta labels and do not make it primary CTA. |

## P1: Strong follow-up after P0

| ID | Work | Add/change/remove | Owner surface | Why | Notes |
|---|---|---|---|---|---|
| RC-8 | Campaign Score | Add | Earn tab | Helps users choose campaigns like the transcripts teach. | Score payout, budget, waitlist, allowed platforms, rules complexity. |
| RC-9 | Brief fit checks | Add | ResultsGrid | Reduces rejection risk. | Start with deterministic checks: duration, platform, captions present, required text entered. |
| RC-10 | Hook/title generator | Add | ResultsGrid / clip editor | Titles are core to viral retention. | Generate 3 title overlays per clip. |
| RC-11 | Variant maker | Add | ResultsGrid | Productizes the "double down" tactic. | Duplicate clip metadata with alternate title/caption style/opening crop. |
| RC-12 | Batch naming/folders | Change | Desktop export path | Makes output operator-friendly. | `~/Liquid Clips/rewards/<campaign>/<date>/`. |
| RC-13 | Warm-up posting plan | Add | Earn/Results | Helps beginners avoid spam/shadowban behavior. | Manual reminders first; no auto-posting. |

## P2: Later, once the loop works

| ID | Work | Add/change/remove | Owner surface | Why | Notes |
|---|---|---|---|---|---|
| RC-14 | Structured Whop brief extraction | Add | Backend/desktop | Saves manual entry. | Needs careful parsing and resilience. |
| RC-15 | Clipify-style platform support | Add | Campaign abstraction | Market is bigger than Whop. | Do only after Whop flow is stable. |
| RC-16 | Social view tracking | Add | Platform integrations | Automates submission tracker. | Requires OAuth/platform APIs and more review risk. |
| RC-17 | Auto-submit assistance | Add | Browser/deep links | Speeds workflow. | Avoid anything that violates platform rules. |
| RC-18 | Full auto-publish/drip | Add | Postiz/publishing | Useful after campaign workflow is proven. | Keep beta until reliable. |

## Explicitly deprioritized

| Item | Decision | Reason |
|---|---|---|
| Full custom Stripe account dashboard | Do not build now | Express Dashboard is correct. Building our own adds compliance/support burden without helping clipping PMF. |
| Marketplace seller payments | Do not build now | Business model is platform subscriptions + affiliate commissions, not buyer-seller marketplace. |
| Mac App Store IAP adaptation | Later | Current payment model depends on Whop/Stripe/affiliate flows. |
| Hosted AI as main wedge | Later | Local batch processing is enough for this market; hosted claims are currently beta. |
| Full UI polish system | Later | Product workflow clarity matters more than shadows and animations. |
| Complex social automation | Later | Manual post URL/submission tracking proves the workflow without API fragility. |

## Data model v1

This can be local-first initially, then synced later.

### CampaignBrief

| Field | Type | Notes |
|---|---|---|
| id | string | Local UUID. |
| platform | enum | `whop`, `clipify`, `manual`, later more. |
| source_url | string | Campaign page URL. |
| title | string | Campaign/creator name. |
| payout_label | string | e.g. `$2 / 1k views`. |
| payout_provider | enum | `whop`, `external_platform`, `liquid_clips_stripe`, `unknown`. |
| allowed_platforms | string[] | TikTok, Instagram, YouTube Shorts, X. |
| rules | string[] | Human-readable checklist. |
| required_assets_url | string | Google Drive/source assets. |
| budget_status | string | Manual v1; structured later. |
| waitlist_status | string | Manual v1. |
| created_at | datetime |  |
| updated_at | datetime |  |

### ClipSubmission

| Field | Type | Notes |
|---|---|---|
| id | string | Local UUID. |
| campaign_brief_id | string | Links to CampaignBrief. |
| clip_path | string | Exported file path. |
| platform | string | TikTok, Instagram, YouTube Shorts, etc. |
| post_url | string | Manual v1. |
| submission_status | enum | `draft`, `posted`, `submitted`, `approved`, `rejected`, `paid`. |
| views | number | Manual v1. |
| estimated_payout | string | Derived/manual. |
| actual_payout | string | Manual v1. |
| notes | string | Rejection reason, requirements, etc. |
| created_at | datetime |  |
| updated_at | datetime |  |

## UI implementation sequence

| Step | Change | Files likely touched |
|---|---|---|
| 1 | Add local campaign brief/submission types + persistence helper | `desktop/src/lib/*` |
| 2 | Redesign Earn tab around campaigns, active brief, submissions | `desktop/src/components/earn/EarnTab.tsx` and new child components |
| 3 | Add "Save as brief" / "Open in panel" connections | `BrowseRewardsPanel.tsx`, `browse.ts`, bounty card components |
| 4 | Add campaign context strip to Upload/Results | `UploadTab.tsx`, `ResultsGrid.tsx`, shared component |
| 5 | Add manual submission tracker | New `SubmissionTracker.tsx` |
| 6 | Add account payout routing card | `account-app/src/app/dashboard/page.tsx`, maybe `AffiliateCard.tsx` |
| 7 | Recopy marketing hero/workflow sections | `marketing/index.html` |

## Copy system

### Use this language

- "Campaign brief"
- "Reward campaign"
- "Eligible clip"
- "Submission"
- "Estimated payout"
- "Paid by Whop"
- "Paid through Stripe Connect"
- "Make variants"
- "Batch"
- "Warm-up plan"

### Avoid this language as primary positioning

- "AI editor"
- "Run your whole channel"
- "Autopilot" as the main promise
- "Passive income"
- "Guaranteed payout"
- "Marketplace"
- "Seller dashboard"

## Definition of done for the pivot

The pivot is real when:

1. A user can save a campaign brief from Browse Rewards.
2. The brief appears beside Upload/Results while generating clips.
3. Exported clips can be associated with that campaign.
4. The user can add post URLs and track submission status.
5. The account dashboard clearly says which payouts are Whop vs Stripe Connect.
6. The homepage says reward-campaign command center before it says generic AI clipping.

Anything beyond that is growth, polish, or automation.
