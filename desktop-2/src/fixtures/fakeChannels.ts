export type ChannelStatus = "connected" | "disconnected" | "expired";

export interface FakeChannel {
  platform: string;
  handle: string;
  status: ChannelStatus;
  connectedAt: string | null;
}

export const fakeChannels: FakeChannel[] = [
  { platform: "tiktok",          handle: "@liquidclips",   status: "connected",    connectedAt: "2026-06-01T10:11:00Z" },
  { platform: "instagram",       handle: "@liquidclips.app", status: "connected",  connectedAt: "2026-06-01T10:14:00Z" },
  { platform: "youtube_shorts",  handle: "Liquid Clips",   status: "connected",    connectedAt: "2026-06-02T08:00:00Z" },
  { platform: "x",               handle: "@liquidclips",   status: "expired",      connectedAt: "2026-04-12T09:00:00Z" },
  { platform: "linkedin",        handle: "Liquid Clips",   status: "disconnected", connectedAt: null },
  { platform: "facebook",        handle: "—",               status: "disconnected", connectedAt: null },
];
