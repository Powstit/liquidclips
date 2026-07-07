/**
 * Achievements · Phase 6L-C port
 *
 * Ported from `desktop/src/lib/achievements.ts` (legacy). Differences:
 *
 *   - Storage key is namespaced for the Design OS bundle so a future
 *     port-back doesn't collide: `lc.community.achievements.v1`.
 *   - Pub/sub goes through the LC bus (`achievement:unlocked` event) so
 *     ToastHost-style subscribers can hook in without prop drilling.
 *   - Art map points to EXISTING `public/brand/` assets. Per the Phase
 *     6M-A audit: no new art for 6L-C. Top-100 leaderboard maps to the
 *     trophy badge; the rest use shipped brand chips (coin / chest /
 *     shield / rank-1-gold) until a dedicated badge set generates later.
 *
 * Public API mirrors the legacy module so a future cross-port is a
 * one-line swap:
 *   - recordAchievement(id) → boolean
 *   - listEarned() → Set<AchievementId>
 *   - isEarned(id) → boolean
 *   - _resetAchievements() (test/debug)
 */

import { bus } from "../bridge";

export type AchievementId =
  | "first_clip"
  | "first_publish"
  | "hundred_clips"
  | "first_payout"
  | "hundred_dollars"
  | "viral_clip"
  | "first_referral"
  | "top_100_leaderboard";

export interface Achievement {
  id: AchievementId;
  title: string;
  blurb: string;
  /** Path under public/ · already-shipped brand asset. */
  art: string;
}

/* No new art for Phase 6L-C. Map every achievement to a shipped
 * `public/brand/` asset. When the dedicated badge set generates later,
 * update this map only — the bus payload + downstream consumers stay
 * unchanged. */
export const ACHIEVEMENTS: Record<AchievementId, Achievement> = {
  first_clip: {
    id: "first_clip",
    title: "First Clip",
    blurb: "You shipped your first cut. The hardest one's behind you.",
    art: "/brand/reward/badge-verified-campaign.svg",
  },
  first_publish: {
    id: "first_publish",
    title: "First Publish",
    blurb: "Live on a real platform. The world saw your clip.",
    art: "/brand/reward/stamp-approved.svg",
  },
  hundred_clips: {
    id: "hundred_clips",
    title: "100 Clips",
    blurb: "You've cut 100. You're not new at this.",
    art: "/brand/reward/badge-premium-mission.svg",
  },
  first_payout: {
    id: "first_payout",
    title: "First Payout",
    blurb: "Money landed. Welcome to the earn loop.",
    art: "/brand/reward/stamp-payout.svg",
  },
  hundred_dollars: {
    id: "hundred_dollars",
    title: "$100 Earned",
    blurb: "Three figures from clipping. Compounding starts here.",
    art: "/brand/reward/coin-stack.webp",
  },
  viral_clip: {
    id: "viral_clip",
    title: "Viral",
    blurb: "A clip crossed 10,000 views. You hit the algorithm.",
    art: "/brand/reward/badge-sponsored-mission.svg",
  },
  first_referral: {
    id: "first_referral",
    title: "First Referral",
    blurb: "Someone signed up because of you. Network effect, started.",
    art: "/brand/reward/chest-reward.webp",
  },
  top_100_leaderboard: {
    id: "top_100_leaderboard",
    title: "Top 100",
    blurb: "Ranked top 100 affiliates this month. You're in the elite tier.",
    art: "/brand/leaderboard/badge-trophy.svg",
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

const STORAGE_KEY = "lc.community.achievements.v1";

function readEarned(): Set<AchievementId> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeEarned(earned: Set<AchievementId>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...earned]));
  } catch {
    /* localStorage unavailable — silently no-op. */
  }
}

/**
 * Record an achievement. If it's already been earned this is a no-op.
 * Returns true if this call unlocked it, false otherwise. Fires
 * `achievement:unlocked` on the LC bus when unlocked.
 */
export function recordAchievement(id: AchievementId): boolean {
  const earned = readEarned();
  if (earned.has(id)) return false;
  const achievement = ACHIEVEMENTS[id];
  if (!achievement) return false;
  earned.add(id);
  writeEarned(earned);
  bus.emit("achievement:unlocked", {
    id: achievement.id,
    title: achievement.title,
    blurb: achievement.blurb,
    art: achievement.art,
  });
  return true;
}

export function listEarned(): Set<AchievementId> {
  return readEarned();
}

export function isEarned(id: AchievementId): boolean {
  return readEarned().has(id);
}

export function _resetAchievements(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* noop */ }
}
