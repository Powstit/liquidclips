import rookieArt from "../assets/tiers/rookie.png";
import climberArt from "../assets/tiers/climber.png";
import proArt from "../assets/tiers/pro.png";
import titanArt from "../assets/tiers/titan.png";
import legendArt from "../assets/tiers/legend.png";

/**
 * Sprint #18a — Tier avatar. Visual rank that climbs with lifetime affiliate
 * earnings. NOT tied to subscription tier — purely a gamified earned badge
 * the user displays in AffiliateHero + Settings.
 *
 * Thresholds tuned to feel reachable but progressive. Tweak by editing
 * `TIER_THRESHOLDS` — UI re-renders automatically.
 */

export type EarnerTier = "rookie" | "climber" | "pro" | "titan" | "legend";

const TIER_ART: Record<EarnerTier, string> = {
  rookie: rookieArt,
  climber: climberArt,
  pro: proArt,
  titan: titanArt,
  legend: legendArt,
};

const TIER_LABEL: Record<EarnerTier, string> = {
  rookie: "Rookie",
  climber: "Climber",
  pro: "Pro",
  titan: "Titan",
  legend: "Legend",
};

// USD lifetime earned at the affiliate path. Edit here to retune.
const TIER_THRESHOLDS: { tier: EarnerTier; min_usd: number }[] = [
  { tier: "legend",  min_usd: 10000 },
  { tier: "titan",   min_usd: 2500 },
  { tier: "pro",     min_usd: 500 },
  { tier: "climber", min_usd: 50 },
  { tier: "rookie",  min_usd: 0 },
];

export function tierForEarnings(lifetime_usd: number): EarnerTier {
  for (const { tier, min_usd } of TIER_THRESHOLDS) {
    if (lifetime_usd >= min_usd) return tier;
  }
  return "rookie";
}

export function nextTierMilestone(lifetime_usd: number): { next: EarnerTier; min_usd: number } | null {
  // Iterate thresholds ascending; return the first one above current earnings.
  const ascending = [...TIER_THRESHOLDS].reverse();
  for (const t of ascending) {
    if (t.min_usd > lifetime_usd) return { next: t.tier, min_usd: t.min_usd };
  }
  return null;
}

export function TierAvatar({
  tier,
  size = 56,
  withLabel = false,
}: {
  tier: EarnerTier;
  size?: number;
  withLabel?: boolean;
}) {
  return (
    <div className="inline-flex flex-col items-center gap-1">
      <img
        src={TIER_ART[tier]}
        alt={`${TIER_LABEL[tier]} tier`}
        title={`${TIER_LABEL[tier]} tier`}
        className="object-contain"
        style={{ width: size, height: size, filter: "drop-shadow(0 4px 12px rgba(255,26,140,0.25))" }}
      />
      {withLabel && (
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-fuchsia-deep">
          {TIER_LABEL[tier]}
        </span>
      )}
    </div>
  );
}
