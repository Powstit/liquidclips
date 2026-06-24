/**
 * Earn types · Phase 6L-D
 *
 * Mirror backend `/me/reward-clips` schema verbatim (verified against
 * `junior-backend/app/routes/reward_clips.py:RewardClipBlock` +
 * `TrackingLinkBlock`). Single source of truth for the Earn route +
 * RewardClipDrawer + future Campaign-submission consumers.
 *
 * Vocabulary lock from clarification:
 *   Campaign → Submission → Approval → Reward → Payout
 *
 * "RewardClip" stays the wire name because that's what the backend table
 * is called. UI labels everywhere use "submission" (the future Campaign
 * vocabulary). Two views of one row.
 */

/** Per-submission lifecycle. Mirrors backend `RewardClip.status` constraint
 *  (draft \| generated \| submitted \| approved \| denied). UI also surfaces
 *  a synthetic `paid` state when a tracking link has reported clicks AND
 *  payout has cleared · derived, not stored. */
export type RewardClipStatus =
  | "draft"
  | "generated"
  | "submitted"
  | "approved"
  | "denied"
  | "paid";

/** Wire shape · matches backend `TrackingLinkBlock`. */
export interface TrackingLinkBlock {
  id: string;
  shortUrl: string;
  destinationUrl: string;
  affiliateId: string | null;
  platform: string | null;
  accountLabel: string | null;
  campaignId: string | null;
  label: string | null;
  disabled: boolean;
  clickCount: number;
}

/** Wire shape · matches backend `RewardClipBlock`. */
export interface RewardClip {
  id: string;
  whopRewardId: string;
  whopRewardTitle: string | null;
  clipIdx: number;
  platform: string | null;
  accountLabel: string | null;
  campaignId: string | null;
  whopSubmissionId: string | null;
  status: RewardClipStatus | null;
  trackingLink: TrackingLinkBlock | null;
  createdAt: string;
  updatedAt: string;
}

/** RPM tier · matches clarification (free $1 / pro $3 / agency $5) with
 *  display labels. Real wiring lives in `useTierCaps()`. */
export interface RpmTier {
  tier: "free" | "pro" | "agency";
  /** USD per 1k views. Future Campaigns may override per-campaign. */
  rpmUsd: number;
  /** Display label for the strip. */
  label: string;
}

export const RPM_TIERS: Record<"free" | "pro" | "agency", RpmTier> = {
  free:   { tier: "free",   rpmUsd: 1, label: "Free · $1 RPM" },
  pro:    { tier: "pro",    rpmUsd: 3, label: "Pro · $3 RPM"  },
  agency: { tier: "agency", rpmUsd: 5, label: "Agency · $5 RPM" },
};

/** Aggregate earn-view summary. Derived from RewardClip[] + tracking-link
 *  click counts. Real wiring lands later — today the sidecar mock seeds
 *  realistic numbers that line up with the row totals. */
export interface EarnSummary {
  /** Lifetime earnings in USD · matches `users.cached_lifetime_earnings_usd`
   *  when real backend ships. Today derived from mock rows. */
  totalEarnedUsd: number;
  /** Earnings pending payout (approved · not yet cleared). */
  pendingPayoutsUsd: number;
  /** Count of clips in `approved` status. */
  approvedCount: number;
  /** Count of clips in `denied` status. */
  rejectedCount: number;
  /** Count of clips in `submitted` (review-pending) status. */
  pendingCount: number;
  /** Count of clips in `paid` synthetic status. */
  paidCount: number;
  /** Caller's current RPM tier. */
  rpm: RpmTier;
  /** Total clicks across all tracking links. */
  totalClicks: number;
  /** Last successful sync · drives the "updated 4m ago" footer pill. */
  updatedAt: string;
}

/** Filter chips above the reward-clip list. */
export type EarnFilterKey = "all" | "pending" | "approved" | "rejected" | "paid" | "draft";

export const EARN_FILTER_ORDER: EarnFilterKey[] = [
  "all", "pending", "approved", "paid", "rejected", "draft",
];

export const EARN_FILTER_LABEL: Record<EarnFilterKey, string> = {
  all:      "All",
  pending:  "Pending",
  approved: "Approved",
  paid:     "Paid",
  rejected: "Rejected",
  draft:    "Draft",
};

/** Map a row's `status` (nullable) to a filter bucket. `submitted` rows
 *  surface under "pending" because that's how the user mentally tracks
 *  them. `null` / `generated` / unknown → "draft". */
export function statusToFilter(status: RewardClipStatus | null): EarnFilterKey {
  if (!status) return "draft";
  if (status === "submitted") return "pending";
  if (status === "approved")  return "approved";
  if (status === "denied")    return "rejected";
  if (status === "paid")      return "paid";
  return "draft"; // generated · draft · unknown
}
