/**
 * launchMode · shared reader for `VITE_LAUNCH_COMING_SOON`.
 *
 * One env flag drives multiple soft-launch behaviours across the app:
 *   - useCampaigns() coerces every clipper-facing campaign to
 *     `status: "coming_soon"`
 *   - SponsoredReward{Card,Module,Strip} swap the "$50" carrot copy
 *     for "Coming soon" so we don't promise money we don't yet have
 *     a funding rail for
 *   - CampaignPageShell Submit CTA + Post-to-Whop button gate to
 *     "coming soon" toasts + no-op
 *
 * Baked at build time via Vite's env pipeline · flipping requires a
 * new build. Deliberate: a savvy clipper can't override in devtools.
 *
 * Trial-revenue-funded reward pool (future, per Daniel's ask 2026-08-30):
 * the honest answer to "can we actually pay out during the beta?" is
 * "yes but only if trial revenue funds it live." That requires:
 *   - Whop webhook → per-plan revenue attribution (currently we don't
 *     tag which trial-sub payment funded which reward pool)
 *   - A scoped SponsoredCampaign row that accumulates trial revenue
 *     as its budget instead of a flat notional
 *   - UI showing "N trials funded → $X pool → Y days left"
 *   - Payout mechanism when threshold hit
 * Realistic estimate: 2-3 weeks post-launch. Until then, this flag
 * keeps every reward surface honest by saying "Coming soon."
 */

/** Returns true when the launch-mode flag is set at build time. */
export function isLaunchComingSoonMode(): boolean {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const v = (import.meta as any).env?.VITE_LAUNCH_COMING_SOON;
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}
