export type MissionStatus = "available" | "in_progress" | "completed" | "locked";

export interface FakeMission {
  id: string;
  title: string;
  rewardDescription: string;
  status: MissionStatus;
  description: string;
  requiresTier: "free" | "solo" | "pro" | "agency";
  whopUrl: string;
  campaignId?: string;
}

export const fakeMissions: FakeMission[] = [
  {
    id: "msn_fx_001",
    title: "Clip Uncle Daniel × 3",
    rewardDescription: "Reward set on Whop",
    status: "available",
    description: "Post 3 clips with the brand tag.",
    requiresTier: "free",
    whopUrl: "https://whop.com/liquidclips/rewards/uncle-daniel-audience-zero",
    campaignId: "cmp_fx_001",
  },
  {
    id: "msn_fx_002",
    title: "First viral reaction",
    rewardDescription: "Reward set on Whop",
    status: "in_progress",
    description: "Hit 10k views on a reaction clip.",
    requiresTier: "free",
    whopUrl: "https://whop.com/liquidclips/rewards/uncle-daniel-audience-zero",
    campaignId: "cmp_fx_001",
  },
  {
    id: "msn_fx_003",
    title: "Pro proof clip × 1",
    rewardDescription: "Reward set on Whop",
    status: "locked",
    description: "Pro tier required — shows the watermark removal.",
    requiresTier: "pro",
    whopUrl: "https://whop.com/liquidclips/rewards/uncle-daniel-audience-zero",
    campaignId: "cmp_fx_001",
  },
  {
    id: "msn_fx_004",
    title: "Affiliate funnel post × 5",
    rewardDescription: "Reward set on Whop",
    status: "completed",
    description: "Posted 5 affiliate-tagged clips in week 3.",
    requiresTier: "free",
    whopUrl: "https://whop.com/liquidclips/rewards/uncle-daniel-audience-zero",
    campaignId: "cmp_fx_001",
  },
];

// v1: no native bonus ledger. All payout tracking happens on Whop.
// This skeleton object is intentionally empty to prevent fake native numbers.
export interface FakeBonus {
  id: string;
  label: string;
  whopUrl: string;
}

export const fakeBonusLedger: FakeBonus[] = [
  { id: "bnu_fx_001", label: "Week 3 affiliate bonus", whopUrl: "https://whop.com/liquidclips/affiliate" },
  { id: "bnu_fx_002", label: "Viral reaction reward bonus", whopUrl: "https://whop.com/liquidclips/rewards" },
];

// Lane 3 — local submission ledger seeds.
//
// Each entry records that the user OPENED a Whop submission for a posted link.
// It does NOT record approval, payout, or reward state — those live on Whop.

export interface FakeSubmission {
  id: string;
  campaignId: string | null;
  campaignName: string | null;
  clipId: string | null;
  postedLink: string;
  note: string;
  openedAt: string;
}

export const fakeSubmissions: FakeSubmission[] = [
  {
    id: "sub_fx_001",
    campaignId: "cmp_fx_001",
    campaignName: "Uncle Daniel Audience-Zero",
    clipId: "clip_fx_003",
    postedLink: "https://www.tiktok.com/@liquidclips/video/audience-zero-playbook",
    note: "submitted via local ledger — Whop owns approval",
    openedAt: "2026-06-15T14:34:00Z",
  },
  {
    id: "sub_fx_002",
    campaignId: "cmp_fx_001",
    campaignName: "Uncle Daniel Audience-Zero",
    clipId: "clip_fx_002",
    postedLink: "https://www.instagram.com/reel/the-trap-of-perfectionism",
    note: "",
    openedAt: "2026-06-13T20:12:00Z",
  },
];

export function getActiveSubmissionsForCampaign(campaignId: string) {
  return fakeSubmissions.filter((s) => s.campaignId === campaignId);
}
