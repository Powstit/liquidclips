/**
 * Community types · Phase 6L-A
 *
 * Ported from the legacy desktop `CommunityTab.tsx` Channel type (which
 * mirrors the backend `community_channels` table). The simulator's
 * `fakeCommunity` fixture in `src/fixtures/` uses a different shape
 * (`{ tier, unread, href }`) — DO NOT mix the two. This module is the
 * single source of truth for the real CommunityChannel shape.
 */

export type RoomTier = "free" | "free_paid" | "paid" | "paid_admin";

export type RoomSection = "announcements" | "free_lobby" | "paid_core" | "mission";

/** Lifecycle of a room from the user's POV. Derived from the backend
 *  CommunityChannel + caller tier, not stored on the row. */
export type RoomStatus =
  | "open"     // unlocked + whop_channel_id set → tap launches chat
  | "coming"   // unlocked + whop_channel_id null → chat not provisioned yet
  | "locked"   // caller's tier is below required_tier · preview only
  | "admin";   // is_admin_only AND caller isn't admin · read-only preview

/** Wire shape mirroring `community_channels` (backend models.py). */
export interface CommunityChannel {
  id: string;
  slug: string;
  name: string;
  purpose: string | null;
  whop_channel_id: string | null;
  required_tier: RoomTier | string;
  business_unit: string | null;
  mission_lane: string | null;
  is_admin_only: boolean;
  is_locked_preview_enabled: boolean;
  section: RoomSection | string;
  sort_order: number;
}

/** Caller-tier-resolved view of a CommunityChannel. Includes lockedness,
 *  derived status, and the Whop chat URL (or null if not provisioned). */
export interface CommunityRoom {
  channel: CommunityChannel;
  status: RoomStatus;
  locked: boolean;
  /** Resolved Whop chat URL · `https://whop.com/c/<whop_channel_id>` · or
   *  null when no whop_channel_id is bound. */
  whopUrl: string | null;
}

/** Backend leaderboard row (top-100 affiliate earners). Surfaced in the
 *  Phase 6L-A preview rail only — the full Leaderboard route lands later. */
export interface LeaderboardPreviewRow {
  rank: number;
  displayHandle: string;
  lifetimeEarningsUsd: number;
  paidReferrals: number;
  isCaller: boolean;
}

/** Mirrors `announcements` table (when a public GET endpoint lands). For
 *  Phase 6L-A this is empty / loaded-on-demand — the audit could not
 *  confirm a public route, so the rail renders a safe empty state. */
export interface AnnouncementItem {
  id: string;
  kind: "mission_drop" | "payout" | "rule_change" | "deadline" | "other";
  title: string;
  body: string | null;
  publishedAt: string;
}

/** Mirrors backend `banners` table (admin-managed v0.7.55+). Phase 6L-C
 *  consumes the `community_top` placement on the Community route only.
 *  Per the Phase 6M-A audit: reuse existing banner infrastructure ·
 *  do not redesign the banner system. */
export type BannerPlacement =
  | "earn_hero"
  | "mission_card"
  | "mission_detail"
  | "upgrade_modal"
  | "community_top"
  | "home_hero"
  | "checkout_modal";

export interface BannerItem {
  id: string;
  title: string;
  subtitle: string | null;
  /** Path or full URL · null when the banner is text-only. */
  imageUrl: string | null;
  ctaText: string | null;
  ctaUrl: string | null;
  placement: BannerPlacement;
  /** Optional gate · "free" / "paid" · null = visible to all. */
  targetTier: "free" | "paid" | null;
  /** Higher = priority; sort desc when multiple banners share a placement. */
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
}

/* ============================================================
   Tier resolution rules (ported verbatim from legacy CommunityTab)
   ============================================================ */

/** Tier strings that count as "premium" (everything except free / unknown).
 *  Legacy set; kept identical so the new Design OS surface gates the same
 *  way the legacy desktop does. */
export const PREMIUM_TIERS: ReadonlySet<string> = new Set([
  "solo", "pro", "agency", "growth", "channel", "autopilot",
]);

export function isPremiumTier(tier: string | null | undefined): boolean {
  if (!tier) return false;
  return PREMIUM_TIERS.has(tier);
}

/** Whop chat URL builder. The backend field is `whop_channel_id`
 *  (`chat_feed_*`), NOT the room's internal UUID. */
export function whopChatUrl(whopChannelId: string): string {
  return `https://whop.com/c/${whopChannelId}`;
}

/** Resolve a CommunityChannel + caller tier into a CommunityRoom view.
 *  Mirrors the legacy lockedness derivation:
 *    locked = !isPremium && (required_tier === "paid" || "paid_admin")
 *  Hidden-from-locked rows (is_locked_preview_enabled === false) are
 *  filtered out by the caller, not here. */
export function resolveRoom(
  channel: CommunityChannel,
  callerTier: string | null | undefined,
  callerIsAdmin: boolean = false,
): CommunityRoom {
  const isPremium = isPremiumTier(callerTier);
  const locked =
    !isPremium &&
    (channel.required_tier === "paid" || channel.required_tier === "paid_admin");

  let status: RoomStatus;
  if (locked) status = "locked";
  else if (channel.is_admin_only && !callerIsAdmin) status = "admin";
  else if (!channel.whop_channel_id) status = "coming";
  else status = "open";

  const whopUrl = channel.whop_channel_id ? whopChatUrl(channel.whop_channel_id) : null;
  return { channel, status, locked, whopUrl };
}

export const SECTION_META: Record<RoomSection, { label: string; sub: string }> = {
  announcements: { label: "Announcements", sub: "Admin-only posts · everyone reads." },
  free_lobby:    { label: "Free Clipper Lobby", sub: "Onboarding · open to everyone signed in." },
  paid_core:     { label: "Premium Rooms", sub: "Paid clippers only · campaign HQ + affiliate growth." },
  mission:       { label: "Mission Rooms", sub: "Brand + sponsor lanes · paid clippers." },
};

export const SECTION_ORDER: RoomSection[] = ["announcements", "free_lobby", "paid_core", "mission"];
