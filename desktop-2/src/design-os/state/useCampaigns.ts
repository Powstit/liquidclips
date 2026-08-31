/**
 * useCampaigns · Phase 6N-B
 *
 * Shared data layer for every Campaign-aware surface:
 *   - CampaignsRoute       · discovery grid
 *   - CampaignBanner       · featured hero
 *   - CampaignPageShell    · detail page
 *   - Earn rewardClip.campaignId → Campaign lookup
 *
 * Mirrors `useCommunity` / `useRewardClips` template. Real-RPC → HTTP →
 * mock fallback (the one swap point lives in `engine/sidecar-stub.ts`).
 *
 * Visibility gating:
 *   - Campaign-level `visibility_tiers` filters out rows the caller's
 *     tier can't see at all.
 *   - Locked-with-preview campaigns (paid tier, not invite-only) stay
 *     in the list so they can be discovered; the UI badge tells the user
 *     why they can't act yet.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { campaigns as campaignsApi } from "../engine/sidecar-stub";
import { useTierCaps } from "./useTierCaps";
import { bus } from "../bridge";
import {
  applyCampaignFilter,
  type Campaign,
  type CampaignType,
  type CampaignFilterKey,
  type PlacementQuality,
} from "../campaigns/types";

type Source = "real-rpc" | "real-http" | "mock";

export interface CampaignsApi {
  campaigns: ReadonlyArray<Campaign>;
  /** Pre-filtered by visibility tier (what the caller can see at all). */
  visible: ReadonlyArray<Campaign>;
  byType: Readonly<Record<CampaignType, Campaign[]>>;
  byPlacement: Readonly<Record<PlacementQuality, Campaign[]>>;
  /** First featured-or-sponsored campaign · null when none exists. */
  featured: Campaign | null;
  loading: boolean;
  error: string | null;
  source: Source;
  reload: () => Promise<void>;
  getBySlug: (slug: string) => Campaign | null;
  getById: (id: string) => Campaign | null;
  /** Re-export the helper so consumers don't import the types module
   *  twice. Stable signature across hook versions. */
  applyFilter: (filter: CampaignFilterKey) => Campaign[];
}

/* Map useTierCaps tier → the visibility-tier string used on the backend
 * row. `clipper` collapses to `free`; rest map 1:1. */
function tierToVisibility(t: "clipper" | "pro" | "growth" | "agency"): "free" | "pro" | "agency" {
  if (t === "agency") return "agency";
  // Growth + Pro both see the "pro" campaign visibility band (Growth is
  // Pro-creator-at-scale · same campaign discovery surface). Agency stays
  // its own band so Agency-only campaigns segment cleanly.
  if (t === "pro" || t === "growth") return "pro";
  return "free";
}

/**
 * 2026-08-30 · Launch-mode override.
 *
 * When `VITE_LAUNCH_COMING_SOON=1` is baked into the build, every
 * clipper-facing campaign is coerced to status `"coming_soon"` before
 * being returned to the UI. See `lib/launchMode.ts` for the shared
 * flag reader (also used by the SponsoredReward{Card,Module,Strip}
 * surfaces to swap their $50 carrot for "Coming soon" copy).
 *
 * Agencies see their real state via `listMyCampaigns`, which does
 * NOT flow through this hook, so their admin view is unaffected.
 */
import { isLaunchComingSoonMode } from "../../lib/launchMode";

function coerceToComingSoon(list: readonly Campaign[]): Campaign[] {
  if (!isLaunchComingSoonMode()) return [...list];
  return list.map((c) =>
    c.status === "coming_soon" ? c : { ...c, status: "coming_soon" as const },
  );
}

function visibleToCaller(
  campaign: Campaign,
  callerTier: "free" | "pro" | "agency",
): boolean {
  /* Closed campaigns disappear from discovery (legacy parity with
   *  `routes/campaigns.py:list_campaigns`). Draft only for admins · we
   *  don't have admin-mode in DOS yet so hide. */
  if (campaign.status === "closed") return false;
  if (campaign.status === "draft") return false;
  /* If the tier list doesn't include caller AND the campaign requires
   *  membership, hide entirely. Otherwise keep so it can be previewed. */
  const inTierList = campaign.visibilityTiers.includes(callerTier)
    || (callerTier === "free" && campaign.visibilityTiers.includes("free"));
  if (!inTierList && campaign.requiresMembership) return false;
  return true;
}

export function useCampaigns(): CampaignsApi {
  const tier = useTierCaps();
  const callerTier = tierToVisibility(tier.tier);

  const [list, setList] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source>("mock");

  const reload = useCallback(async () => {
    setError(null);
    try {
      const r = await campaignsApi.list();
      // 2026-08-30 · launch-mode: coerce every campaign to coming_soon
      // when VITE_LAUNCH_COMING_SOON=1 (see coerceToComingSoon above).
      // No-op when the flag is off; identity-cheap.
      //
      // 2026-08-31 · BUG FIX — the doc comment above (coerceToComingSoon)
      // claims "agencies see their real state... unaffected," but that was
      // only true for AgencyCampaigns.tsx's own dashboard (listMyCampaigns).
      // Campaigns.tsx — the SHARED browse grid both clippers and agencies
      // use, and the only surface that mounts CampaignPageShell for an
      // agency to open their own live campaign and click "Post to Whop
      // marketplace" — flows through THIS hook, so the coercion was
      // silently marking an agency's own live campaigns as coming_soon
      // too, making CampaignPageShell's isPreviewOnly gate block the post
      // action for the entire launch window. Gate on callerTier instead of
      // unconditionally coercing so the doc comment's stated intent is
      // actually true: clippers see "coming soon," agencies see real state.
      setList(callerTier === "agency" ? [...r.campaigns] : coerceToComingSoon(r.campaigns));
      setSource(r.source);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      bus.emit("toast", { kind: "error", title: "Couldn't load campaigns", body: msg });
    } finally {
      setLoading(false);
    }
  }, [callerTier]);

  useEffect(() => { void reload(); }, [reload]);

  /* ============================================================
     Derived views
     ============================================================ */

  const visible = useMemo(
    () => list.filter((c) => visibleToCaller(c, callerTier)),
    [list, callerTier],
  );

  const byType = useMemo<Record<CampaignType, Campaign[]>>(() => {
    const acc: Record<CampaignType, Campaign[]> = {
      clip: [], coordination: [], affiliate: [], submission: [],
    };
    for (const c of visible) acc[c.campaignType].push(c);
    return acc;
  }, [visible]);

  const byPlacement = useMemo<Record<PlacementQuality, Campaign[]>>(() => {
    const acc: Record<PlacementQuality, Campaign[]> = {
      standard: [], featured: [], sponsored: [], category_spotlight: [],
    };
    for (const c of visible) acc[c.placementQuality].push(c);
    return acc;
  }, [visible]);

  /* Featured slot priority: featured > sponsored > category_spotlight. */
  const featured = useMemo<Campaign | null>(() => {
    return byPlacement.featured[0]
      ?? byPlacement.sponsored[0]
      ?? byPlacement.category_spotlight[0]
      ?? null;
  }, [byPlacement]);

  const getBySlug = useCallback(
    (slug: string) => list.find((c) => c.slug === slug) ?? null,
    [list],
  );
  const getById = useCallback(
    (id: string) => list.find((c) => c.id === id) ?? null,
    [list],
  );
  const applyFilter = useCallback(
    (filter: CampaignFilterKey) => applyCampaignFilter(visible, filter),
    [visible],
  );

  return {
    campaigns: list,
    visible,
    byType,
    byPlacement,
    featured,
    loading,
    error,
    source,
    reload,
    getBySlug,
    getById,
    applyFilter,
  };
}
