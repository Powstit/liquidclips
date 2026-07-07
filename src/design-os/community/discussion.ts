/**
 * Discussion adapter · Phase 6L-B
 *
 * Single seam that adapts a transitional CommunityRoom into a generic
 * Discussion shape. When Phase 6M lands the Campaign entity, a sibling
 * `campaignToDiscussion()` adapter will write into the same shape so
 * `<RoomDetailDrawer>` (and any other discussion-aware surface) does NOT
 * need a prop migration.
 *
 * Vocabulary lock:
 *   - "Discussion" is the consumer-facing word.
 *   - "Whop mirror" is the temporary external chat path · always optional.
 *   - "Native" is the future Liquid Clips discussion (not built yet).
 */

import type { CommunityRoom, RoomStatus, RoomSection } from "./types";

/** Where this discussion came from. Lets surfaces decide whether to
 *  surface campaign metadata vs announcement metadata, etc. */
export type DiscussionKind = "campaign" | "announcement" | "support" | "other";

/** Generic discussion shape · the contract `<RoomDetailDrawer>` reads. */
export interface Discussion {
  /** Stable id — channel id for rooms today; campaign id later. */
  id: string;
  /** URL-safe slug · stable across rename. */
  slug: string;
  /** Display title. */
  title: string;
  /** One-line purpose · null if not provided. */
  purpose: string | null;
  /** What kind of discussion this is · drives section copy + future routing. */
  kind: DiscussionKind;
  /** Lifecycle from the caller's POV. */
  status: RoomStatus;
  /** True when the caller can't access yet · drives Upgrade CTA. */
  locked: boolean;
  /** Required tier slug (e.g. "paid", "free_paid"). */
  requiredTier: string;
  /** Section bucket · keeps the 4-up grouping until Campaigns rewrites it. */
  section: RoomSection | string;
  /** Optional org / vertical label (legacy: business_unit). */
  businessUnit: string | null;
  /** Optional lane label (legacy: mission_lane). */
  missionLane: string | null;
  /** Whop chat URL · null when no mirror exists yet. */
  whopMirrorUrl: string | null;
  /** Stable Whop channel id (chat_feed_*) for logs / future linking. */
  whopMirrorId: string | null;
  /** Native Liquid Clips discussion URL · always null today. */
  nativeUrl: null;
  /** Marketing perks list · used by the drawer when present. */
  perks?: ReadonlyArray<string>;
}

/** Map a CommunityRoom's section onto the future DiscussionKind. */
function sectionToKind(section: RoomSection | string): DiscussionKind {
  switch (section) {
    case "announcements": return "announcement";
    case "free_lobby":    return "support";
    case "paid_core":     return "campaign";
    case "mission":       return "campaign";
    default:              return "other";
  }
}

/** Adapter · transitional bridge from CommunityRoom → Discussion.
 *  When Campaigns lands, the call site swaps to `campaignToDiscussion(c)`
 *  and the drawer's API stays put. */
export function channelToDiscussion(room: CommunityRoom): Discussion {
  const { channel, status, locked, whopUrl } = room;
  return {
    id: channel.id,
    slug: channel.slug,
    title: channel.name,
    purpose: channel.purpose,
    kind: sectionToKind(channel.section),
    status,
    locked,
    requiredTier: channel.required_tier,
    section: channel.section,
    businessUnit: channel.business_unit,
    missionLane: channel.mission_lane,
    whopMirrorUrl: whopUrl,
    whopMirrorId: channel.whop_channel_id,
    nativeUrl: null,
  };
}

/* ============================================================
   Mark-as-visited · localStorage only · Phase 6L-B
   No backend write today. Survives session, lost on local-storage
   clear. Key namespaced so a future server-side replacement can
   migrate the existing set.
   ============================================================ */

const VISITED_KEY = "lc.community.visited.v1";

export function loadVisitedSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(VISITED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((s) => typeof s === "string"));
  } catch { return new Set(); }
}

export function saveVisitedSet(s: Set<string>): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(VISITED_KEY, JSON.stringify([...s])); }
  catch { /* quota / private mode · degrade */ }
}
