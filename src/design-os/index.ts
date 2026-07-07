/**
 * Liquid Clips · Design OS · Public API
 *
 * Single import surface for routes:
 *   import { DesignOSAppShell, MetricBoard, ... } from "../../design-os";
 */

export * from "./components";
export * from "./bridge";
export * as motion from "./motion";
export {
  EngineSessionProvider,
  useEngineSession,
  type EngineSession,
  type EnginePhase,
  type EngineSessionProviderProps,
} from "./state/useEngineSession";
export { useKadeFromSession } from "./state/useKadeFromSession";
export {
  useEngineSessionPersistence,
  readPersistedSession,
  clearPersistedSession,
  startPersistedSession,
  selectClipForStudio,
  selectVariantForExport,
  setThumbMode,
  setEpisodeTitle,
  selectEpisodeThumbnail,
  selectClipCover,
  type PersistedEngineSession,
} from "./state/engineSessionPersistence";
export * from "./studio";
export * from "./engine";
export * from "./thumbnail";
export * from "./export";
export { useTierCaps, TIER_CAPS, type Tier, type TierCaps, type TierContext } from "./state/useTierCaps";
export { useChannels, type ChannelsApi, type ChannelStatus } from "./state/useChannels";
export * from "./channels";
export {
  useSchedule,
  type ScheduleApi,
  type ScheduledJob,
  type ScheduledJobStatus,
  type ScheduleClipParams,
  STATUS_BUCKETS,
} from "./state/useSchedule";
export * from "./schedule";
export { useCommunity, type CommunityApi } from "./state/useCommunity";
export * from "./community";
export { useRewardClips, type RewardClipsApi } from "./state/useRewardClips";
export { useEarnSummary, type EarnSummaryApi } from "./state/useEarnSummary";
export * from "./earn";
export { useCampaigns, type CampaignsApi } from "./state/useCampaigns";
export * from "./campaigns";
