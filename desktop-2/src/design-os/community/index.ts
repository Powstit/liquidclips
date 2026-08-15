// 2026-08-15 · trimmed to the data layer only. Community's actual route
// (`CommunityChatHome`) is native chat, not a room catalogue — the
// room-card UI family (RoomCard/RoomGrid/AnnouncementsRail/
// CommunityBanner/FeaturedDiscussion/AchievementToast) was built for a
// design that got replaced and was never deleted; removed outright, it
// had zero real mounts anywhere in the app. RoomDetailDrawer and
// LeaderboardSection were real (Campaigns + Earn use them) and moved to
// design-os/campaigns/ — that's their actual home now. What's left here
// is genuinely community-domain: the data shapes + visited-state +
// achievement-recording logic that useCommunity() and the moved
// components still depend on.
export {
  type CommunityChannel,
  type CommunityRoom,
  type RoomTier,
  type RoomSection,
  type RoomStatus,
  type LeaderboardPreviewRow,
  type AnnouncementItem,
  PREMIUM_TIERS,
  SECTION_META,
  SECTION_ORDER,
  isPremiumTier,
  whopChatUrl,
  resolveRoom,
} from "./types";
export {
  channelToDiscussion,
  loadVisitedSet,
  saveVisitedSet,
  type Discussion,
  type DiscussionKind,
} from "./discussion";
export {
  recordAchievement,
  listEarned,
  isEarned,
  ACHIEVEMENTS,
  ACHIEVEMENT_ORDER,
  type AchievementId,
  type Achievement,
} from "./achievements";
