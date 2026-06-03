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

// Task #69 — HUD vocab layered on top of the existing tier IDs. Backend
// data model stays Rookie/Climber/Pro/Titan/Legend; UI renders the new
// Cadet/Operator/Veteran/Commander/Legend ladder so the chrome matches
// docs/RPO_VISUAL_LANGUAGE.md without breaking analytics or API calls.
// Mapping intentionally mirrors the subscription-tier ladder spec
// (Free→Cadet, Solo→Operator, Pro→Veteran, Agency→Commander) for the
// first four rungs; Legend stays Legend — it's the apex earner rank and
// has no peer in the subscription mapping.
const TIER_HUD_LABEL: Record<EarnerTier, string> = {
  rookie: "Cadet",
  climber: "Operator",
  pro: "Veteran",
  titan: "Commander",
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
  active = true,
}: {
  tier: EarnerTier;
  size?: number;
  withLabel?: boolean;
  /** When true (default) the HUD vocab line gets the pulsing fuchsia
   *  underline. Pass false on hover-preview / locked surfaces. */
  active?: boolean;
}) {
  const hudLabel = TIER_HUD_LABEL[tier];
  return (
    <div className="inline-flex flex-col items-center gap-1.5">
      <img
        src={TIER_ART[tier]}
        alt={`${TIER_LABEL[tier]} tier · ${hudLabel} class`}
        title={`${TIER_LABEL[tier]} · ${hudLabel}`}
        className="object-contain"
        style={{ width: size, height: size, filter: "drop-shadow(0 4px 12px rgba(255,26,140,0.25))" }}
      />
      {withLabel && (
        <div className="flex flex-col items-center gap-0.5">
          {/* HUD eyebrow — lowercase per docs/RPO_VISUAL_LANGUAGE.md,
              keeps mono treatment used by every other eyebrow. */}
          <span className="font-mono text-[8.5px] lowercase tracking-[0.18em] text-text-tertiary">
            class
          </span>
          {/* Tier name in HUD vocab — display font, larger than the old
              pill, all-caps. Active state paints the pulsing fuchsia
              underline via the .hud-tier-glow keyframe. */}
          <span
            className={[
              "font-display text-[13px] font-semibold uppercase leading-none tracking-[0.04em] text-ink",
              active ? "hud-tier-glow" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {hudLabel}
          </span>
        </div>
      )}
    </div>
  );
}
