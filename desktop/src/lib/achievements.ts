/**
 * Achievement system — sprint #18a.
 *
 * Maps milestone events to badge sprites. When a user crosses a threshold the
 * caller fires `recordAchievement(id)`. We dedup against a localStorage flag
 * so each badge only unlocks once + fire a toast via the global achievement
 * event. The `BadgeShelf` component subscribes to the same store to render
 * "earned" vs "locked" tiles.
 *
 * Badge sprites generated via gpt-image-1 → `src/assets/badges/<id>.png`.
 */

import { track } from "./analytics";

// Vite bundles these via import-as-URL — keeps everything in the .app, no
// runtime fetch.
import firstClipArt from "../assets/badges/first-clip.png";
import firstPublishArt from "../assets/badges/first-publish.png";
import hundredClipsArt from "../assets/badges/hundred-clips.png";
import firstPayoutArt from "../assets/badges/first-payout.png";
import hundredDollarsArt from "../assets/badges/hundred-dollars.png";
import viralClipArt from "../assets/badges/viral-clip.png";
import firstReferralArt from "../assets/badges/first-referral.png";
import top100Art from "../assets/badges/top-100-leaderboard.png";

export type AchievementId =
  | "first_clip"
  | "first_publish"
  | "hundred_clips"
  | "first_payout"
  | "hundred_dollars"
  | "viral_clip"
  | "first_referral"
  | "top_100_leaderboard";

export type Achievement = {
  id: AchievementId;
  title: string;
  blurb: string;
  art: string;
};

export const ACHIEVEMENTS: Record<AchievementId, Achievement> = {
  first_clip: {
    id: "first_clip",
    title: "First Clip",
    blurb: "You shipped your first cut. The hardest one's behind you.",
    art: firstClipArt,
  },
  first_publish: {
    id: "first_publish",
    title: "First Publish",
    blurb: "Live on a real platform. The world saw your clip.",
    art: firstPublishArt,
  },
  hundred_clips: {
    id: "hundred_clips",
    title: "100 Clips",
    blurb: "You've cut 100. You're not new at this.",
    art: hundredClipsArt,
  },
  first_payout: {
    id: "first_payout",
    title: "First Payout",
    blurb: "Money landed. Welcome to the earn loop.",
    art: firstPayoutArt,
  },
  hundred_dollars: {
    id: "hundred_dollars",
    title: "$100 Earned",
    blurb: "Three figures from clipping. Compounding starts here.",
    art: hundredDollarsArt,
  },
  viral_clip: {
    id: "viral_clip",
    title: "Viral",
    blurb: "A clip crossed 10,000 views. You hit the algorithm.",
    art: viralClipArt,
  },
  first_referral: {
    id: "first_referral",
    title: "First Referral",
    blurb: "Someone signed up because of you. Network effect, started.",
    art: firstReferralArt,
  },
  top_100_leaderboard: {
    id: "top_100_leaderboard",
    title: "Top 100",
    blurb: "Ranked top 100 affiliates this month. You're in the elite tier.",
    art: top100Art,
  },
};

export const ACHIEVEMENT_ORDER: AchievementId[] = [
  "first_clip",
  "first_publish",
  "hundred_clips",
  "first_payout",
  "hundred_dollars",
  "viral_clip",
  "first_referral",
  "top_100_leaderboard",
];

const STORAGE_KEY = "liquidclips:achievements:v1";

function readEarned(): Set<AchievementId> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeEarned(earned: Set<AchievementId>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(earned)));
  } catch {
    /* localStorage unavailable — silently no-op */
  }
}

// Global pub/sub so the toast layer + the BadgeShelf both see unlock events
// without prop-drilling. Plain event-target API — zero deps.
const bus = new EventTarget();

export type AchievementUnlockedEvent = CustomEvent<{ id: AchievementId; achievement: Achievement }>;

/**
 * Record an achievement. If it's already been earned this is a no-op. Returns
 * true if this call unlocked it, false otherwise. Fires the analytics event
 * + dispatches an `unlocked` event on the global bus.
 */
export function recordAchievement(id: AchievementId): boolean {
  const earned = readEarned();
  if (earned.has(id)) return false;
  earned.add(id);
  writeEarned(earned);
  const achievement = ACHIEVEMENTS[id];
  if (!achievement) return false;
  track("first_bounty_workspace_created", { achievement_id: id, achievement_title: achievement.title });
  // Custom event so AchievementToast can mount in App.tsx and listen.
  bus.dispatchEvent(new CustomEvent("unlocked", { detail: { id, achievement } }) as AchievementUnlockedEvent);
  return true;
}

export function listEarned(): Set<AchievementId> {
  return readEarned();
}

export function isEarned(id: AchievementId): boolean {
  return readEarned().has(id);
}

export function onAchievementUnlocked(cb: (ev: AchievementUnlockedEvent) => void): () => void {
  const handler = (e: Event) => cb(e as AchievementUnlockedEvent);
  bus.addEventListener("unlocked", handler);
  return () => bus.removeEventListener("unlocked", handler);
}

// For tests / debug: reset all earned achievements.
export function _resetAchievements(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}
