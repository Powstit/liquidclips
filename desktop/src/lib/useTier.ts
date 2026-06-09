// ship-lens v0.7.7: fix #9 — switched useTier off the raw meStatus() to the legacy shim; the admin-email fallback only consumes `.email`, and the discriminated union's expired-banner UX is owned by Settings.
import { useCallback, useEffect, useRef, useState } from "react";
import { meStatusLegacy, syncStatus, type SyncStatus, type Tier } from "./backend";

// Lightweight tier hook. Defaults to a loading state on cold boot so paid
// users never flash "Free". Tier is only confirmed after /sync resolves.

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
  /** False until the first /sync call completes (success or failure).
   *  Use this to show a spinner instead of defaulting to "free" on cold boot. */
  resolved: boolean;
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

// ────────────────────────────────────────────────────────────────────────────
// Admin email fallback — defensive embed so the master account NEVER trips
// upgrade walls, even if:
//   • backend /sync hasn't redeployed yet
//   • localStorage cache is poisoned with "free" from a pre-promotion session
//   • a single endpoint forgets to honor admin_override
//
// KEEP IN SYNC with junior-backend/app/features.py `_FALLBACK_ADMIN_EMAILS`.
// Source of truth is the backend env JUNIOR_ADMIN_EMAILS; this list is the
// frontend belt-and-braces for "founder demo never breaks on a flaky deploy".
// All comparisons are case-insensitive + whitespace-tolerant.
const ADMIN_EMAIL_FALLBACK = new Set<string>([
  "danieldiyepriye@gmail.com",
  "mrddokubo@gmail.com",
  "crazycatjackkids@gmail.com",
  "thedoks2019@gmail.com",
]);

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAIL_FALLBACK.has(email.trim().toLowerCase());
}

function readCachedTier(): Tier | null {
  // SSR / preview / corrupt-storage safety — anything that throws or returns
  // an unknown tier degrades to null so the UI shows a spinner instead of
  // flashing "Free" for paid users on cold boot.
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(TIER_CACHE_KEY);
    if (raw && VALID_TIERS.has(raw as Tier)) return raw as Tier;
  } catch {
    /* swallow — storage can be blocked, full, or disabled */
  }
  return null;
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
  // Defaults to null so paid users don't flash "Free" on cold boot.
  const [cachedTier, setCachedTier] = useState<Tier | null>(() => readCachedTier());
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolved, setResolved] = useState(false);
  // Latest in-memory tier — initially the cache, replaced by /sync success.
  // We never DOWNGRADE this on transient network failure (a flaky tether
  // should not strip features mid-session).
  const inMemoryTier = useRef<Tier | null>(cachedTier);

  const doRefresh = useCallback(async (signal: { cancelled: boolean }) => {
    try {
      // Parallel: tier comes from /sync, identity from /me. We use the email
      // from /me as a defensive fallback when /sync's admin_override field
      // is missing (e.g. backend hasn't redeployed yet) — keeps the master
      // account uncapped even mid-deploy.
      const [s, me] = await Promise.all([
        syncStatus(),
        meStatusLegacy().catch(() => null),
      ]);
      if (signal.cancelled) return;
      const adminByEmail = isAdminEmail(me?.email);
      if (s) {
        setStatus(s);
        // Admin override — three signals, any one triggers agency tier:
        //   1. Backend `admin_override` field (post-redeploy)
        //   2. Backend `effective_tier === "autopilot"` (pre-existing live
        //      backend behavior — admins always get elevated here)
        //   3. Frontend `isAdminEmail(me.email)` fallback (bulletproof
        //      against any backend regression — see ADMIN_EMAIL_FALLBACK)
        const isAdmin = s.admin_override === true || adminByEmail || s.tier === "autopilot";
        const next: Tier = isAdmin ? "agency" : s.tier;
        inMemoryTier.current = next;
        setCachedTier(next);
        writeCachedTier(next);
      }
      // s === null: backend reachable but said "no JWT yet" (unactivated).
      // Treat as a real "free" answer, not a transient failure — overwrite
      // cache so a previously-paid signed-out machine doesn't keep claiming
      // Pro after a sign-out. UNLESS the email is admin — that path keeps
      // the master account uncapped even in an unactivated weird state.
      else if (adminByEmail) {
        setStatus(null);
        inMemoryTier.current = "agency";
        setCachedTier("agency");
        writeCachedTier("agency");
      }
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
      if (!signal.cancelled) {
        setLoading(false);
        setResolved(true);
      }
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
  // (which is also what was on disk on cold boot). Only fall back to "free"
  // after /sync has had a chance to resolve — prevents the "Free" flash for
  // paid users on cold boot.
  const tier: Tier = status?.tier ?? inMemoryTier.current ?? cachedTier ?? "free";

  return {
    tier,
    status,
    loading,
    resolved,
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
