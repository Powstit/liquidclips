/**
 * Campaign types · Phase 6N-B
 *
 * TypeScript port of the canonical Campaign model defined in
 * `docs/campaign-foundation-architecture.md` (Phase 6N-A). Single source
 * of truth for every consumer:
 *   - useCampaigns()           · data layer
 *   - CampaignCard             · discovery grid
 *   - CampaignBanner           · featured hero
 *   - CampaignPageShell        · detail surface
 *   - campaignToDiscussion()   · adapter into the generic Discussion shape
 *   - RewardClip.campaignId    · Earn route → campaign lookup
 *
 * Architectural guarantees (from 6N-A):
 *   - Campaign IS the single source of truth.
 *   - Banner / Page / DiscoveryCard / FeaturedSlot are projections, not
 *     sibling entities.
 *   - PayoutRule + AssetSource are polymorphic, discriminated by `kind`.
 *   - DiscussionProvider is explicit (`none` | `whop` | `native`).
 */

import type { Platform } from "../engine/types";

/* ============================================================
   Discriminators
   ============================================================ */

export type CampaignType =
  | "clip"
  | "coordination"
  | "affiliate"
  | "submission";

export type CampaignStatus =
  | "draft"
  | "coming_soon"
  | "partially_funded"
  | "funded"
  | "live"
  | "closed";

export type CampaignVisibility = "public" | "invite_only" | "members_only";

export type PlacementQuality =
  | "standard"
  | "featured"
  | "sponsored"
  | "category_spotlight";

export type DiscussionProvider = "none" | "whop" | "native";

export type RewardKind = "usd" | "points" | "mixed";

/* ============================================================
   Polymorphic rules
   ============================================================ */

export interface FlatPayoutRule {
  kind: "flat";
  amountCents: number;
  currency: "USD";
}

export interface RpmPayoutRule {
  kind: "rpm";
  rpmCents: number;
  minVerifiedViews: number;
  maxPayoutCents?: number;
}

export interface TieredPayoutRule {
  kind: "tiered";
  byTier: {
    free:   FlatPayoutRule | RpmPayoutRule;
    pro:    FlatPayoutRule | RpmPayoutRule;
    agency: FlatPayoutRule | RpmPayoutRule;
  };
}

export interface BonusPayoutRule {
  kind: "bonus";
  base: FlatPayoutRule | RpmPayoutRule;
  bonuses: Array<{
    label: string;
    triggerCondition:
      | { kind: "first_n_submissions"; n: number }
      | { kind: "top_retention_pct"; pct: number }
      | { kind: "viral_views_above"; views: number };
    extra: FlatPayoutRule | RpmPayoutRule;
  }>;
}

export interface CapacityPayoutRule {
  kind: "capacity_limited";
  perActionCents: number;
  capacityTotal: number;
  windowStartIso: string;
  windowEndIso: string;
}

export type PayoutRule =
  | FlatPayoutRule
  | RpmPayoutRule
  | TieredPayoutRule
  | BonusPayoutRule
  | CapacityPayoutRule;

/* ============================================================
   Asset sources (read-only surfacing in 6N-B)
   ============================================================ */

export type AssetSourceKind =
  | "drive_folder"
  | "drive_file"
  | "dropbox_folder"
  | "dropbox_file"
  | "whop_assets"
  | "direct_upload";

export interface AssetSourceManifest {
  fileCount: number;
  totalBytes: number;
  sampleNames: string[];
  cachedAt: string;
}

export interface AssetSource {
  id: string;
  kind: AssetSourceKind;
  label: string;
  url: string;
  externalId?: string;
  credentialRef?: string;
  manifest?: AssetSourceManifest;
  status: "pending_link" | "ready" | "stale" | "error";
  error?: string;
  addedAt: string;
}

/* ============================================================
   Tier rules (visibility + per-tier payout + submission caps)
   ============================================================ */

export interface TierRules {
  /** Per-tier payout overrides · referenced when payout_rules.kind === "tiered". */
  payouts?: Partial<{
    free:   FlatPayoutRule | RpmPayoutRule;
    pro:    FlatPayoutRule | RpmPayoutRule;
    agency: FlatPayoutRule | RpmPayoutRule;
  }>;
  /** How many submissions per tier per campaign window. */
  submissionCaps?: Partial<{ free: number; pro: number; agency: number }>;
  /** Discussion access gate · separate from campaign-level visibility. */
  discussionAccess?: { minTier: "free" | "pro" | "agency" };
}

/* ============================================================
   Placement metadata
   ============================================================ */

export interface PlacementMetadata {
  featuredStartsAt?: string;
  featuredEndsAt?: string;
  sponsorBrand?: string;
  sponsorLogoUrl?: string;
  sponsorshipPackage?: "bronze" | "silver" | "gold";
  categoryKey?: CampaignType;
  billingRef?: string;
}

/* ============================================================
   Canonical Campaign shape · 6N-A schema, in TypeScript
   ============================================================ */

export interface Campaign {
  /* Identity */
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string;
  brand: string | null;
  businessUnit: string | null;
  createdBy: string;            // FK users.id
  createdAt: string;
  updatedAt: string;

  /* Type + status */
  campaignType: CampaignType;
  status: CampaignStatus;
  visibility: CampaignVisibility;
  placementQuality: PlacementQuality;
  placementMetadata?: PlacementMetadata;

  /* Reward + payout */
  rewardKind: RewardKind;
  rewardPoolCents: number;
  payoutRules: PayoutRule;
  fundedPct: number;
  minLcScore: number;

  /* Capacity + timing */
  capacityTotal: number | null;
  capacityUsed: number;
  capacityWindowStart: string | null;
  capacityWindowEnd: string | null;
  deadline: string | null;
  durationLabel: string | null;

  /* Targeting */
  targetPlatforms: Platform[];
  targetGeos: string[] | null;
  targetHashtags: string[] | null;
  visibilityTiers: Array<"free" | "solo" | "pro" | "agency">;
  requiredTier: "free" | "solo" | "pro" | "agency" | null;
  requiresMembership: boolean;
  tierRules: TierRules;

  /* Discussion */
  discussionProvider: DiscussionProvider;
  communityChannelId: string | null;
  nativeDiscussionId: string | null;

  /* Asset sources (read-only surfacing) */
  assetSources: AssetSource[];

  /* Banner + featured thumbnail (derived but cached for cheap reads) */
  bannerUrl: string | null;
  featuredThumbUrl: string | null;

  /* Whop integration (transitional) */
  whopUrl: string | null;
  whopCampaignId: string | null;
  whopCampaignUrl: string | null;
  affiliateEnabled: boolean;

  /* ── 6N-G · §8 URL-first reward reads ──────────────────────────
   * Optional · agency-created campaigns carry these; legacy rows do
   * not. UI surfaces fall back to `payoutRules` / `rewardPoolCents`
   * when the snapshot is absent. Whop is the source of truth · these
   * mirror visible Whop fields, never claim ownership of them. */
  whopRewardId?: string | null;
  whopRewardUrl?: string | null;
  whopRewardState?: WhopRewardStateLite | null;
  whopRewardSnapshotStatus?: WhopRewardSnapshotStatusLite;
  whopRewardSnapshot?: WhopRewardSnapshotLite | null;
  whopRewardSnapshotBusinessGoal?: string | null;
  whopRewardSnapshotBountyType?: string | null;
  whopRewardSyncedAt?: string | null;
  whopRewardLastError?: string | null;

  /* Ship-lens P0-CW-006 fix (2026-07-06) · sponsor guardrail. When
   * `false` the sponsor explicitly forbids agency rebranding on top of
   * their content · the PublishModule composite step must skip even if
   * `watermarkOverlayConfig` is set. Default `true` for legacy rows. */
  watermarkAllowed: boolean;

  /* 2026-07-05 · per-campaign agency watermark overlay. Snake_case
   * JSON on the wire · null when the campaign uses the default Liquid
   * Clips watermark. Frontend export path reads this to decide whether
   * to invoke campaignOverlayApi.render + composite. */
  watermarkOverlayConfig?: {
    logo_url: string;
    position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center-top" | "center-bottom";
    motion: "static" | "corner-pulse" | "fade-in-out" | "slide-in-left" | "lower-third";
    text: string | null;
    duration_frames: number;
    version: number;
  } | null;
}

/* Mirrors the agency-creation surface types from `engine/sidecar-stub`
 * but re-declared here so consumers don't need to import across module
 * boundaries · the campaigns/* tree is self-contained. */
export type WhopRewardStateLite =
  | "unlinked" | "pending_reward" | "connected" | "live" | "funded"
  | "partially_funded" | "capacity_reached" | "closed"
  | "unreachable" | "not_visible" | "stale";

export type WhopRewardSnapshotStatusLite =
  | "not_attempted" | "enriched" | "not_enriched" | "unreachable";

export interface WhopRewardSnapshotLite {
  id?: string;
  title?: string;
  description?: string;
  baseUnitAmount?: number;
  rewardPerUnitAmount?: number;
  budgetAmount?: number;
  totalPaid?: number;
  currency?: string;
  status?: string;
  bountyType?: string;
  businessGoalType?: string;
  acceptedSubmissionsLimit?: number;
  acceptedSubmissionsCount?: number;
  spotsRemaining?: number;
  viewCount?: number;
  thumbnail?: string | null;
  allowYoutube?: boolean;
  allowTiktok?: boolean;
  allowInstagram?: boolean;
  allowX?: boolean;
  [key: string]: unknown;
}

/* ============================================================
   Display copy maps
   ============================================================ */

export const CAMPAIGN_TYPE_LABEL: Record<CampaignType, string> = {
  clip:         "Clip Campaign",
  coordination: "Coordination Campaign",
  affiliate:    "Affiliate Campaign",
  submission:   "Submission Campaign",
};

export const CAMPAIGN_TYPE_BLURB: Record<CampaignType, string> = {
  clip:         "Cut clips from the agency's footage. Earn per verified view.",
  coordination: "A coordinated action inside a time window. Limited capacity.",
  affiliate:    "Promote with your tracking link. Earn per signup or per view.",
  submission:   "Submit an artifact for approval. Flat reward per approved entry.",
};

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft:             "Draft",
  coming_soon:       "Coming soon",
  partially_funded:  "Funding",
  funded:            "Fully funded",
  live:              "Live",
  closed:            "Closed",
};

export const PLACEMENT_LABEL: Record<PlacementQuality, string> = {
  standard:           "Standard",
  featured:           "Featured",
  sponsored:          "Sponsored",
  category_spotlight: "Spotlight",
};

export const ASSET_SOURCE_LABEL: Record<AssetSourceKind, string> = {
  drive_folder:   "Google Drive folder",
  drive_file:     "Google Drive file",
  dropbox_folder: "Dropbox folder",
  dropbox_file:   "Dropbox file",
  whop_assets:    "Whop assets",
  direct_upload:  "Direct upload",
};

/* ============================================================
   Filters
   ============================================================ */

export type CampaignFilterKey = "all" | CampaignType | "featured" | "live";

export const CAMPAIGN_FILTER_ORDER: CampaignFilterKey[] = [
  "all", "featured", "live", "clip", "coordination", "affiliate", "submission",
];

export const CAMPAIGN_FILTER_LABEL: Record<CampaignFilterKey, string> = {
  all:          "All",
  featured:     "Featured",
  live:         "Live",
  clip:         "Clip",
  coordination: "Coordination",
  affiliate:    "Affiliate",
  submission:   "Submission",
};

/* ============================================================
   Helpers
   ============================================================ */

/** Format a USD-cents value as a short display string. */
export function fmtUsdCents(cents: number): string {
  const n = cents / 100;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

/** Compress a PayoutRule into one human line for cards/banners. */
export function payoutSummary(rule: PayoutRule): string {
  switch (rule.kind) {
    case "flat":             return `${fmtUsdCents(rule.amountCents)} flat`;
    case "rpm":              return `${fmtUsdCents(rule.rpmCents)} / 1k views`;
    case "tiered":           {
      const free = rule.byTier.free;
      const agency = rule.byTier.agency;
      const lo = free.kind === "flat" ? fmtUsdCents(free.amountCents) : `${fmtUsdCents(free.rpmCents)} RPM`;
      const hi = agency.kind === "flat" ? fmtUsdCents(agency.amountCents) : `${fmtUsdCents(agency.rpmCents)} RPM`;
      return `${lo} → ${hi}`;
    }
    case "bonus":            return rule.base.kind === "flat"
      ? `${fmtUsdCents(rule.base.amountCents)} + bonuses`
      : `${fmtUsdCents(rule.base.rpmCents)} RPM + bonuses`;
    case "capacity_limited": return `${fmtUsdCents(rule.perActionCents)} × ${rule.capacityTotal.toLocaleString()} actions`;
  }
}

/** Apply a campaign-list filter. */
export function applyCampaignFilter(
  campaigns: ReadonlyArray<Campaign>,
  filter: CampaignFilterKey,
): Campaign[] {
  switch (filter) {
    case "all":      return [...campaigns];
    case "featured": return campaigns.filter((c) => c.placementQuality === "featured" || c.placementQuality === "sponsored");
    case "live":     return campaigns.filter((c) => c.status === "live");
    default:         return campaigns.filter((c) => c.campaignType === filter);
  }
}

/* ── 6N-G · Whop-snapshot-derived display helpers ─────────────────── */

/** Whether the campaign carries a usable Whop reward snapshot. */
export function hasWhopSnapshot(c: Campaign): boolean {
  return !!(c.whopRewardSnapshot && c.whopRewardSnapshotStatus === "enriched");
}

/** Reward-pool USD cents from snapshot when present, else legacy mock. */
export function rewardPoolCents(c: Campaign): number {
  const snap = c.whopRewardSnapshot;
  if (snap?.budgetAmount && typeof snap.budgetAmount === "number") {
    return Math.round(snap.budgetAmount * 100);
  }
  return c.rewardPoolCents;
}

/** Funded percentage from snapshot when present, else legacy mock. */
export function fundedPct(c: Campaign): number {
  const snap = c.whopRewardSnapshot;
  if (snap?.budgetAmount && snap.totalPaid !== undefined && snap.budgetAmount > 0) {
    return Math.min(100, Math.round((snap.totalPaid / snap.budgetAmount) * 100));
  }
  return c.fundedPct;
}

/** Payout line · snapshot first, then legacy `payoutRules`.
 *  P0-3 fix · require `> 0` on snapshot numbers. The previous
 *  `!== undefined && typeof === "number"` guard accepted `0` and
 *  rendered "$0.00 per submission" instead of falling through to
 *  rewardPerUnitAmount / RPM / legacy payoutRules. Whop snapshots can
 *  carry a `0` baseUnitAmount on RPM-style rewards where only
 *  rewardPerUnitAmount is meaningful · the zero must fall through. */
export function payoutLine(c: Campaign): string {
  const snap = c.whopRewardSnapshot;
  if (typeof snap?.baseUnitAmount === "number" && snap.baseUnitAmount > 0) {
    const cents = Math.round(snap.baseUnitAmount * 100);
    return `${fmtUsdCents(cents)} per submission`;
  }
  if (typeof snap?.rewardPerUnitAmount === "number" && snap.rewardPerUnitAmount > 0) {
    const cents = Math.round(snap.rewardPerUnitAmount * 100);
    return `${fmtUsdCents(cents)} per 1k views`;
  }
  return payoutSummary(c.payoutRules);
}

/** "via Whop snapshot" qualifier · null when no snapshot is present so
 *  the UI can omit the suffix for legacy rows. */
export function snapshotQualifier(c: Campaign): string | null {
  if (hasWhopSnapshot(c)) return "via Whop snapshot";
  return null;
}
