# Phase 6N-A · Campaign Foundation Architecture

Status: read-only design pass. No code, no UI, no assets, no backend migrations. Output of this phase is this single document.

---

## Executive summary

**Campaign is already 70% built in the backend.** The existing `SponsoredCampaign` table (`junior-backend/app/models.py:578-657`, 45+ columns) carries most of the canonical field set Daniel locked in the clarification — `slug`, `name`, `brand`, `rpm_cents` / `base_rpm_cents` / `premium_rpm_cents` / `premium_bonus_cents`, `budget_cents`, `funded_pct`, `banner_url`, `eligibility`, `visibility_tiers`, `mission_type`, `mission_lane`, `community_channel_id`, `whop_campaign_id`, `is_invite_only`, `affiliate_enabled`. The submissions side is also live as `CampaignSubmission` (lines 511-562), already wired to the watermark detector + Whop content-reward queue.

**What's missing is taxonomy, not infrastructure.**

1. The table is named `sponsored_campaigns` — but **sponsorship is a placement quality, not a campaign kind**. Per the clarification, Campaign is the parent of *every* discoverable, fundable, postable opportunity.
2. There is no `campaign_type` discriminator field. The current row is implicitly a Clip Campaign. The 4 types Daniel wants (Clip / Coordination / Affiliate / Submission) need a discriminator + per-type field handling.
3. Asset sources are partially modelled (`banner_url`, `whop_url`) but there's no generic `asset_sources` collection that can hold Drive folders + Dropbox files + Whop assets + direct uploads side-by-side.
4. Discussion attachment is implicit via `community_channel_id` — which carries the Whop chat link. There is no neutral discussion-provider field that lets `provider = "whop"` mean "the temporary mirror" and `provider = "native"` mean "the future Liquid Clips chat" without a schema migration.
5. Payout rules are flat scalars (`rpm_cents` + `base_rpm_cents` + `premium_rpm_cents`). The directive needs polymorphic payout rules (flat / RPM / tiered / bonus / capacity-limited) — a JSON column or a sibling `campaign_payout_rules` table.
6. Featured placement is implied via `sort_order` + `is_invite_only` + `mission_type`. There's no clean `is_featured` / `is_sponsored` / `category_spotlight` discriminator decoupled from sort order.
7. The frontend `fakeCampaigns.ts` fixture uses a **completely different shape** from the backend `SponsoredCampaign`. Phase 6N-B's adapter (`campaignFromBackend` / `campaignToDiscussion`) needs to unify them.

**Recommended path: extend-and-rename, not rebuild.** Keep the `sponsored_campaigns` table (it carries production data already), add the discriminator + JSON columns this report defines, and let `Sponsored` collapse into a `placement_quality` field. The class is renamed to `Campaign` in code; the table either renames (cleaner) or gains an alias view (zero-downtime).

---

## 1 · Entity diagram

The single Campaign object sits at the centre. Every product surface listed in the clarification is a **projection** of Campaign — not a sibling entity.

```
                         ┌────────────────────────────────┐
                         │            Campaign            │   ←  single source of truth
                         │  (renamed sponsored_campaigns) │
                         └──────┬───────┬────────┬────────┘
                                │       │        │
        ┌───────────────────────┼───────┼────────┼───────────────────────┐
        │                       │       │        │                       │
        ▼                       ▼       ▼        ▼                       ▼
┌──────────────┐       ┌──────────────┐ │ ┌──────────────┐       ┌─────────────────┐
│ DiscoveryCard│       │ CampaignPage │ │ │  RewardBanner│       │ FeaturedSlot    │
│   (derived)  │       │  (derived)   │ │ │   (derived)  │       │  (derived view) │
└──────────────┘       └──────────────┘ │ └──────────────┘       └─────────────────┘
                                        │
                  ┌─────────────────────┼─────────────────────────────┐
                  ▼                     ▼                             ▼
       ┌────────────────────┐ ┌────────────────────┐     ┌──────────────────────┐
       │     Discussion     │ │     Submission     │     │       Payout         │
       │  (FK · provider:   │ │  (FK campaign_id)  │     │ (FK submission_id)   │
       │   whop|native)     │ │  → CampaignSubmis- │     │  · derived from      │
       │                    │ │     sion model     │     │    payout_rules JSON │
       └────────┬───────────┘ └────────┬───────────┘     └──────────────────────┘
                │                      │
                ▼                      ▼
     ┌─────────────────────┐ ┌──────────────────────┐
     │ CommunityChannel    │ │  TrackingLink        │
     │ (FK community_      │ │  (FK + RewardClip    │
     │  channel_id)        │ │   already in prod)   │
     └─────────────────────┘ └──────────────────────┘
                                       │
                                       ▼
                            ┌─────────────────────────┐
                            │       AssetSource       │
                            │   (polymorphic JSON     │
                            │    blob OR sibling row  │
                            │    per source kind)     │
                            └─────────────────────────┘
```

**Reading the diagram:**

- The four boxes in the top row (DiscoveryCard / CampaignPage / RewardBanner / FeaturedSlot) are **rendering projections** of Campaign — no separate tables, no separate IDs. They take one Campaign row + viewer context and render different surfaces.
- Discussion is **owned** by Campaign via a `discussion_provider` enum + optional `community_channel_id` FK. When provider = `whop`, the Whop chat URL builds from `community_channel.whop_channel_id`. When provider = `native`, the Liquid Clips native discussion sits in `lc_discussions` (future) keyed by `campaign_id`.
- Submission is the **only child entity with its own ID** (already `campaign_submissions` table). Each submission FKs back to Campaign.
- Payout is **derived** from `payout_rules` JSON on Campaign + the submission's verified view count. No standalone Payout entity unless the ledger needs auditable rows (decision deferred).
- AssetSource is the polymorphic source-of-truth for Drive / Dropbox / Whop / direct uploads. Recommended as a JSON column today; promotable to a sibling table when ingestion lifecycle needs auditing.

---

## 2 · Data model

Schema laid out field-by-field. **"Today"** = column already exists in `sponsored_campaigns`. **"Add"** = new column needed for 6N-A scope. **"Future"** = land in a later phase, not blocking 6N-B.

### 2.1 Core identity

| Field | Type | Required | Today | Gap |
| --- | --- | --- | --- | --- |
| `id` | string PK | ✓ | ✓ | — |
| `slug` | string UNIQUE | ✓ | ✓ | — |
| `title` | string | ✓ | ✓ as `name` | rename `name → title` (or surface alias) |
| `subtitle` | string\|null | — | ✓ | — |
| `description` | text | ✓ | ⚠ | **Add** — currently absent; needed for the campaign page body |
| `brand` | string\|null | — | ✓ | — |
| `business_unit` | enum string | — | ✓ | — |
| `created_by` | FK users.id | ✓ | ⚠ | **Add** — table lacks ownership FK today (admin-only mutation) |
| `created_at` | tz timestamp | ✓ | ✓ | — |
| `updated_at` | tz timestamp | ✓ | ✓ | — |

### 2.2 Type + status

| Field | Type | Required | Today | Gap |
| --- | --- | --- | --- | --- |
| `campaign_type` | enum `clip` \| `coordination` \| `affiliate` \| `submission` | ✓ | ⚠ | **Add (critical)** · discriminator that unlocks per-type fields below |
| `status` | enum `draft` \| `coming_soon` \| `partially_funded` \| `funded` \| `live` \| `closed` | ✓ | ✓ | extend enum with `draft` |
| `visibility` | enum `public` \| `invite_only` \| `members_only` | ✓ | ⚠ partial | **Consolidate** · `type=invite_only` + `is_invite_only` overlap today; collapse into one |
| `placement_quality` | enum `standard` \| `featured` \| `sponsored` \| `category_spotlight` | ✓ | ⚠ partial | **Add** · replaces ad-hoc `sort_order`-based featuring (see §6) |

### 2.3 Reward + payout

| Field | Type | Required | Today | Gap |
| --- | --- | --- | --- | --- |
| `reward_type` | enum `usd` \| `points` \| `mixed` | ✓ | ⚠ | **Add** — implicit USD today; explicit field unblocks coordination campaigns (often points-only) |
| `reward_amount_cents` | int | conditional | partial | combine `rpm_cents`, `base_rpm_cents`, `premium_rpm_cents` under the JSON rule set below |
| `reward_pool_cents` | int | ✓ | ✓ as `budget_cents` | rename or alias for clarity |
| `payout_rules` | JSON | ✓ | ⚠ | **Add** · polymorphic rule blob (§5). Today represented by 3 separate scalar columns plus `requires_membership` |
| `funded_pct` | int 0..100 | — | ✓ | — |
| `min_lc_score` | int 0..100 | — | ✓ | — |

### 2.4 Capacity + timing

| Field | Type | Required | Today | Gap |
| --- | --- | --- | --- | --- |
| `capacity_total` | int\|null | conditional | ⚠ | **Add** · drives "2,000 upvotes" coordination campaigns and submission caps |
| `capacity_used` | int | derived | ⚠ | **Add** · live tally from CampaignSubmission count |
| `capacity_window_start` | tz timestamp\|null | conditional | ⚠ | **Add** · "Monday 9am PT" coordination windows |
| `capacity_window_end` | tz timestamp\|null | conditional | ⚠ | **Add** · same |
| `deadline` | tz timestamp\|null | — | ⚠ | **Add** · campaign closes at this time |
| `duration_label` | string\|null | — | ✓ | — |

### 2.5 Targeting + eligibility

| Field | Type | Required | Today | Gap |
| --- | --- | --- | --- | --- |
| `target_platforms` | JSON `["tiktok", "instagram", "youtube", "x", "linkedin", "facebook"]` | ✓ | ⚠ | **Add** · today inferred from `mission_type`; needs explicit list |
| `target_geos` | JSON `["US", "UK", "NG", ...]` \| null | — | ⚠ | **Add** · supports geographic gating for coordination campaigns |
| `target_hashtags` | JSON `["#clip", ...]` \| null | — | ⚠ | **Add** |
| `visibility_tiers` | JSON `["free","solo","pro","agency"]` | ✓ | ✓ | — |
| `required_tier` | enum tier\|null | — | ✓ | — |
| `requires_membership` | bool | — | ✓ | — |
| `tier_rules` | JSON | ✓ | ⚠ | **Add** · `{ payouts: {free:..., pro:..., agency:...}, submission_caps: {...}, discussion_access: {...} }` (§ tiered access) |

### 2.6 Discussion attachment

| Field | Type | Required | Today | Gap |
| --- | --- | --- | --- | --- |
| `discussion_provider` | enum `none` \| `whop` \| `native` | ✓ | ⚠ | **Add** · explicit. Today implicit via `community_channel_id` presence (§4) |
| `community_channel_id` | FK community_channels.id | conditional | ✓ | — |
| `native_discussion_id` | FK lc_discussions.id\|null | — | ⚠ future | **Future** · not blocking 6N-B |

### 2.7 Asset sources

| Field | Type | Required | Today | Gap |
| --- | --- | --- | --- | --- |
| `asset_sources` | JSON `AssetSource[]` (§3) | ✓ | ⚠ | **Add (critical)** · polymorphic blob covers Drive / Dropbox / Whop / direct |
| `banner_url` | string\|null | — | ✓ | keep · derivable from asset_sources but kept for fast list reads |
| `featured_thumb_url` | string\|null | — | ⚠ | **Add** · sponsored thumbnail asset path for featured placements |

### 2.8 Whop integration (transitional)

| Field | Type | Required | Today | Gap |
| --- | --- | --- | --- | --- |
| `whop_url` | string | conditional | ✓ | — |
| `whop_campaign_id` | string\|null | — | ✓ | — |
| `whop_campaign_url` | string\|null | — | ✓ | — |
| `affiliate_enabled` | bool | — | ✓ | — |

### 2.9 Fields to **deprecate** (collapse into the new model)

| Field today | Why | Replacement |
| --- | --- | --- |
| `rpm_cents` | Legacy single value | `payout_rules` JSON |
| `base_rpm_cents` + `premium_rpm_cents` + `premium_bonus_cents` | Pre-2-tier matrix | `payout_rules` + `tier_rules` JSON |
| `cta_text` | UI concern, not data | derive in copy layer |
| `eligibility` | Underspecified JSON | replaced by `tier_rules` + `target_*` fields |
| `sort_order` | Ad-hoc sponsorship signal | replaced by `placement_quality` + DB priority sort |
| `type` (`public/coming_soon/...`) | Confused with `status` | merge into `status` + `visibility` |
| `mission_type` / `mission_lane` | Uncle Daniel funnel-specific | move under `tier_rules.metadata` if still needed |

### 2.10 Missing from brief, recommended additions

- **`description` (text)** — listed in the brief but not yet on the table. Required for the Campaign Page body.
- **`created_by`** — agency identity. Today campaigns are admin-created via the dashboard; the agency self-serve flow needs an owner FK.
- **`tier_rules` JSON** — the brief lists "tierRules" but doesn't define its shape. Recommended shape:
  ```json
  {
    "payouts":          { "free": {...rule}, "pro": {...rule}, "agency": {...rule} },
    "submission_caps":  { "free": 1, "pro": 5, "agency": 50 },
    "discussion_access": { "min_tier": "pro" }
  }
  ```
- **`capacity_used`** — derived, but worth materialising for cheap reads.
- **`featured_thumb_url`** — distinct from `banner_url` because the discovery card and the page hero use different aspect ratios.

---

## 3 · Asset source ingestion model

Polymorphic, kind-discriminated. Stored as `asset_sources JSON` on Campaign for 6N-B; promotable to `campaign_asset_sources` table when ingestion needs an audit trail.

### 3.1 Shape

```ts
type AssetSourceKind =
  | "drive_folder"
  | "drive_file"
  | "dropbox_folder"
  | "dropbox_file"
  | "whop_assets"
  | "direct_upload";

interface AssetSource {
  id: string;                        // local · `as_*` prefix
  kind: AssetSourceKind;
  /** Display label for the agency creation flow. */
  label: string;
  /** Canonical URL (for direct downloads OR the folder share URL). */
  url: string;
  /** External provider id when applicable. */
  externalId?: string;               // Drive file_id · Dropbox path · Whop asset_id
  /** OAuth credentials reference (NOT the token itself). Null until provider connected. */
  credentialRef?: string;
  /** Manifest summary populated post-ingestion. */
  manifest?: {
    fileCount: number;
    totalBytes: number;
    sampleNames: string[];           // first few file names for preview
    cachedAt: string;                // ISO timestamp
  };
  /** Lifecycle. */
  status: "pending_link" | "ready" | "stale" | "error";
  error?: string;
  addedAt: string;
}
```

### 3.2 Kind-specific notes

| Kind | URL shape | OAuth needed | Recursion | Notes |
| --- | --- | --- | --- | --- |
| `drive_folder` | `https://drive.google.com/drive/folders/<id>` | ✓ Drive API | recursive listing | Manifest cached every 6h; agency sees file count + sample names without re-fetching every page render |
| `drive_file` | `https://drive.google.com/file/d/<id>` | ✓ Drive API | single file | Direct download path through Drive proxy when clipper opens |
| `dropbox_folder` | `https://www.dropbox.com/sh/<path>` | ✓ Dropbox API | recursive listing | Same caching model |
| `dropbox_file` | `https://www.dropbox.com/s/<id>` | ✓ Dropbox API | single file | — |
| `whop_assets` | `https://whop.com/c/<feed>/assets` | ✓ Whop API (already exists in backend) | recursive | Built on the existing Whop integration |
| `direct_upload` | `/uploads/<campaign_slug>/<file>` | — | — | Hosted on the backend's existing static serve; size-capped per tier |

### 3.3 What this DOES NOT solve in 6N-A

- The agency-side OAuth handshake UX (deferred).
- The clipper-side asset preview UI (deferred).
- The download proxy / cold-storage hand-off (deferred).
- Direct upload rate-limit + chunking (deferred).

All of those land with the Campaign creation flow build (Phase 6N-B) and the asset-source ingestion sprint (Phase 6N-D, not scoped yet).

---

## 4 · Discussion attachment interface

Discussion is **owned by Campaign** — never a top-level object. The interface is deliberately neutral so the same drawer / page primitive can render a Whop mirror today and a native Liquid Clips thread tomorrow.

### 4.1 Schema fields (already partly there)

```
Campaign.discussion_provider       enum "none" | "whop" | "native"   ← ADD
Campaign.community_channel_id      FK community_channels.id          ← exists
Campaign.native_discussion_id      FK lc_discussions.id              ← future
```

### 4.2 Resolution rules (locked vocabulary from clarification)

| `discussion_provider` | Required FK | UI behaviour |
| --- | --- | --- |
| `"none"` | none | Drawer shows "Discussion not provisioned yet · check back soon." (existing `DISCUSSION.coming_body` copy) |
| `"whop"` | `community_channel_id` | Drawer shows "Open Whop mirror" CTA · subtext "External · Whop-hosted. Native discussion lands later." |
| `"native"` | `native_discussion_id` | Drawer shows "Open discussion" CTA → native thread mounts in-app |

### 4.3 Frontend seam already in place

The Phase 6L-B `Discussion` shape (`src/design-os/community/discussion.ts:Discussion`) already exposes:

```ts
interface Discussion {
  id: string;
  whopMirrorUrl: string | null;     // ← populated when provider = "whop"
  whopMirrorId: string | null;
  nativeUrl: null;                  // ← populated when provider = "native"
  // ... rest of the shape
}
```

The `channelToDiscussion()` adapter ports `CommunityRoom → Discussion`. The Campaign adapter (`campaignToDiscussion()`, lands in 6N-B) writes into the same shape:

```ts
function campaignToDiscussion(c: Campaign): Discussion {
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    purpose: c.description,
    kind: "campaign",
    status: campaignDiscussionStatus(c),
    locked: !c.viewerCanAccessDiscussion,
    requiredTier: c.tier_rules?.discussion_access?.min_tier ?? "free",
    section: "paid_core",
    businessUnit: c.business_unit,
    missionLane: null,
    whopMirrorUrl: c.discussion_provider === "whop" ? whopChatUrl(c.community_channel_id) : null,
    whopMirrorId: c.discussion_provider === "whop" ? c.community_channel_id : null,
    nativeUrl: c.discussion_provider === "native" ? `/discussions/${c.native_discussion_id}` : null,
  };
}
```

**No drawer changes required.** The existing `<RoomDetailDrawer>` reads `Discussion` and switches CTA copy based on the populated URL. When `nativeUrl` is set, the drawer routes through `bus.emit("browse:open", { mirror: "native", ... })`; the future native overlay subscribes to that event before the default Whop fallback.

---

## 5 · Payout rule design

`payout_rules` JSON column on Campaign. Polymorphic by `kind`. One rule per Campaign for v1; sibling list for v2 (e.g. base + bonus combined).

### 5.1 Rule shapes

```ts
type PayoutRule =
  | FlatPayoutRule
  | RpmPayoutRule
  | TieredPayoutRule
  | BonusPayoutRule
  | CapacityPayoutRule;

interface FlatPayoutRule {
  kind: "flat";
  /** Per-approved-submission payout in cents. */
  amountCents: number;
  /** Currency · USD for v1. */
  currency: "USD";
}

interface RpmPayoutRule {
  kind: "rpm";
  /** $ per 1000 verified views, in cents. */
  rpmCents: number;
  /** Verified-views floor before any payout (anti-spam). */
  minVerifiedViews: number;
  /** Maximum payout per submission, in cents. Optional. */
  maxPayoutCents?: number;
}

interface TieredPayoutRule {
  kind: "tiered";
  /** Lookup table by viewer tier. Lives ALONGSIDE the campaign tier_rules
   *  for backwards-compat with the existing free/pro/agency RPM matrix. */
  byTier: Record<"free" | "pro" | "agency", FlatPayoutRule | RpmPayoutRule>;
}

interface BonusPayoutRule {
  kind: "bonus";
  /** Base rule applied to every approved submission. */
  base: FlatPayoutRule | RpmPayoutRule;
  /** Bonus rules applied conditionally. */
  bonuses: Array<{
    label: string;                         // "Top-1% retention", "First-100 clipper"
    triggerCondition:                      // narrow set for v1
      | { kind: "first_n_submissions"; n: number }
      | { kind: "top_retention_pct"; pct: number }
      | { kind: "viral_views_above"; views: number };
    extra: FlatPayoutRule | RpmPayoutRule;
  }>;
}

interface CapacityPayoutRule {
  kind: "capacity_limited";
  /** Per-action payout — most coordination campaigns use this. */
  perActionCents: number;
  /** Total payout cap; closes the campaign when reached. */
  capacityTotal: number;
  /** Window inside which the action must complete. */
  windowStartIso: string;
  windowEndIso: string;
}
```

### 5.2 What each rule unlocks

| Rule | Campaign types | Example |
| --- | --- | --- |
| `flat` | Submission, Affiliate | "$50 per approved clip submission" |
| `rpm` | Clip, Affiliate | "$3 per 1,000 verified views" — today's Uncle Daniel default |
| `tiered` | Clip, Submission | "free $1 RPM / pro $3 / agency $5 RPM" — the locked matrix from clarification |
| `bonus` | Clip, Submission | "$3 RPM base + $100 bonus for first 100 clippers" |
| `capacity_limited` | Coordination | "2,000 users upvote Product Hunt Monday 9am PT, $0.50 each" |

### 5.3 Backwards-compat path

`SponsoredCampaign.rpm_cents` / `base_rpm_cents` / `premium_rpm_cents` map cleanly onto a `tiered` rule:

```json
{
  "kind": "tiered",
  "byTier": {
    "free":   { "kind": "rpm", "rpmCents": <base>,    "minVerifiedViews": 0 },
    "pro":    { "kind": "rpm", "rpmCents": <premium>, "minVerifiedViews": 0 },
    "agency": { "kind": "rpm", "rpmCents": <premium>, "minVerifiedViews": 0 }
  }
}
```

Migration is a one-shot SQL script; no production data lost.

### 5.4 What this does NOT cover

- Pay-out scheduling (when the money actually moves). Stays on the existing Whop / Stripe Connect rails.
- Tax-withholding logic. Existing backend.
- Refunds / clawbacks for fraudulent submissions. Existing manual mod review.

---

## 6 · Featured placement design

The clarification names three placements: **featured campaign**, **sponsored campaign**, **category spotlight**. They are **mutually exclusive within a Campaign** and discriminated by `placement_quality`.

### 6.1 Field

```
Campaign.placement_quality  enum "standard" | "featured" | "sponsored" | "category_spotlight"   ← ADD
Campaign.placement_metadata JSON                                                                 ← ADD
```

### 6.2 Per-placement behaviour

| Placement | Where it appears | Visual treatment | Billing |
| --- | --- | --- | --- |
| `standard` | Discovery grid, default sort | Standard card chrome | none |
| `featured` | Discovery grid hero slot (above the standard grid), Community route's existing FeaturedDiscussion slot | Large hero card · "FEATURED" eyebrow · animated outline | Paid by the agency · `placement_metadata.featured_starts_at` / `featured_ends_at` carry the window |
| `sponsored` | Discovery grid + standard slot, but with sponsor badge | Cyan "SPONSORED" pill (reuse `/brand/sponsored/badge-sponsored.png`) · sponsor logo from `placement_metadata.sponsor_brand` | Paid by the sponsor · separate from the agency. Today's `sponsored_campaigns` table name will collapse into this attribute |
| `category_spotlight` | Top of category-filtered discovery (e.g. "Affiliate" tab) | Standard card + "Spotlight" eyebrow | Paid · `placement_metadata.category_key` ("affiliate", "coordination", etc.) |

### 6.3 placement_metadata shape

```ts
interface PlacementMetadata {
  // featured
  featuredStartsAt?: string;
  featuredEndsAt?: string;

  // sponsored
  sponsorBrand?: string;
  sponsorLogoUrl?: string;
  sponsorshipPackage?: "bronze" | "silver" | "gold";

  // category_spotlight
  categoryKey?: "affiliate" | "coordination" | "clip" | "submission";

  // billing reference for any paid placement
  billingRef?: string;
}
```

### 6.4 Backwards-compat

The current `sponsored_campaigns.is_invite_only` + `sort_order` + the table name itself encode an informal "this campaign is special". Migration:

- All current rows default to `placement_quality = "standard"` unless `is_invite_only = true`, in which case they map to `placement_quality = "sponsored"` with `placement_metadata.sponsorshipPackage = "gold"`.
- `sort_order` continues to break ties within a placement tier.

---

## 7 · Campaign types

Four discriminator values · differences locked in below. The discriminator lives in `campaign_type` (§2.2). The brief lists examples for each type; this table makes the schema differences explicit.

### 7.1 Side-by-side

| Field | Clip | Coordination | Affiliate | Submission |
| --- | --- | --- | --- | --- |
| **Use case** | "Cut clips from this footage" | "2,000 users upvote PH Monday 9am" | "Refer signups via tracking link" | "Submit a clip / artifact / vote · we approve" |
| `payout_rules.kind` | `rpm` \| `tiered` | `capacity_limited` | `flat` \| `rpm` (per signup) | `flat` \| `tiered` |
| `capacity_total` | optional (per-clipper cap) | **required** | optional | optional |
| `capacity_window_*` | optional | **required** | optional | optional |
| `asset_sources` | **required** (footage to clip) | optional (briefs / scripts) | optional | optional |
| `target_platforms` | **required** | optional (often web-only) | optional | **required** |
| `target_hashtags` | optional | optional | optional | optional |
| Submission row → backend table | `campaign_submissions` (clip URL) | `campaign_submissions` (action proof URL / screenshot) | `reward_clips` (tracking link minted at signup) | `campaign_submissions` (artifact URL) |
| Discussion provider | usually `whop` → native | usually `none` initially | optional | usually `whop` → native |
| Featured placement default | `standard` | `featured` (high visibility for cordination push) | `standard` | `standard` |

### 7.2 Why the discriminator matters

- **Clip Campaign** without `asset_sources` → invalid (clippers have nothing to clip).
- **Coordination Campaign** without `capacity_window_*` → invalid (the whole point is "everyone act inside this window").
- **Affiliate Campaign** with `asset_sources` is unusual (affiliates promote a checkout link, not raw footage) → soft-warn in the creation flow.
- **Submission Campaign** without `target_platforms` → ambiguous; ask the agency to pick at least one or set `target_platforms = ["any"]` explicitly.

The frontend type adapter (`useCampaigns().validate(c)`) returns errors / warnings keyed off these per-type rules. No code yet.

---

## 8 · Campaign creation flow

Single agency-side flow. One submit → multiple projections materialise.

### 8.1 Step list

1. **Title + description + type**
   - `title`, `description`, `campaign_type` (the 4-way discriminator)
2. **Reward + payout**
   - `reward_type`, `reward_pool_cents`
   - Per-type sub-form for `payout_rules` (flat / rpm / tiered / bonus / capacity_limited)
3. **Capacity + timing**
   - `capacity_total`, `capacity_window_start`, `capacity_window_end`, `deadline`
   - Required fields enforced by `campaign_type`
4. **Targeting**
   - `target_platforms`, `target_geos`, `target_hashtags`
   - `visibility`, `visibility_tiers`, `required_tier`, `tier_rules`
5. **Asset sources**
   - Add one or more `AssetSource` rows (Drive folder / Dropbox file / Whop assets / direct upload)
6. **Discussion**
   - Pick `discussion_provider` (`none` / `whop` — pick a `community_channel_id` / `native` — disabled until the native discussion entity exists)
7. **Featured / sponsored?** *(optional)*
   - `placement_quality` + `placement_metadata`
   - Billed separately · stub the billing in 6N-B, wire in 6N-C
8. **Review + publish**
   - Auto-derive: discovery card preview, campaign page preview, banner (from `featured_thumb_url` if set, else first asset source's preview, else from the brand library default)
   - Diff against any required-but-missing fields → block publish

### 8.2 What lands at submit

```
                   ┌─────────────────────────────┐
                   │   POST /agency/campaigns    │
                   └──────────────┬──────────────┘
                                  │
                  ┌───────────────┼───────────────┐
                  ▼               ▼               ▼
        ┌───────────────┐ ┌──────────────┐ ┌─────────────────┐
        │  Campaign row │ │ AssetSource  │ │ Discussion link │
        │  inserted     │ │ rows queued  │ │ resolved        │
        └───────┬───────┘ │ for ingest   │ └────────┬────────┘
                │         └──────┬───────┘          │
                │                │                  │
                └────────────────┼──────────────────┘
                                 │
                                 ▼
            All derived views become immediately available:
                                 │
   ┌────────┬────────┬───────────┴───────────┬───────────┬────────┐
   ▼        ▼        ▼                       ▼           ▼        ▼
 Disco-  Campaign  Reward                Discussion   Submission Featured
 very    Page      Banner                 Mirror       Target     Slot
 Card    (URL)     (placement image       (URL)        (FK on    (if paid)
         /campaigns/<slug>)              /c/<feed>     submis-
                                         OR /disc/<n>   sions)
```

### 8.3 Architectural guarantees

- **No separate Reward / Banner / Page tables.** All projections derive from Campaign + lookups.
- **Slug is the URL identity** for every projection (`/campaigns/<slug>` is the page; the discovery card and banner both link to it).
- **Agency edits one row** in the dashboard and the projections update everywhere.
- **Submissions FK back to Campaign.id** (already true in `campaign_submissions`).
- **Existing `community_channels` rows stay intact** — Campaign just declares which one it uses for the Whop mirror via `community_channel_id`. The room → campaign attachment is from the campaign side, not the room side.

---

## 9 · Future integration points

Phases that hook into this foundation without re-shaping it:

| Phase | What it adds | Where it slots in |
| --- | --- | --- |
| 6N-B | `useCampaigns()` hook · CampaignsRoute foundation · Campaign list + page · Reuse `<RoomDetailDrawer>` as `<CampaignDiscussionDrawer>` via `campaignToDiscussion` adapter | `Campaign → Discussion` seam (§4) |
| 6N-C | Agency-side creation flow UI · multi-step form · asset-source picker | `POST /agency/campaigns` |
| 6N-D | Asset source ingestion sprint · Drive / Dropbox OAuth · manifest caching | `AssetSource.manifest` (§3) |
| 6N-E | Featured / sponsored billing wire-up · Stripe Connect on the sponsor side · sponsorship packages | `placement_quality` + `placement_metadata.billingRef` (§6) |
| 6N-F | Native Liquid Clips discussion entity · `lc_discussions` table · new `<NativeDiscussionDrawer>` subscriber on `browse:open` event | `discussion_provider = "native"` branch (§4) |
| 6N-G | Coordination campaign execution · capacity meter live updates · window enforcement | `CapacityPayoutRule` (§5) + `capacity_used` field (§2.4) |
| 7+ | Refunds / clawbacks / payout disputes | `payout_rules` + audit trail (not in 6N scope) |

---

## 10 · Migration path summary

**Schema work (Phase 6N-A → 6N-B):**

1. Rename `sponsored_campaigns` → `campaigns` (or keep table name + create `Campaign` SQLAlchemy class with a `__tablename__ = "sponsored_campaigns"` for zero-downtime).
2. Add columns from §2 marked **Add**: `description`, `created_by`, `campaign_type`, `placement_quality`, `placement_metadata`, `reward_type`, `payout_rules`, `tier_rules`, `capacity_total`, `capacity_used`, `capacity_window_start`, `capacity_window_end`, `deadline`, `target_platforms`, `target_geos`, `target_hashtags`, `asset_sources`, `featured_thumb_url`, `discussion_provider`, `native_discussion_id`.
3. Backfill `placement_quality` from `is_invite_only`.
4. Backfill `payout_rules` from the existing RPM scalars.
5. Backfill `discussion_provider`: rows with `community_channel_id IS NOT NULL` → `"whop"`, else `"none"`.
6. **Drop nothing yet.** Old columns stay for one release as fallback reads.

**Frontend work (Phase 6N-B):**

- Replace `fakeCampaigns.ts` with `useCampaigns()` real-RPC → HTTP → mock fallback (mirror `useCommunity` + `useRewardClips`).
- Build `campaignToDiscussion()` adapter — slot into existing `<RoomDetailDrawer>`.
- Build `campaignToBanner()` projection for the discovery card.
- Build the `<CampaignsRoute>` shell with world `mission-pedestal` (already declared in `routeRegistry.ts`).
- Wire `RewardClip.campaignId` → real Campaign lookup so the Earn drawer's "Campaign" line populates a link instead of a slug string.

**Asset work (Phase 6M-B):**

Only 3 generations needed (per the 6M-A audit):
1. Submission-campaign type icon
2. Coordination-campaign type icon
3. Agency creation flow step headers (×5-7)

---

## Closing notes

- The directive "**Campaign is the single source of truth**" is achievable without rebuilding what's already in production. The existing `sponsored_campaigns` table is renamed in spirit + extended with discriminator + JSON columns; no data is lost; no API breaks if the existing `GET /campaigns` route keeps shape parity for one release.
- The **biggest risk** is letting "Sponsored" leak back into the codebase as a parallel concept once Campaign-the-canonical lands. The migration deliberately keeps the table name but renames the class. Anyone who still types `SponsoredCampaign` will see a deprecation lint after Phase 6N-B ships.
- The **biggest schema decision** still open is whether `payout_rules` and `asset_sources` are JSON columns on Campaign or sibling tables. **Recommend JSON columns for v1** — fast to ship, cheap to evolve, audit log can come later if needed. Sibling tables become necessary only if the payout / asset rows need their own lifecycle (history, versioning, FK from elsewhere).
- The **biggest UX decision** is the agency creation flow's branching by `campaign_type`. The 4 types differ enough on required fields that a single linear form is wrong; recommend a small forking after step 1.
- No backend changes were made by this report. No fixtures were edited. No assets were generated. No code was committed. This phase is design-only.
