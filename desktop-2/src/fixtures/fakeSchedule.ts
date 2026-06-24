// Lane 3 — seeds for publishStore.scheduledPosts.
//
// Statuses describe LOCAL QUEUE INTENT only:
//   - pending = user asked us to remember to send this later
//   - posted  = user clicked "Post now" or the scheduled time has passed
//   - failed  = local handoff to Ayrshare failed to fire
//
// They DO NOT describe Whop approval, payout, or platform analytics.

export type SchedulePostStatus = "pending" | "posted" | "failed";

export type ScheduleCadence = "now" | "drip" | "scheduled";

export interface FakeScheduledPost {
  id: string;
  clipId: string;
  clipTitle: string;
  campaignId: string | null;
  campaignName: string | null;
  channels: string[];
  caption: string;
  cadence: ScheduleCadence;
  scheduledFor: string;
  status: SchedulePostStatus;
  createdAt: string;
}

export const fakeSchedule: FakeScheduledPost[] = [
  {
    id: "sch_fx_001",
    clipId: "clip_fx_002",
    clipTitle: "the trap of perfectionism",
    campaignId: "cmp_fx_001",
    campaignName: "Uncle Daniel Audience-Zero",
    channels: ["tiktok", "instagram_reels", "youtube_shorts"],
    caption: "the trap of perfectionism — why your first cut is enough",
    cadence: "scheduled",
    scheduledFor: "2026-06-17T09:00:00Z",
    status: "pending",
    createdAt: "2026-06-16T08:45:00Z",
  },
  {
    id: "sch_fx_002",
    clipId: "clip_fx_001",
    clipTitle: "ship to learn",
    campaignId: "cmp_fx_001",
    campaignName: "Uncle Daniel Audience-Zero",
    channels: ["x", "linkedin"],
    caption: "ship to learn. the fake-data cut is the real cut.",
    cadence: "drip",
    scheduledFor: "2026-06-16T22:00:00Z",
    status: "pending",
    createdAt: "2026-06-16T07:10:00Z",
  },
  {
    id: "sch_fx_003",
    clipId: "clip_fx_003",
    clipTitle: "audience-zero playbook",
    campaignId: "cmp_fx_001",
    campaignName: "Uncle Daniel Audience-Zero",
    channels: ["tiktok"],
    caption: "audience-zero playbook · stop optimising before you ship",
    cadence: "now",
    scheduledFor: "2026-06-15T14:32:00Z",
    status: "posted",
    createdAt: "2026-06-15T14:32:00Z",
  },
  {
    id: "sch_fx_004",
    clipId: "clip_fx_004",
    clipTitle: "the cold-start trap",
    campaignId: "cmp_fx_001",
    campaignName: "Uncle Daniel Audience-Zero",
    channels: ["youtube_shorts"],
    caption: "the cold-start trap — you don't have a content problem.",
    cadence: "scheduled",
    scheduledFor: "2026-06-14T19:00:00Z",
    status: "failed",
    createdAt: "2026-06-14T18:55:00Z",
  },
];
