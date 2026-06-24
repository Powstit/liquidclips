// Lane 3 — Publish / Schedule / Submit-to-Whop store.
//
// Simulator-only. No real Ayrshare, no real Whop, no backend, no payouts,
// no view tracking. This store records LOCAL INTENT:
//   - which channels the user has "connected" in the simulator
//   - which posts they have queued / posted / failed (local intent only)
//   - which posted-links they have submitted to Whop (link-out + local record)
//
// What this store DOES NOT KNOW:
//   - whether a real post actually went out (Ayrshare owns that in production)
//   - whether a clip was approved on Whop (Whop owns that)
//   - whether the clipper was paid (Whop owns that)
//   - how many views a clip got (the platform owns that)
//
// Honesty rule: statuses describe LOCAL QUEUE INTENT only. They never describe
// Whop approval, payout, or platform analytics state.

import { create } from "zustand";
import { fakeChannels } from "../fixtures/fakeChannels";
import { fakeSchedule, type FakeScheduledPost } from "../fixtures/fakeSchedule";
import { fakeSubmissions, type FakeSubmission } from "../fixtures/fakeEarn";

export type PlatformId =
  | "tiktok"
  | "youtube_shorts"
  | "instagram_reels"
  | "x"
  | "facebook"
  | "youtube"
  | "linkedin"
  | "instagram";

export type ScheduledPostStatus = "pending" | "posted" | "failed";

export type ScheduleCadence = "now" | "drip" | "scheduled";

export interface ScheduledPost {
  id: string;
  clipId: string;
  clipTitle: string;
  campaignId: string | null;
  campaignName: string | null;
  channels: PlatformId[];
  caption: string;
  cadence: ScheduleCadence;
  scheduledFor: string;
  status: ScheduledPostStatus;
  createdAt: string;
}

export interface Submission {
  id: string;
  campaignId: string | null;
  campaignName: string | null;
  clipId: string | null;
  postedLink: string;
  note: string;
  openedAt: string;
}

interface PublishState {
  connectedChannels: Set<PlatformId>;
  scheduledPosts: ScheduledPost[];
  submissions: Submission[];
  connect: (channel: PlatformId) => void;
  disconnect: (channel: PlatformId) => void;
  schedulePost: (payload: Omit<ScheduledPost, "id" | "createdAt">) => ScheduledPost;
  deleteScheduledPost: (id: string) => void;
  recordSubmission: (payload: Omit<Submission, "id" | "openedAt">) => Submission;
}

const seedConnected = new Set<PlatformId>();
for (const c of fakeChannels) {
  if (c.status === "connected") {
    seedConnected.add(c.platform as PlatformId);
  }
}

const seedScheduled: ScheduledPost[] = fakeSchedule.map((s: FakeScheduledPost) => ({
  id: s.id,
  clipId: s.clipId,
  clipTitle: s.clipTitle,
  campaignId: s.campaignId ?? null,
  campaignName: s.campaignName ?? null,
  channels: s.channels as PlatformId[],
  caption: s.caption,
  cadence: s.cadence,
  scheduledFor: s.scheduledFor,
  status: s.status,
  createdAt: s.createdAt,
}));

const seedSubmissions: Submission[] = fakeSubmissions.map((s: FakeSubmission) => ({
  id: s.id,
  campaignId: s.campaignId,
  campaignName: s.campaignName,
  clipId: s.clipId,
  postedLink: s.postedLink,
  note: s.note,
  openedAt: s.openedAt,
}));

let nextScheduledIdx = seedScheduled.length + 1;
let nextSubmissionIdx = seedSubmissions.length + 1;

export const usePublishStore = create<PublishState>((set) => ({
  connectedChannels: seedConnected,
  scheduledPosts: seedScheduled,
  submissions: seedSubmissions,

  connect: (channel) =>
    set((state) => {
      const next = new Set(state.connectedChannels);
      next.add(channel);
      return { connectedChannels: next };
    }),

  disconnect: (channel) =>
    set((state) => {
      const next = new Set(state.connectedChannels);
      next.delete(channel);
      return { connectedChannels: next };
    }),

  schedulePost: (payload) => {
    const id = `sch_lc_${String(nextScheduledIdx++).padStart(4, "0")}`;
    const createdAt = new Date().toISOString();
    const post: ScheduledPost = { id, createdAt, ...payload };
    set((state) => ({ scheduledPosts: [post, ...state.scheduledPosts] }));
    return post;
  },

  deleteScheduledPost: (id) =>
    set((state) => ({
      scheduledPosts: state.scheduledPosts.filter((p) => p.id !== id),
    })),

  recordSubmission: (payload) => {
    const id = `sub_lc_${String(nextSubmissionIdx++).padStart(4, "0")}`;
    const openedAt = new Date().toISOString();
    const submission: Submission = { id, openedAt, ...payload };
    set((state) => ({ submissions: [submission, ...state.submissions] }));
    return submission;
  },
}));

export const ALL_PLATFORMS: PlatformId[] = [
  "tiktok",
  "youtube_shorts",
  "instagram_reels",
  "x",
  "facebook",
  "youtube",
  "linkedin",
  "instagram",
];

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  tiktok: "TikTok",
  youtube_shorts: "YouTube Shorts",
  instagram_reels: "Instagram Reels",
  x: "X",
  facebook: "Facebook",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  instagram: "Instagram",
};
