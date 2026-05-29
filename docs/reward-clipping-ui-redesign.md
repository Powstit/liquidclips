# Liquid Clips reward-clipping UI redesign

> Created 2026-05-28.
> Purpose: redesign the desktop/account surfaces around the new reward-clipping scope without trying to build every feature at once.

## UI strategy

The app needs to visually reorganize around a three-pane operator workflow:

1. Campaign context: browse, score, rules, payout source.
2. Clip production: import assets, generate candidates, edit/export.
3. Submission tracking: posted links, status, views, payout estimate.

The current app can support this without a total rewrite. The key is to turn the Earn tab and Browse Rewards panel into a connected workspace, then let the existing clipping pipeline attach to a selected campaign brief.

## Proposed information architecture

### Desktop navigation

| Current area | Proposed role | Notes |
|---|---|---|
| Home / Upload | Keep as "Clip" workspace | Still the place to drop videos and generate clips. Add campaign context when one is selected. |
| Results | Keep as clip review/export | Add campaign eligibility checks, hook/title, variants, and submission status. |
| Earn | Promote to "Campaigns" or keep "Earn" with campaign-first layout | This becomes the money cockpit. |
| Settings | Keep | Add payout/connect status only if needed; avoid burying payout visibility here. |

Recommendation: keep nav label `Earn` for now because it is user-facing and short, but internally redesign it as a campaign/submission workspace.

## Earn tab redesign

### Current feel

Earn is partly affiliate dashboard, partly Whop bounty list, partly payout surface.

### New layout

| Section | Purpose | Priority |
|---|---|---|
| Browse Rewards button/panel | Opens Whop in-app side browser | P0 |
| Campaign shortlist | Saved/active campaigns with score and payout | P0 |
| Active campaign brief | Rules, source assets, platforms, payout, submission instructions | P0 |
| Submission tracker | Clips submitted/pending/approved/rejected | P1 |
| Payout visibility | "Paid by Whop", "Paid by platform", "Paid by Liquid Clips via Stripe Connect" | P1 |
| Liquid Clips affiliate card | Referral commissions | P2, below campaign workflow |

### Earn tab visual wireframe

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Earn                                                                         │
│ Browse reward campaigns, save briefs, and track submitted clips.             │
├──────────────────────────────────────────────────────────────────────────────┤
│ [Browse Rewards] [Paste campaign URL]                         Payout status  │
├───────────────────────────────┬──────────────────────────────────────────────┤
│ Campaigns                     │ Active Brief                                 │
│                               │                                              │
│ Score 84  $2.00/1k  Whop      │ Campaign title                               │
│ Open now · 42% budget used    │ Paid by Whop · TikTok, IG                    │
│ Easy rules · 3 platforms      │ Budget healthy · No waitlist                 │
│                               │                                              │
│ Score 61  $5.00/1k  Clipify   │ Rules checklist                              │
│ Strict geo · min 10k views    │ [ ] Product visible                          │
│                               │ [ ] 10s-60s                                  │
│                               │ [ ] Hashtag included                         │
├───────────────────────────────┴──────────────────────────────────────────────┤
│ Submissions                                                                  │
│ Clip                     Platform        Status        Views       Est payout │
│ Tate hook v2             TikTok          Submitted     18.4k       $36.80     │
│ Podcast influence v1     IG Reels        Needs link    -           -          │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Browse Rewards side panel

The side browser is not a novelty feature. It is the campaign research surface.

### Required behavior

| Capability | Priority | Reason |
|---|---|---|
| Real Tauri child webview | Done / P0 | Needed because Whop cannot iframe. |
| Back/forward/reload/close | Done / P0 | Makes it feel like a normal browser. |
| Commerce URL filter | P0 | Protect Apple review and avoid in-app checkout issues. |
| Open brief from Whop card into active campaign | P0 | Converts browsing into workflow. |
| Save current campaign URL | P0 | Minimum version of campaign capture. |
| Extract structured rules automatically | P1 | Can start manual/semi-structured before parser is reliable. |
| Support multiple campaign platforms | P2 | Whop first, Clipify later. |

### Panel placement

Keep browser on the right. Editing/output remains on the left. This mirrors how users research campaigns while working.

When Browse Rewards is open:

```text
┌─────────────────────────────────────────────┬──────────────────────────────┐
│ Liquid Clips app                            │ Browse Rewards webview        │
│ Clip workspace / Earn workspace             │ Whop / campaign platform      │
│                                             │                              │
│ Active campaign brief remains visible       │ User scrolls, logs in, opens  │
│ beside clip production when possible.       │ briefs, copies/saves campaign │
└─────────────────────────────────────────────┴──────────────────────────────┘
```

## Clip workspace changes

### Add campaign context strip

When a campaign is selected, the Upload/Clip screen should show a compact brief strip:

```text
Campaign: Creator reward · $2/1k · TikTok + IG · Rules: 10s-60s, captions, product visible
[View brief] [Change campaign] [Clear]
```

This makes the app feel campaign-native without rebuilding the whole editor.

### Batch-first controls

Current generic clipping controls should lean into batch output:

| Control | New copy / behavior |
|---|---|
| Generate clips | "Generate campaign clips" when brief selected |
| Export all | "Export batch" |
| Output folder | Default to campaign folder: `~/Liquid Clips/rewards/<campaign-slug>` |
| Clip count | Show "12 candidates" / "8 eligible" instead of only generic output counts |

## Results grid changes

The Results grid should become the review bench.

### Add to each clip card

| Field | Reason |
|---|---|
| Hook score | First 2 seconds decide scroll-stop. |
| Brief fit | Length, captions, keyword/product/person appearance, platform match. |
| Title overlay | The title is part of the viral mechanism. |
| Variant count | Encourages doubling down. |
| Submission status | Links clip production to money outcome. |

### Clip card action order

Recommended primary actions:

1. Preview
2. Edit title/captions
3. Make variants
4. Export
5. Mark posted / add post URL
6. Submit / open campaign submission

Do not make auto-publish the primary action until publishing is actually live.

## Account app changes

The account dashboard should explain money routes clearly.

### Add a payout routing card

```text
Payout routes

Whop reward campaigns
Paid by Whop. Manage reward submissions and payout status on Whop.

Liquid Clips affiliate commissions
Paid by Liquid Clips through Stripe Connect.
[Set up Stripe Connect] or [Open Express Dashboard]

Other campaign platforms
Paid by the platform or brand running that campaign.
```

This avoids mixing three different money systems.

### Keep Stripe Connect focused

Stripe Connect is for Liquid Clips' own affiliate commissions, not Whop reward campaign payouts. Copy should say that explicitly.

## Marketing changes

The homepage should lead with the reward-clipping workflow, not generic AI editing.

### Above-the-fold copy direction

Headline:

> The clipping command center for reward campaigns.

Subcopy:

> Browse paid campaigns, keep the brief beside your editor, generate batches of clips, and track what gets posted, approved, and paid.

Primary CTA:

> Download Liquid Clips

Secondary CTA:

> See how reward clipping works

### Homepage section order

| Order | Section | Keep/change |
|---|---|---|
| 1 | Hero: reward-campaign command center | Replace generic "AI editor" framing |
| 2 | Workflow: browse -> brief -> batch -> submit -> track | Add |
| 3 | In-app Browse Rewards / side panel | Elevate |
| 4 | Local-first batch clipping | Keep |
| 5 | Campaign-aware checks | Add |
| 6 | Pricing | Keep, but avoid implying payout guarantees |
| 7 | Affiliate program | Move lower |
| 8 | Publishing/drip | Keep beta-labeled/lower |

## What to remove from UI focus

| UI item | Decision | Why |
|---|---|---|
| Prominent auto-publish CTAs | Hide/beta-label | Not live enough; not the clipping PMF wedge. |
| Broad "run your whole channel" claims | Replace | Too broad and can imply scheduling/autopilot that is beta. |
| Affiliate program as main Earn content | Move below campaigns | Users first need to make money clipping, then referring. |
| Hosted AI upsell copy | Keep private beta | Not central to reward campaign workflow yet. |
| Decorative polish that does not clarify workflow | Defer | Need operator clarity before visual luxury. |

## Minimal v1 UI implementation

Do not build the full dream state first. Build this:

1. Earn tab: campaign-first layout with Browse Rewards and Active Brief.
2. Manual campaign save: user can save a Whop URL and fill/edit key rules.
3. Campaign context strip on Upload/Results.
4. Results: add title/hook/brief-fit fields and "Make variants" placeholder/action.
5. Submission tracker with manual post URL + status fields.
6. Account dashboard payout routing card.
7. Marketing homepage recopy around reward-campaign command center.

That is enough for the product to feel intentionally built for the market.
