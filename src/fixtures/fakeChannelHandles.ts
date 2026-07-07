// Per-platform handle strings shown inside PublishModal preview tiles.
// Every handle ends in "(sim)" so screenshots can't be confused for real
// connected accounts. Replaced with real Ayrshare-returned handles in v2.

import type { PlatformId } from "../state/publishStore";

export const fakeChannelHandles: Record<PlatformId, string> = {
  tiktok: "@liquidclips (sim)",
  youtube_shorts: "Liquid Clips (sim)",
  instagram_reels: "@liquidclips.app (sim)",
  x: "@liquidclips (sim)",
  facebook: "Liquid Clips Page (sim)",
  youtube: "Liquid Clips (sim)",
  linkedin: "Liquid Clips (sim)",
  instagram: "@liquidclips.app (sim)",
};
