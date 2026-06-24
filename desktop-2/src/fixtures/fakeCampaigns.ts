export type CampaignStatus = "draft" | "active" | "paused";

export interface FakeCampaign {
  id: string;
  name: string;
  ownerHandle: string;
  status: CampaignStatus;
  sourceTitle: string;
  sourceDurationSec: number;
  watermarkHandle: string;
  watermarkPosition: "bottom" | "top" | "corner";
  rewardPoolUrl: string;
  inviteUrl: string;
  communityUrl: string;
  clipperCount: number;
  outputClipIds: string[];
  /** Visual flag only; determines which brand emblem renders on the card. */
  sponsored?: boolean;
  /** Visual owner tier emblem name (maps to /brand/tiers/{name}.png). */
  ownerTier?: string;
}

export const fakeCampaigns: FakeCampaign[] = [
  {
    id: "cmp_fx_001",
    name: "Uncle Daniel Audience-Zero",
    ownerHandle: "@uncledaniel",
    status: "active",
    sourceTitle: "How to build an audience from zero",
    sourceDurationSec: 3600,
    watermarkHandle: "@uncledaniel",
    watermarkPosition: "bottom",
    rewardPoolUrl: "https://whop.com/liquidclips/rewards/uncle-daniel-audience-zero",
    inviteUrl: "https://whop.com/liquidclips/join/uncle-daniel-audience-zero",
    communityUrl: "https://whop.com/c/uncle-daniel-clips",
    clipperCount: 12,
    outputClipIds: ["clip_fx_001", "clip_fx_002", "clip_fx_003"],
    ownerTier: "free",
  },
  {
    id: "cmp_fx_002",
    name: "DDB Beauty Launch",
    ownerHandle: "@ddbbeauty",
    status: "draft",
    sourceTitle: "Beauty launch week behind the scenes",
    sourceDurationSec: 1845,
    watermarkHandle: "@ddbbeauty",
    watermarkPosition: "corner",
    rewardPoolUrl: "https://whop.com/liquidclips/rewards/ddb-beauty-launch",
    inviteUrl: "https://whop.com/liquidclips/join/ddb-beauty-launch",
    communityUrl: "https://whop.com/c/ddb-beauty-clips",
    clipperCount: 0,
    outputClipIds: [],
    sponsored: true,
  },
];

export function getCampaignById(id: string): FakeCampaign | undefined {
  return fakeCampaigns.find((c) => c.id === id);
}
