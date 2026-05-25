import type { Tier } from "../lib/backend";
import freeIcon from "../assets/tiers/free.png";
import soloIcon from "../assets/tiers/solo.png";
import growthIcon from "../assets/tiers/growth.png";
import autopilotIcon from "../assets/tiers/autopilot.png";

// Generated tier badges (A3). One source of truth so pricing walls, the plan
// row, and upgrade CTAs all show the same mark for a tier.
const ICONS: Record<Tier, string> = {
  free: freeIcon,
  solo: soloIcon,
  growth: growthIcon,
  autopilot: autopilotIcon,
};

export function TierIcon({ tier, className = "h-6 w-6" }: { tier: Tier; className?: string }) {
  return <img src={ICONS[tier] ?? freeIcon} alt="" aria-hidden className={`${className} object-contain`} />;
}
