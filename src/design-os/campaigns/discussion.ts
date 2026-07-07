/**
 * campaignToDiscussion adapter · Phase 6N-B
 *
 * The matched sibling to `channelToDiscussion` (Phase 6L-B). Both write
 * into the SAME `Discussion` shape so `<RoomDetailDrawer>` reads either
 * without prop migration.
 *
 * Resolution rules (locked by Phase 6N-A §4):
 *   - `discussion_provider === "whop"` → `whopMirrorUrl` populated from
 *      `community_channels.whop_channel_id`. Drawer shows "Open Whop
 *      mirror" CTA + "External · Whop-hosted" subtext.
 *   - `discussion_provider === "native"` → `nativeUrl` populated. Not
 *      built yet · field exists for the next phase's overlay subscriber.
 *   - `discussion_provider === "none"` → both URLs null. Drawer shows
 *      "Discussion not provisioned yet" copy.
 *
 * Tier gating: campaign-level `requiredTier` OR
 * `tierRules.discussionAccess.minTier` lock the discussion. Caller tier
 * comes from the same `useTierCaps` chain used for community gating.
 */

import { whopChatUrl } from "../community/types";
import type { Discussion } from "../community/discussion";
import type {
  Campaign,
  CampaignType,
} from "./types";

const CAMPAIGN_KIND_PERKS: Record<CampaignType, string[]> = {
  clip: [
    "Direct line to the agency running this clip campaign.",
    "Pacing tips + which footage is converting now.",
    "First look at fresh asset drops.",
  ],
  coordination: [
    "Real-time coordination during the campaign window.",
    "Pre-window briefing + post-window debrief.",
    "Capacity meter updates as actions land.",
  ],
  affiliate: [
    "Conversion tear-downs from top affiliates.",
    "Hook tweaks tested against live data.",
    "Bonus-tier countdowns + payout updates.",
  ],
  submission: [
    "Approval timing + reviewer notes from the mods.",
    "Edge-case calls (watermark · scope · disclosure).",
    "First look at new submission slots when they open.",
  ],
};

function campaignDiscussionStatus(c: Campaign, callerTier: string | null | undefined, callerIsAdmin: boolean): Discussion["status"] {
  /* Locked beats coming · admin beats none · open is the residual. */
  const tierGate = c.tierRules.discussionAccess?.minTier ?? c.requiredTier ?? null;
  const isPremium = callerTier === "pro" || callerTier === "agency"
    || callerTier === "solo" || callerTier === "growth" || callerTier === "channel" || callerTier === "autopilot";
  if (tierGate === "agency" && callerTier !== "agency") return "locked";
  if (tierGate === "pro" && !isPremium) return "locked";

  if (c.discussionProvider === "none") return "coming";
  if (c.discussionProvider === "whop" && !c.communityChannelId) return "coming";
  if (c.discussionProvider === "native" && !c.nativeDiscussionId) return "coming";

  if (c.visibility === "invite_only" && !callerIsAdmin) return "admin";

  return "open";
}

export function campaignToDiscussion(
  c: Campaign,
  callerTier: string | null | undefined,
  callerIsAdmin: boolean = false,
): Discussion {
  const status = campaignDiscussionStatus(c, callerTier, callerIsAdmin);
  const locked = status === "locked";

  const whopMirrorUrl = c.discussionProvider === "whop" && c.communityChannelId
    ? whopChatUrl(c.communityChannelId)
    : null;
  const whopMirrorId = c.discussionProvider === "whop" ? c.communityChannelId : null;

  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    purpose: c.subtitle ?? null,
    kind: "campaign",
    status,
    locked,
    requiredTier: c.tierRules.discussionAccess?.minTier ?? c.requiredTier ?? "free",
    /* Section is irrelevant for campaigns · kept as paid_core so the
     *  RoomDetailDrawer's section badge still has a value. */
    section: "paid_core",
    businessUnit: c.businessUnit,
    missionLane: null,
    whopMirrorUrl,
    whopMirrorId,
    nativeUrl: null,
    perks: CAMPAIGN_KIND_PERKS[c.campaignType],
  };
}
