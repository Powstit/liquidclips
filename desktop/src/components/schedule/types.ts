// Shared types for the Schedule v2 surfaces. Re-export of the Channel /
// analytics types from backend.ts so individual components don't all need
// to import from lib/backend directly — cleaner separation.

export type {
  Channel,
  ChannelPlatform,
  ChannelStatus,
  ChannelCreateResponse,
  AnalyticsOverview,
  AnalyticsWindow,
  ChannelAnalyticsRow,
  ChannelDetail,
} from "../../lib/backend";

export const SUPPORTED_PLATFORMS: ReadonlyArray<{
  id: "tiktok" | "instagram" | "youtube" | "x" | "linkedin" | "facebook" | "threads";
  label: string;
}> = [
  { id: "tiktok",   label: "TikTok" },
  { id: "instagram", label: "Instagram Reels" },
  { id: "youtube",  label: "YouTube Shorts" },
  { id: "x",        label: "X (Twitter)" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "facebook", label: "Facebook" },
  { id: "threads",  label: "Threads" },
];

export function prettyPlatform(p: string): string {
  return SUPPORTED_PLATFORMS.find((x) => x.id === p)?.label ?? p;
}
