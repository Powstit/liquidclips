// Avatar catalog — gamified unlock system.
//
// Each catalog entry is rendered as a Lucide-icon glyph on a brand-tinted
// background for v1; the catalog is the swap target for the gpt-image-1
// batch (per the catjack_asset_pipeline rule — all real visual art comes
// from gpt-image-1, never procedural). When PNG/GIF avatars land, only
// the `glyph` field changes; ids and thresholds stay stable.
//
// Unlock threshold = lifetime affiliate earnings in USD. Reward-clipping
// payouts may join the threshold in a later iteration; for now the source
// of truth is `affiliate.total_referral_earnings_usd` from /me/affiliate.

import type { ReactNode } from "react";
import {
  Crown,
  Diamond,
  Flame,
  Rocket,
  Skull,
  Sparkles,
  Star,
  Zap,
} from "lucide-react";

export type AvatarTier = "rookie" | "climber" | "pro" | "titan";

export type AvatarEntry = {
  id: string;
  label: string;
  tier: AvatarTier;
  unlock_usd: number;
  // Tailwind class for the chip background tint behind the glyph. Restricted
  // to the brand palette + the existing destructive/warning hexes.
  tone: string;
  // The glyph rendered inside the avatar. Kept as a function so each
  // consumer can size it via the `size` prop without coupling to a fixed
  // pixel count here.
  glyph: (props: { size?: number }) => ReactNode;
};

export const TIER_LABEL: Record<AvatarTier, string> = {
  rookie: "Rookie",
  climber: "Climber",
  pro: "Pro",
  titan: "Titan",
};

export const TIER_THRESHOLD: Record<AvatarTier, number> = {
  rookie: 0,
  climber: 100,
  pro: 500,
  titan: 2500,
};

// The 8 v1 avatars. Order in this array = order in the picker grid.
// Earned-by tiers cluster so the visual progression reads top-to-bottom.
export const AVATARS: AvatarEntry[] = [
  {
    id: "rookie-spark",
    label: "Spark",
    tier: "rookie",
    unlock_usd: 0,
    tone: "bg-paper-elev text-text-secondary border-line",
    glyph: ({ size = 18 }) => <Sparkles size={size} strokeWidth={2.2} />,
  },
  {
    id: "rookie-zap",
    label: "Zap",
    tier: "rookie",
    unlock_usd: 0,
    tone: "bg-paper-elev text-ink border-line",
    glyph: ({ size = 18 }) => <Zap size={size} strokeWidth={2.2} />,
  },
  {
    id: "climber-rocket",
    label: "Rocket",
    tier: "climber",
    unlock_usd: 100,
    tone: "bg-fuchsia-soft/40 text-fuchsia-deep border-fuchsia/30",
    glyph: ({ size = 18 }) => <Rocket size={size} strokeWidth={2.2} />,
  },
  {
    id: "climber-star",
    label: "Star",
    tier: "climber",
    unlock_usd: 100,
    tone: "bg-fuchsia-soft/40 text-fuchsia-deep border-fuchsia/30",
    glyph: ({ size = 18 }) => <Star size={size} strokeWidth={2.2} />,
  },
  {
    id: "pro-flame",
    label: "Flame",
    tier: "pro",
    unlock_usd: 500,
    tone: "bg-fuchsia/15 text-fuchsia border-fuchsia/50",
    glyph: ({ size = 18 }) => <Flame size={size} strokeWidth={2.2} />,
  },
  {
    id: "pro-diamond",
    label: "Diamond",
    tier: "pro",
    unlock_usd: 500,
    tone: "bg-fuchsia/15 text-fuchsia border-fuchsia/50",
    glyph: ({ size = 18 }) => <Diamond size={size} strokeWidth={2.2} />,
  },
  {
    id: "titan-crown",
    label: "Crown",
    tier: "titan",
    unlock_usd: 2500,
    tone: "bg-fuchsia text-white border-fuchsia",
    glyph: ({ size = 18 }) => <Crown size={size} strokeWidth={2.2} />,
  },
  {
    id: "titan-skull",
    label: "Skull",
    tier: "titan",
    unlock_usd: 2500,
    tone: "bg-fuchsia text-white border-fuchsia",
    glyph: ({ size = 18 }) => <Skull size={size} strokeWidth={2.2} />,
  },
];

export function avatarById(id: string | null | undefined): AvatarEntry | null {
  if (!id) return null;
  return AVATARS.find((a) => a.id === id) ?? null;
}

export function isUnlocked(entry: AvatarEntry, earnedUsd: number): boolean {
  return earnedUsd >= entry.unlock_usd;
}

// Next tier threshold above the user's current earnings, for the
// "you're $XX away from unlocking your next avatar" nudge.
export function nextUnlock(earnedUsd: number): AvatarEntry | null {
  return AVATARS.find((a) => earnedUsd < a.unlock_usd) ?? null;
}

export function formatUnlockMoney(usd: number): string {
  if (usd >= 1000) return `$${Math.round(usd / 100) / 10}k`;
  return `$${usd}`;
}
