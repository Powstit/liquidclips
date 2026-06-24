# Liquid Clips — Pricing + Feature Tier Plan

> Author: Claude · 2026-06-23
> Status: PROPOSED for Daniel review · not yet wired to Clerk products
> Companion to: `src/design-os/state/useTierCaps.ts` (canonical TIER_CAPS) +
> `docs/lc2/CLIPPER_VS_AGENCY_CAPABILITY_SPLIT.md` (mode logic)
> Builds on: TASK 8B splash screen ship + the SplashGame ecosystem

---

## TL;DR

**Clerk currently has 3 paid prices: $29 / $79 / $500.** The code today
only has 3 paid tiers wired (`clipper` · `pro` · `agency`) — meaning
`$79` has no home. Recommendation:

| Tier | Price | Code key | Status |
|---|---|---|---|
| **Free** | $0 | `clipper` | Wired (watermark-locked default) |
| **Pro** | **$29 / mo** | `pro` | Wired (caps in `TIER_CAPS.pro`) |
| **Growth** | **$79 / mo** | `growth` ← **NEW** | NOT WIRED — needs `TIER_CAPS.growth` entry + backend mapping |
| **Agency** | **$500 / mo** | `agency` | Wired (caps in `TIER_CAPS.agency`) |

The `$29 / $79 / $500` pricing IS workable but only if we add a `growth`
tier between Pro and Agency. The gap from $29 → $500 (17×) is too wide
without an intermediate — Growth at $79 captures the creator who has
outgrown Pro but isn't ready for Agency's multi-brand surface.

Backend already accepts `"growth"` in the `mapBackendTier` switch
(`useTierCaps.ts:213`) — currently maps it to the `pro` tier as a
fallback. So adding the `growth` row is a one-file change in the
front-end caps table + a Clerk plan ID.

---

## §1 · Complete feature list (every customer surface)

| Area | Feature | Source |
|---|---|---|
| **Clip generation** | Generate from URL (browser capture) | `sections/home/HomeSection.tsx` |
| | Generate from upload (mp4/mov) | `sections/home/ImportDrawer.tsx` |
| | Generate from script (transcript-driven) | `sections/home/ScriptDrawer.tsx` |
| | Library browsing (projects + history) | `sections/projects/ProjectsSection.tsx` |
| **Editing — visuals** | 8 reaction/split-screen layouts (facecam-corner, side-by-side, top-bottom, reaction-under-clip, before-after, green-screen, podcast-commentary, quote-reaction) | `design-os/studio/ReactionControls.tsx` |
| | 5 overlay templates (clean, logo-corner, lower-third pill, title-card, campaign-stamped) | `design-os/studio/OverlayTemplateGallery.tsx` |
| | Watermark toggle | `design-os/studio/OverlayTemplateGallery.tsx` |
| **Editing — audio/caption** | Caption picker + per-target caption override | `design-os/studio/ExportPanel.tsx` · `schedule/ScheduleFromExportDrawer.tsx` |
| **Export** | Format selection (9:16, 1:1, 16:9, original) | `design-os/studio/ExportPanel.tsx` |
| | Preset profiles (TikTok, Reels, Shorts, LinkedIn, Custom) | `design-os/studio/ExportPanel.tsx` |
| | Watermark rendering (forced on Free) | `design-os/studio/ClipPreviewShell.tsx` |
| | Priority render queue | `design-os/state/useTierCaps.ts` (`priorityQueue`) |
| **Scheduling** | Schedule for later (datetime + accounts) | `design-os/routes/ExportRoute.tsx` |
| | Bulk-row scheduling (1 / 25 / ∞) | `design-os/schedule/ScheduleFromExportDrawer.tsx` |
| | Monthly post cap tracking (25 / 250 / 2,500) | `design-os/routes/Schedule.tsx` |
| | Multi-account targeting per clip (1 / 3 / 10) | `design-os/schedule/ScheduleFromExportDrawer.tsx` |
| **Channels** | Connect TikTok / IG / YT / X (OAuth) | `design-os/routes/Channels.tsx` |
| | Channel slots (2 / 5 / 15 total) | `design-os/state/useTierCaps.ts` |
| **Campaigns** | Browse + submit to existing campaigns | `sections/campaigns/CampaignsSection.tsx` |
| | Create campaign + brief (Agency-only today) | `design-os/routes/Campaigns.tsx` |
| | Campaign submission review | `design-os/routes/SubmissionsReview.tsx` |
| | Whop integration (submit to bounty) | `design-os/components/SubmitToWhopModal.tsx` |
| | Campaign-stamped overlay (auto-watermark) | `design-os/studio/OverlayTemplateGallery.tsx` |
| **Earn / rewards** | Reward clip dashboard | `design-os/routes/Earn.tsx` |
| | Earnings summary (approved / pending / RPM) | `design-os/earn/EarnSummaryStrip.tsx` |
| | Filter by status | `design-os/earn/EarnFilters.tsx` |
| | Leaderboard snapshot (top-5 earners) | `design-os/routes/Earn.tsx` |
| | Sponsored campaigns banner | `components/home/SponsoredBannerCarousel.tsx` |
| **Library** | Clip projects (save/restore) | `design-os/routes/Library.tsx` |
| | History retention (30 / 90 / 365 days) | `state/useTierCaps.ts` (`historyRetentionDays`) |
| | Posting history | `design-os/routes/Schedule.tsx` |
| **Community** | Community rooms | `design-os/routes/Community.tsx` |
| | Splash game (Invaders) — TASK 8B | `overlays/invaders/SplashGame.tsx` |
| | Global leaderboard | `overlays/invaders/SplashLeaderboard.tsx` |
| **Settings & account** | Tier display + source label | `design-os/routes/Settings.tsx` |
| | Connected channels + slots view | `design-os/routes/Settings.tsx` |
| | Auth status + sign-out | `design-os/routes/Settings.tsx` |
| | Backend status pill | `design-os/routes/Settings.tsx` |
| **Analytics (Agency)** | Per-campaign views / RPM / clip performance | `design-os/routes/Analytics.tsx` (Agency-only redirect today) |
| **Browser overlay** | In-app browser with Liquid context (Whop campaigns inline) | `components/browser/BrowseOverlay.tsx` |
| **AI hosted compute (planned)** | Hosted GPU lane for transcribe + proxy_llm (Pro+ moat) | not yet wired · see `[[junior-hosted-compute]]` memory |

---

## §2 · Existing paywall gates (what's currently locked, where)

| File:line | Locked feature | Unlocked at | Current copy |
|---|---|---|---|
| `studio/ReactionControls.tsx:70-77` | "reaction-under-clip" layout | Solo+ (was) | "Layout locked · Reaction under clip unlocks at Solo+ tier" |
| `studio/ReactionControls.tsx:70-77` | "before-after" layout | Solo+ | "Layout locked · Before / after unlocks at Solo+ tier" |
| `studio/ReactionControls.tsx:70-77` | "green-screen" layout | Pro+ | "Layout locked · Green screen unlocks at Pro+ tier" |
| `studio/ReactionControls.tsx:70-77` | "podcast-commentary" layout | Pro+ | "Layout locked · Podcast commentary unlocks at Pro+ tier" |
| `studio/ReactionControls.tsx:70-77` | "quote-reaction" layout | Pro+ | "Layout locked · Quote reaction unlocks at Pro+ tier" |
| `studio/OverlayTemplateGallery.tsx:65-89` | "clean" / "logo-corner" overlays | Solo+ | "Overlay locked · X unlocks at Solo+ tier" |
| `studio/OverlayTemplateGallery.tsx:65-89` | "lower-third" / "title-card" overlays | Pro+ | "Overlay locked · X unlocks at Pro+ tier" |
| `studio/OverlayTemplateGallery.tsx:144-150` | Watermark toggle | Solo+ | "Free clips ship with Liquid watermark · upgrade to remove" |
| `studio/ExportPanel.tsx:78` | Watermark forced on | Clipper locked | (computed) |
| `schedule/ScheduleFromExportDrawer.tsx:100` | Multi-account targeting | Capped at 1 (Clipper) | "Selected N of M accounts-per-clip cap" |
| `schedule/ScheduleFromExportDrawer.tsx:108-313` | Monthly post limit | 25/mo Clipper | "Monthly post cap reached · Upgrade to AGENCY to queue more" |
| `routes/Channels.tsx:44` | Connected channel slots | 2 total / 1 per platform Clipper | (cap read, add-channel UI not yet wired) |
| `routes/Campaigns.tsx:146-152` | Create campaign button | **Agency-only** (trusted source) | `canUseAgencyActions({ tier, source })` |
| `routes/Campaigns.tsx:346-358` | Create-campaign gating copy | Agency-only | "Checking tier… / Activate first / Agency required / Demo mode" |
| `routes/Analytics.tsx:36-42` | Analytics route access | **Agency-only** | Redirects Clipper → Home if `mode === "clipper"` |
| `engine/cockpit/PublishModule.tsx:152-155` | Watermark enforcement | Clipper locked | (computed via `deriveWatermarkPromise`) |
| `engine/cockpit/StyleModule.tsx:58-63` | Style preview watermark state | Clipper locked | Reflects `tier.caps.watermarkLocked` |
| `state/useTierCaps.ts:63-112` | **All cap thresholds** (canonical) | per-tier | TIER_CAPS table (the source of truth) |

**Gates that exist but aren't surfaced in UI:**
- Priority queue (Pro+ get it, but no badge tells Clipper users they're on standard queue → invisible upsell)
- Auto-retry depth (3 across all tiers — currently no differentiation)
- Bulk scheduling rows (1 / 25 / ∞) — only enforced server-side, no UI ceiling indicator
- Campaign account templates (Agency-only boolean cap — UI not yet wired)
- History retention deltas (30 / 90 / 365 days — no expiry warning shown to lower tiers)

---

## §3 · Recommended tier scope (with $29 / $79 / $500 + Free)

The matrix below is the recommendation. **Bold = change vs current
caps table.** The Growth tier is NEW.

### Channels + posting capacity

| Cap | Free | **Pro ($29)** | **Growth ($79)** | Agency ($500) |
|---|---|---|---|---|
| Total connected channels | 2 | 5 | **10** | 15 |
| Per-platform channels | 1 | 3 | **4** | 5 |
| Brands / workspaces | 1 | 1 | **2** | 5 |
| Campaigns per brand | 1 | 5 | **10** | 20 |
| Clips per campaign | 10 | 50 | **100** | 200 |
| Monthly posts | 25 | 250 | **750** | 2,500 |
| Accounts per clip | 1 | 3 | **5** | 10 |
| Bulk scheduling rows | 1 | 25 | **75** | ∞ |
| History retention | 30 d | 90 d | **180 d** | 365 d |

### Editing + export features

| Feature | Free | Pro ($29) | Growth ($79) | Agency ($500) |
|---|---|---|---|---|
| 9:16 / 1:1 / 16:9 / original formats | ✅ | ✅ | ✅ | ✅ |
| Watermark forced on | ✅ (locked) | ❌ | ❌ | ❌ |
| 4 starter reaction layouts (facecam-corner / side-by-side / top-bottom + 1 polish) | ✅ | ✅ | ✅ | ✅ |
| Reaction-under-clip · before-after layouts | ❌ | ✅ | ✅ | ✅ |
| Green-screen · podcast-commentary · quote-reaction layouts | ❌ | ❌ | ✅ | ✅ |
| Clean / logo-corner overlays | ❌ | ✅ | ✅ | ✅ |
| Lower-third pill · title-card overlays | ❌ | ❌ | ✅ | ✅ |
| Priority render queue | ❌ | ❌ | ✅ | ✅ |
| Hosted AI compute (transcribe + proxy_llm) | ❌ | ❌ | ✅ | ✅ |
| Analytics access | URLs only | engagement | engagement | rollups (full) |
| Campaign creation | ❌ | ❌ | ❌ | ✅ |
| Campaign account templates | ❌ | ❌ | ❌ | ✅ |
| Multi-brand workspaces (>1) | ❌ | ❌ | ✅ (2) | ✅ (5) |

### What makes each tier "feel" different (the upgrade narrative)

| Tier | The one thing it unlocks that the prior tier didn't |
|---|---|
| **Pro $29** | **Watermark off** · the cleanest possible clip ships under your name |
| **Growth $79** | **Hosted AI compute + priority queue** · clips render faster, captions stop costing your CPU |
| **Agency $500** | **Multi-brand workspaces + campaign creation** · run brand bounties for your agency clients |

---

## §4 · Implementation notes

**To wire the `growth` tier into `useTierCaps.ts`:**

```ts
// In useTierCaps.ts · 1-file change

export type Tier = "clipper" | "pro" | "growth" | "agency"; // add "growth"

export const TIER_CAPS: Record<Tier, TierCaps> = {
  clipper: {/* unchanged */},
  pro: {/* unchanged */},
  growth: {  // NEW
    totalChannels: 10,
    perPlatformChannels: 4,
    brands: 2,
    campaignsPerBrand: 10,
    clipsPerCampaign: 100,
    monthlyPosts: 750,
    accountsPerClip: 5,
    bulkSchedulingRows: 75,
    campaignAccountTemplates: false,
    watermarkLocked: false,
    priorityQueue: true,
    autoRetryDepth: 5,             // bumped from 3
    historyRetentionDays: 180,
    analyticsAccess: "engagement",
  },
  agency: {/* unchanged */},
};

// Update mapBackendTier:
function mapBackendTier(raw: string | null | undefined): Tier | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  if (t === "agency" || t === "autopilot") return "agency";
  if (t === "growth") return "growth";        // NEW
  if (t === "pro" || t === "channel" || t === "solo") return "pro";
  if (t === "free" || t === "starter" || t === "clipper") return "clipper";
  return null;
}
```

**Clerk side:**
- Create Clerk product "Liquid Clips Growth" at $79/mo
- Map the Clerk plan ID to tier value `"growth"` in the webhook/sync path
- Ensure backend `/me.effective_tier` returns `"growth"` for $79 subscribers

**Copy updates (`copyMap.ts`):**
- Add `upgrade_growth: "Upgrade to Growth · $79/mo"`
- Update CTAs on Pro+-locked features to point at Growth where it makes sense (e.g., hosted-AI-compute CTAs)
- Update "Upgrade to AGENCY" copy on monthly-post-cap upsell — for Pro users, suggest Growth first ($79 → 750/mo); only suggest Agency at the Growth ceiling

**UI gaps to wire:**
- Surface priority-queue badge to Free/Pro users ("Standard queue" badge on export → invisible upsell becomes visible)
- Show history-retention expiry warnings on Clipper ("Your clip history expires in 7 days · Upgrade to Pro for 90 days")
- Wire `add-channel` button to enforce channel-slot cap
- Pro-lite analytics view ("top clip + total reach") to drive Growth upsell

---

## §5 · What's still open for Daniel

1. **Free tier name** — keep it as "Free" in UI, or rebrand to "Clipper" (matches code key)?
2. **Annual discount** — do we offer Pro at $290/yr (~17% off) and Growth at $790/yr?
3. **Pro vs Growth differentiator headline** — is *hosted AI compute + priority queue* enough to justify $50/mo step-up? Optional adds: Connect TikTok Business API · auto-RPM analytics · branded campaign-link tracking.
4. **Agency "trial mode"** — should Pro/Growth users see the Campaign Create flow with a "Agency required to create — preview the surface" affordance? Currently Campaigns is fully hidden below Agency. A read-only preview drives upgrade intent.
5. **$500 Agency · what's the SECRET sauce that makes it worth 6.3× Growth?** Recommendation: campaign creation, multi-brand workspaces, analytics rollups, ∞ bulk scheduling, dedicated onboarding session. Anything else?

---

## §6 · Honest finding (do the prices "work"?)

**Yes — $29 / $79 / $500 IS a viable ladder, with two caveats:**

1. **Add the `growth` tier to the code** (one-file change). Without it, $79 maps to `pro` (same caps as $29) — paying users would get nothing extra. ⚠️ Critical.
2. **Make the Growth value-prop concrete BEFORE shipping** — Pro→Growth needs a clear "this is why I'd pay $50 more" hook. My recommendation: hosted AI compute + priority queue + 3× channel/post capacity. If hosted AI compute isn't wired yet, ship Growth with the capacity uplift + priority queue and treat hosted-compute as the v2.

Once those two are in, the ladder reads cleanly:
- $0 → playground (watermarked)
- $29 → pro creator (watermark off)
- $79 → pro-creator-at-scale (faster + bigger + hosted AI)
- $500 → agency operator (campaigns + multi-brand + analytics)

Ready to wire the `growth` tier into `useTierCaps.ts` and add the Clerk
plan when you give the word.
