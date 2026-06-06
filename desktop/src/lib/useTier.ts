import { useCallback, useEffect, useRef, useState } from "react";
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
  /** Manually re-pull /sync. Used after a tier-changing user action returns
   *  (Stripe Checkout, Whop billing). Resolves once the new tier has been
   *  written into state — caller can `await refreshTier()` then redirect. */
  refreshTier(): Promise<void>;
};

// localStorage key for the last-known tier. Keeps the upgrade walls quiet
// across launches: a Pro user on a flaky network shouldn't flash "Free →
// upgrade" while /sync is in flight. Synchronous read on first render =
// the right tier renders on paint 1.
const TIER_CACHE_KEY = "lc:cached_tier";

const VALID_TIERS = new Set<Tier>(["free", "solo", "pro", "agency", "growth", "autopilot"]);

function readCachedTier(): Tier {
  // SSR / preview / corrupt-storage safety — anything that throws or returns
  // an unknown tier degrades to "free", which is what we'd render anyway.
  try {
    if (typeof window === "undefined" || !window.localStorage) return "free";
    const raw = window.localStorage.getItem(TIER_CACHE_KEY);
    if (raw && VALID_TIERS.has(raw as Tier)) return raw as Tier;
  } catch {
    /* swallow — storage can be blocked, full, or disabled */
  }
  return "free";
}

function writeCachedTier(t: Tier): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(TIER_CACHE_KEY, t);
  } catch {
    /* swallow */
  }
}

export function useTier(): TierState {
  // Synchronous cache read on first render — see TIER_CACHE_KEY comment.
  const [cachedTier, setCachedTier] = useState<Tier>(() => readCachedTier());
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  // Latest in-memory tier — initially the cache, replaced by /sync success.
  // We never DOWNGRADE this on transient network failure (a flaky tether
  // should not strip features mid-session).
  const inMemoryTier = useRef<Tier>(cachedTier);

  const doRefresh = useCallback(async (signal: { cancelled: boolean }) => {
    try {
      const s = await syncStatus();
      if (signal.cancelled) return;
      if (s) {
        setStatus(s);
        // Admin override — backend marks JUNIOR_ADMIN_EMAILS users as
        // admin_override=true. Force "agency" so founder demos don't trip
        // their own upgrade walls. Cache it too so cold boot before /sync
        // resolves keeps the founder view.
        const next: Tier = s.admin_override ? "agency" : s.tier;
        inMemoryTier.current = next;
        setCachedTier(next);
        writeCachedTier(next);
      }
      // s === null: backend reachable but said "no JWT yet" (unactivated).
      // Treat as a real "free" answer, not a transient failure — overwrite
      // cache so a previously-paid signed-out machine doesn't keep claiming
      // Pro after a sign-out.
      else {
        setStatus(null);
        inMemoryTier.current = "free";
        setCachedTier("free");
        writeCachedTier("free");
      }
    } catch {
      // Transient network failure — DO NOT degrade. Keep the previous
      // in-memory tier so an offline user mid-session keeps their features.
      // setStatus stays at whatever it was (null on cold boot is fine; the
      // cached tier still drives capability gating).
    } finally {
      if (!signal.cancelled) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    void doRefresh(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [doRefresh]);

  // Window focus → re-pull /sync. Covers the canonical "user came back from
  // Stripe Checkout / Whop billing in their browser" path — without this,
  // a successful upgrade only flips the UI on next manual reload.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onFocus(): void {
      const signal = { cancelled: false };
      void doRefresh(signal);
    }
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [doRefresh]);

  const refreshTier = useCallback(async (): Promise<void> => {
    const signal = { cancelled: false };
    await doRefresh(signal);
  }, [doRefresh]);

  // Prefer the freshest backend tier, then the in-memory cached tier
  // (which is also what was on disk on cold boot). Never flashes to "free"
  // on transient failure.
  const tier: Tier = status?.tier ?? inMemoryTier.current ?? cachedTier;

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
    refreshTier,
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
