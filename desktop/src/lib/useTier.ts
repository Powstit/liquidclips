import { useEffect, useState } from "react";
import { syncStatus, type SyncStatus, type Tier } from "./backend";

// Lightweight tier hook. Defaults to "free" when sync hasn't completed or the
// user has no license JWT, so gating UX renders immediately on first paint
// rather than flashing the paid view before downgrading.

// Per-project clip-preview cap on Free: show the first 3 clips, then surface an
// upgrade card for the rest. This is a display nudge, NOT the account quota —
// the real Free gate is the 100 clip-export starter pass enforced backend-side
// (the old "3 videos / month" cap was retired; video_quota_monthly is null now).
const FREE_CLIPS_VISIBLE = 3;

export type PublishCapability =
  | "publish_now_single"
  | "publish_now_multi"
  | "schedule_one"
  | "drip_scheduling"
  | "any_connection";

// Tier → capability matrix. Mirrors backend/app/features.py — when that
// changes, this must change too. Keeping it client-side means the upgrade
// walls render instantly without a backend roundtrip.
//
// Public-facing tiers are Free / Solo / Pro / Agency (matches account-app
// PricingCards.tsx + marketing). Legacy growth/autopilot rows remain so the
// backend's _LEGACY_TIER_ALIASES (growth→pro, autopilot→agency) keep working
// during the rename transition; they share the Pro/Agency capability sets.
const PUBLISH_MATRIX: Record<Tier, Record<PublishCapability, boolean>> = {
  free:      { publish_now_single: false, publish_now_multi: false, schedule_one: false, drip_scheduling: false, any_connection: false },
  solo:      { publish_now_single: true,  publish_now_multi: false, schedule_one: false, drip_scheduling: false, any_connection: true },
  pro:       { publish_now_single: true,  publish_now_multi: true,  schedule_one: true,  drip_scheduling: true,  any_connection: true },
  agency:    { publish_now_single: true,  publish_now_multi: true,  schedule_one: true,  drip_scheduling: true,  any_connection: true },
  // legacy aliases — same capabilities as their v2 successor
  growth:    { publish_now_single: true,  publish_now_multi: true,  schedule_one: true,  drip_scheduling: true,  any_connection: true },
  autopilot: { publish_now_single: true,  publish_now_multi: true,  schedule_one: true,  drip_scheduling: true,  any_connection: true },
};

// Max connected accounts per tier — matches features.py.
const MAX_CONNECTIONS: Record<Tier, number | null> = {
  free: 0,
  solo: 5,
  pro: 10,
  agency: 25,
  // legacy aliases
  growth: 10,
  autopilot: 25,
};

export type TierState = {
  tier: Tier;
  status: SyncStatus | null;
  loading: boolean;
  /** True/false guard for a capability — used by upgrade walls. */
  can(cap: PublishCapability): boolean;
  /** The lowest tier that unlocks a capability — used in the upgrade copy. */
  requiredTierFor(cap: PublishCapability): Tier;
  maxConnections: number | null;
};

export function useTier(): TierState {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await syncStatus();
        if (!cancelled) setStatus(s);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tier: Tier = status?.tier ?? "free";

  return {
    tier,
    status,
    loading,
    can: (cap) => PUBLISH_MATRIX[tier][cap],
    requiredTierFor: (cap) => {
      for (const t of ["solo", "pro", "agency"] as Tier[]) {
        if (PUBLISH_MATRIX[t][cap]) return t;
      }
      return "agency";
    },
    maxConnections: MAX_CONNECTIONS[tier],
  };
}

export const FREE_TIER_VISIBLE_CLIPS = FREE_CLIPS_VISIBLE;

// Marketing copy for upgrade walls — tier name + price tagline.
// Prices are USD-native — match account-app PricingCards + marketing exactly
// (Solo $29.99, Pro $79.99, Agency $149). Legacy growth/autopilot aliases
// alias to Pro/Agency copy so the backend's _LEGACY_TIER_ALIASES path still
// renders sensibly in the desktop.
export const TIER_COPY: Record<Tier, { name: string; price: string; pitch: string }> = {
  free:      { name: "Free",      price: "free",        pitch: "100 free clip exports — no card." },
  solo:      { name: "Solo",      price: "$29.99/mo",   pitch: "Unlimited clips for one creator." },
  pro:       { name: "Pro",       price: "$79.99/mo",   pitch: "Hosted AI + multi-platform publishing + the Partner Deck." },
  agency:    { name: "Agency",    price: "$149/mo",     pitch: "For client accounts, sub-accounts, and white-label teams." },
  // legacy aliases — render as the v2 tier
  growth:    { name: "Pro",       price: "$79.99/mo",   pitch: "Hosted AI + multi-platform publishing + the Partner Deck." },
  autopilot: { name: "Agency",    price: "$149/mo",     pitch: "For client accounts, sub-accounts, and white-label teams." },
};
