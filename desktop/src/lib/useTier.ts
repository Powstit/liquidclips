import { useEffect, useState } from "react";
import { syncStatus, type SyncStatus, type Tier } from "./backend";

// Lightweight tier hook. Defaults to "free" when sync hasn't completed or the
// user has no license JWT, so gating UX renders immediately on first paint
// rather than flashing the paid view before downgrading.

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
const PUBLISH_MATRIX: Record<Tier, Record<PublishCapability, boolean>> = {
  free:      { publish_now_single: false, publish_now_multi: false, schedule_one: false, drip_scheduling: false, any_connection: false },
  solo:      { publish_now_single: true,  publish_now_multi: false, schedule_one: false, drip_scheduling: false, any_connection: true },
  growth:    { publish_now_single: true,  publish_now_multi: true,  schedule_one: true,  drip_scheduling: false, any_connection: true },
  autopilot: { publish_now_single: true,  publish_now_multi: true,  schedule_one: true,  drip_scheduling: true,  any_connection: true },
};

// Max connected accounts per tier — matches features.py.
const MAX_CONNECTIONS: Record<Tier, number | null> = {
  free: 0,
  solo: 2,
  growth: 4,
  autopilot: null, // unlimited
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
      for (const t of ["solo", "growth", "autopilot"] as Tier[]) {
        if (PUBLISH_MATRIX[t][cap]) return t;
      }
      return "autopilot";
    },
    maxConnections: MAX_CONNECTIONS[tier],
  };
}

export const FREE_TIER_VISIBLE_CLIPS = FREE_CLIPS_VISIBLE;

// Marketing copy for upgrade walls — tier name + price tagline.
export const TIER_COPY: Record<Tier, { name: string; price: string; pitch: string }> = {
  free:      { name: "Free",      price: "free",         pitch: "Try Junior on 3 videos a month." },
  solo:      { name: "Solo",      price: "from £12/mo",  pitch: "Unlimited clips, publish one platform at a time." },
  growth:    { name: "Growth",    price: "from £49/mo",  pitch: "Multi-platform publish + schedule + 4 connected accounts." },
  autopilot: { name: "Autopilot", price: "from £149/mo", pitch: "Drip-mode across every platform, unlimited connections." },
};
