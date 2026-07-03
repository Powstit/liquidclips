/**
 * useTierCaps · Phase 6H · P1-1G-b real /me source
 *
 * Single source of truth for tier-driven caps + gating decisions.
 * Mirrors Phase 6G audit §12.4. Every surface (Channels · Export ·
 * Schedule · ClipCard · Campaigns) reads from here so backend and
 * client never drift.
 *
 * P1-1G-b · `useTierCaps()` now consumes `useMe()` for the canonical
 * tier source. Priority order:
 *   1. Debug override (`window.__lcDebugSetTier` · puppeteer-only)
 *   2. `useMe().snapshot.effectiveTier` when `source === "real-http"`
 *   3. `useMe().snapshot.effectiveTier` when `source === "session-cache"`
 *      (last fetch was real · /me currently degraded · still trust it)
 *   4. Fixture default ("pro") · labeled `"fixture-fallback"` (loading
 *      OR /me never returned a recognized tier OR no JWT)
 *
 * The fixture fallback is HONEST · consumers can read `source` to
 * decide whether to show "checking your tier…" copy vs gate trustingly.
 *
 * No paid-state fakery · the resolver does NOT promote fixture-tier
 * users to paid surfaces · the consumers that need a HARD paid gate
 * (e.g. Campaigns "Create campaign" CTA) read `source` and only allow
 * the gate to open when `source` is real-http or session-cache.
 */

import { useEffect, useMemo, useState } from "react";
import { useMe } from "./useMe";

// 2026-06-23 — Daniel's monetisation pass: tier ladder is now
// Free Clipper ($0) → Pro ($29) → Growth ($79) → Agency ($500).
// "growth" was previously aliased to "pro" caps, which collapsed real $79
// subscribers down to Pro entitlements. Each tier now has its own row.
export type Tier = "clipper" | "pro" | "growth" | "agency";

export interface TierCaps {
  /** Total connected channel slots across all platforms. */
  totalChannels: number;
  /** Connected channels per platform. */
  perPlatformChannels: number;
  /** Brands / workspaces. */
  brands: number;
  /** Campaigns per brand. */
  campaignsPerBrand: number;
  /** Clips per campaign. */
  clipsPerCampaign: number;
  /** Scheduled posts per month. */
  monthlyPosts: number;
  /** Accounts targeted per clip (mirrors ACCOUNTS_PER_CLIP_CAP in export/types). */
  accountsPerClip: number;
  /** Bulk-scheduling rows per action ("Infinity" = unlimited). */
  bulkSchedulingRows: number;
  /** Campaign account templates available? */
  campaignAccountTemplates: boolean;
  /** Watermark forced on? */
  watermarkLocked: boolean;
  /** Priority queue lane? */
  priorityQueue: boolean;
  /** Hosted AI compute lane (transcribe + proxy_llm). Growth/Agency only. */
  hostedAICompute: boolean;
  /** Can the user CREATE + PUBLISH campaigns? Agency-only commit gate. */
  canPublishCampaigns: boolean;
  /** Auto-retry depth. */
  autoRetryDepth: number;
  /** Posting-history retention days. */
  historyRetentionDays: number;
  /** Analytics access tier · "urls" | "engagement" | "engagement-plus" | "rollups". */
  analyticsAccess: "urls" | "engagement" | "engagement-plus" | "rollups";
}

export const TIER_CAPS: Record<Tier, TierCaps> = {
  clipper: {
    // 2026-06-23 · Daniel: "Free tier gets 1 connected social account
    // included. The 2nd connected account triggers the $6/mo accountpack
    // CTA." Cap dropped 2 → 1. The accountpack purchase grants +1
    // additional channel slot via /me.extra_accounts_purchased; PlanLimitStrip
    // surfaces the CTA when used >= cap on clipper.
    totalChannels: 1,
    perPlatformChannels: 1,
    brands: 1,
    campaignsPerBrand: 1,
    clipsPerCampaign: 10,
    monthlyPosts: 25,
    accountsPerClip: 1,
    bulkSchedulingRows: 1,
    campaignAccountTemplates: false,
    watermarkLocked: true,
    priorityQueue: false,
    hostedAICompute: false,
    canPublishCampaigns: false,
    autoRetryDepth: 3,
    historyRetentionDays: 30,
    analyticsAccess: "urls",
  },
  pro: {
    totalChannels: 5,
    perPlatformChannels: 3,
    brands: 1,
    campaignsPerBrand: 5,
    clipsPerCampaign: 50,
    monthlyPosts: 250,
    accountsPerClip: 3,
    bulkSchedulingRows: 25,
    campaignAccountTemplates: false,
    watermarkLocked: false,
    priorityQueue: false,
    hostedAICompute: false,
    canPublishCampaigns: false,
    autoRetryDepth: 3,
    historyRetentionDays: 90,
    analyticsAccess: "engagement",
  },
  // Daniel's 2026-06-23 monetisation pass: $79 Growth tier sits between
  // Pro and Agency. Growth's job is to be the "Pro creator at scale" rung
  // — faster + bigger + hosted AI lane, without unlocking agency-grade
  // multi-brand or campaign-publish. Numbers chosen to make the Pro→Growth
  // step feel like a real capacity uplift (3× posts, 2× channels, 3×
  // bulk rows, 2× retention).
  growth: {
    totalChannels: 10,
    perPlatformChannels: 4,
    brands: 2,
    campaignsPerBrand: 10,
    clipsPerCampaign: 100,
    monthlyPosts: 750,
    accountsPerClip: 5,
    bulkSchedulingRows: 75,
    campaignAccountTemplates: false,
    watermarkLocked: false,
    priorityQueue: true,
    hostedAICompute: true,
    canPublishCampaigns: false,
    autoRetryDepth: 5,
    historyRetentionDays: 180,
    analyticsAccess: "engagement-plus",
  },
  agency: {
    totalChannels: 15,
    perPlatformChannels: 5,
    brands: 5,
    campaignsPerBrand: 20,
    clipsPerCampaign: 200,
    monthlyPosts: 2500,
    accountsPerClip: 10,
    bulkSchedulingRows: Infinity,
    campaignAccountTemplates: true,
    watermarkLocked: false,
    priorityQueue: true,
    hostedAICompute: true,
    canPublishCampaigns: true,
    autoRetryDepth: 5,
    historyRetentionDays: 365,
    analyticsAccess: "rollups",
  },
};

export type CurrentUsage = {
  connectedChannels: number;
  connectedPerPlatform: Record<string, number>;
  scheduledThisMonth: number;
  accountsTargetedForActiveClip: number;
};

/** P1-1G-b · honesty label · where the rendered tier came from.
 *
 *  - `real-http`          · `/me` returned a recognized tier this session
 *  - `session-cache`      · prior real fetch · /me currently degraded · trusted
 *  - `fixture-fallback`   · DEPRECATED (Batch 3D of Step 3) · retained on the
 *                           type union for one compat release so downstream
 *                           consumers that switch on it still typecheck,
 *                           but the resolver no longer produces it.
 *  - `unavailable`        · Batch 3D of Step 3 · no usable snapshot AND no
 *                           QA hatch · tier falls to the most restrictive
 *                           row (`clipper`) so gates fail closed. Consumers
 *                           should render "checking your account…" copy
 *                           and refuse to unlock paid surfaces.
 *  - `unknown`            · no JWT · activation hasn't happened
 *  - `debug-override`     · `window.__lcDebugSetTier` fired (puppeteer-only) */
export type TierSource =
  | "real-http"
  | "session-cache"
  | "fixture-fallback"
  | "unavailable"
  | "unknown"
  | "debug-override";

export interface TierContext {
  tier: Tier;
  caps: TierCaps;
  usage: CurrentUsage;
  /** P1-1G-b · where this tier value came from. Consumers needing a
   *  hard paid gate (e.g. agency campaign creation) should only open
   *  the gate when source is `"real-http"` or `"session-cache"`. */
  source: TierSource;
  /** True when /me is currently fetching · consumers can show a quiet
   *  "checking…" pill instead of acting on the fallback. */
  loading: boolean;
  /** True when /me reported the user has admin allowlist · the
   *  effective tier is already elevated server-side.
   *  2026-07-03 · Step 2 batch 2f · DEPRECATED for new gates. Prefer
   *  `capabilities` + `hasCapability(caps, CAP.X)` from
   *  `lib/authz/capabilities.ts`. This field remains for one compat
   *  release so unmigrated gates keep working. */
  adminOverride: boolean;
  /** 2026-07-03 · Step 2 batch 2f · server-authoritative capability
   *  list from the /me projection. Closed-registry strings (see
   *  `lib/authz/capabilities.ts` CAP). New UI gates read this via
   *  `hasCapability(capabilities, CAP.X)` instead of tier equality. */
  capabilities: string[];
  /** 2026-07-03 · Step 2 batch 2f · server-authoritative platform role. */
  platformRole: "none" | "staff" | "admin" | null;
  /** True when the user has hit the cap for a given limit. */
  isAtCap: (limit: keyof TierCaps) => boolean;
  /** Suggest the next tier that unlocks a feature, or null if already max. */
  nextTierFor: (feature: keyof TierCaps) => Tier | null;
  /** Imperative setter for the simulator only — real tier comes from billing. */
  _setTier: (t: Tier) => void;
}

/** 2026-07-03 · Step 3 batch 3d · honest empty-state defaults.
 *  Before: fabricated `connectedChannels: 4, scheduledThisMonth: 42`
 *  which silently told a brand-new account "you already have 4
 *  channels connected". After: zeros so a fresh install renders a
 *  legitimate empty state. Real usage rides in from /me when the
 *  hook has a live snapshot; this constant is the pre-snapshot floor. */
const EMPTY_USAGE: CurrentUsage = {
  connectedChannels: 0,
  connectedPerPlatform: { tiktok: 0, instagram: 0, youtube: 0 },
  scheduledThisMonth: 0,
  accountsTargetedForActiveClip: 0,
};

/** 2026-07-03 · Step 3 batch 3d · QA hatch replacing the old
 *  Phase-6H `SIMULATOR_DEFAULT_TIER = "pro"` production fallback.
 *  Only fires when the Vite build carries `VITE_LC_QA=true` (playwright
 *  screenshots, QA runs) so a real production build cannot silently
 *  grant Pro caps on a missing /me. In production the resolver returns
 *  the `unavailable` source + the most restrictive tier (`clipper`),
 *  which fails every paid gate closed. */
function qaHatchTier(): Tier | null {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const env = (import.meta as any).env ?? {};
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const qaFlag = env.VITE_LC_QA === true || env.VITE_LC_QA === "true";
    if (qaFlag) return "pro";
  } catch {
    /* import.meta.env not available (jest node env) — no QA hatch */
  }
  return null;
}

/* Module-level subscriber list · dev-only window hook can push a tier
 *  switch into every mounted useTierCaps instance. Lets puppeteer
 *  screenshots demo the "locked" surface without manual tier UI.
 *  BUG-036 · accepts `null` so harness can CLEAR the override and let
 *  the natural /me-driven path drive tier resolution. */
const tierSubscribers = new Set<(t: Tier | null) => void>();
declare global {
  interface Window {
    __lcDebugSetTier?: (t: Tier | null) => void;
  }
}
if (typeof window !== "undefined" && !window.__lcDebugSetTier) {
  window.__lcDebugSetTier = (t: Tier | null) => {
    for (const fn of tierSubscribers) fn(t);
  };
}

/* ─── P1-1G-c · source-aware gating helpers ─────────────────────────── */

/** A tier source is "trusted" when it came from the backend within this
 *  session (live or cached). Fixture-fallback / unknown / debug-override
 *  must NOT unlock paid or agency write actions. */
export function isTrustedTierSource(source: TierSource): boolean {
  return source === "real-http" || source === "session-cache";
}

/** True only when the user has agency tier AND that tier came from a
 *  trusted source. The debug-override path returns false here because
 *  puppeteer screenshots should not write campaign rows in production.
 *  Use this for any agency WRITE action (create / publish / manage). */
export function canUseAgencyActions(ctx: { tier: Tier; source: TierSource }): boolean {
  return ctx.tier === "agency" && isTrustedTierSource(ctx.source);
}

/** Maps the backend's `/me.effective_tier` string to the UI's narrower
 *  `Tier` enum. Backend exposes the v2 names directly post-Phase-6N
 *  (`agency`/`autopilot` · `pro` · `growth` · `solo` · `free`/
 *  `starter`/`clipper`). We match both v1 + v2 spellings to be safe.
 *  Returns null when the string doesn't match anything we recognize ·
 *  consumer falls back to the fixture default.
 *
 *  2026-06-23 — `growth` no longer collapses to `pro`. The $79 Clerk
 *  Growth plan now resolves to its own tier with its own caps row in
 *  TIER_CAPS.growth above. Solo/channel legacy aliases continue to map
 *  to pro for backwards-compat with older Clerk plan slugs. */
function mapBackendTier(raw: string | null | undefined): Tier | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  // 2026-07-02 · Sprint D · include the three new agency-family tiers.
  // All three collapse to the "agency" client tier so the caps table
  // (TIER_CAPS.agency) applies uniformly; per-sub-tier cap differences
  // land in a later sprint when the client cares about the split.
  if (
    t === "agency"
    || t === "autopilot"
    || t === "agency_solo"
    || t === "agency_whitelabel"
  ) return "agency";
  if (t === "growth") return "growth";
  if (t === "pro" || t === "channel" || t === "solo") return "pro";
  if (t === "free" || t === "starter" || t === "clipper") return "clipper";
  return null;
}

export function useTierCaps(): TierContext {
  const me = useMe();

  /* Debug-override layer · puppeteer-only · always wins when set.
   * Preserves the Phase 6H test seam (`window.__lcDebugSetTier`). */
  const [debugOverride, setDebugOverride] = useState<Tier | null>(null);
  useEffect(() => {
    tierSubscribers.add(setDebugOverride);
    return () => { tierSubscribers.delete(setDebugOverride); };
  }, []);

  /* Resolve tier + source per the priority order in the module doc. */
  const resolved = useMemo<{ tier: Tier; source: TierSource; adminOverride: boolean }>(() => {
    if (debugOverride) {
      return { tier: debugOverride, source: "debug-override", adminOverride: false };
    }
    const snap = me.snapshot;
    if (snap && (me.source === "real-http" || me.source === "session-cache")) {
      const mapped = mapBackendTier(snap.effectiveTier);
      if (mapped) {
        return {
          tier: mapped,
          source: me.source,
          adminOverride: snap.adminOverride === true,
        };
      }
      // Snapshot present but tier unrecognized · fail closed to
      // `unavailable` + `clipper` (most restrictive) so a corrupt
      // backend response can't accidentally unlock paid surfaces.
      // 2026-07-03 · Step 3 batch 3d · replaces the old
      // SIMULATOR_DEFAULT_TIER = "pro" silent grant.
      const hatch = qaHatchTier();
      if (hatch) return { tier: hatch, source: "debug-override", adminOverride: false };
      return { tier: "clipper", source: "unavailable", adminOverride: false };
    }
    /* No usable snapshot ·
     *   - me.source === "unknown" AND no snapshot → no JWT or never fetched
     *   - me.source === "session-cache" AND no snapshot → impossible by design
     *   - any source AND degraded with no prior snapshot → unavailable
     * Distinguish "no JWT" (label `"unknown"` so route gating can pick it up)
     * from "JWT but /me hasn't returned yet" (label `"unavailable"` so gates
     * fail closed instead of silently granting Pro).
     * 2026-07-03 · Step 3 batch 3d · both branches drop from "pro"
     * silent grant to "clipper" + honest source label. QA runs
     * (VITE_LC_QA=true) still see "pro" via the qaHatchTier() escape. */
    const hatch = qaHatchTier();
    if (hatch) {
      return { tier: hatch, source: "debug-override", adminOverride: false };
    }
    if (me.source === "unknown" && !snap) {
      return { tier: "clipper", source: "unknown", adminOverride: false };
    }
    return { tier: "clipper", source: "unavailable", adminOverride: false };
  }, [debugOverride, me.source, me.snapshot]);

  const tier = resolved.tier;
  const source = resolved.source;
  const adminOverride = resolved.adminOverride;
  // 2026-07-03 · Step 3 batch 3d · usage falls back to empty (all zeros)
  // when there's no live snapshot so a fresh install renders an honest
  // empty state instead of fabricating "4 channels, 42 posts". Real
  // usage comes in from /me / /sync once activation lands (batches 4-6
  // wire the transport).
  const usage = EMPTY_USAGE;
  const caps = TIER_CAPS[tier];
  const loading = me.loading;
  // Step 2 batch 2f · pass the server-authoritative capability list
  // + platform role through to consumers so new gates can bypass tier
  // inference entirely. Defaults preserve current behaviour when /me
  // hasn't returned (empty caps list → hasCapability() returns false →
  // gates stay closed unless the legacy adminOverride path opens them).
  const capabilities = me.snapshot?.capabilities ?? [];
  const platformRole = me.snapshot?.platformRole ?? null;

  return useMemo<TierContext>(() => {
    const isAtCap = (limit: keyof TierCaps): boolean => {
      const value = caps[limit];
      if (typeof value !== "number") return false;
      switch (limit) {
        case "totalChannels":     return usage.connectedChannels >= value;
        case "monthlyPosts":      return usage.scheduledThisMonth >= value;
        case "accountsPerClip":   return usage.accountsTargetedForActiveClip >= value;
        default:                  return false;
      }
    };
    const nextTierFor = (feature: keyof TierCaps): Tier | null => {
      const order: Tier[] = ["clipper", "pro", "growth", "agency"];
      const idx = order.indexOf(tier);
      for (let i = idx + 1; i < order.length; i++) {
        const next = order[i];
        const target = TIER_CAPS[next][feature];
        const current = TIER_CAPS[tier][feature];
        if (typeof target === "number" && typeof current === "number" && target > current) return next;
        if (typeof target === "boolean" && target !== current) return next;
      }
      return null;
    };
    return {
      tier,
      caps,
      usage,
      source,
      loading,
      adminOverride,
      capabilities,
      platformRole,
      isAtCap,
      nextTierFor,
      _setTier: setDebugOverride,
    };
  }, [tier, caps, usage, source, loading, adminOverride, capabilities, platformRole]);
}
