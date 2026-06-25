/**
 * Liquid Clips · Banner Registry · Stage A consolidation (locked 2026-06-25)
 *
 * A reward banner is a PRODUCT SURFACE, not an image file. The asset
 * registry (`assetRegistry.ts`) catalogues files. This file catalogues
 * the banner concepts that wrap those files with copy, CTA, route
 * placement, mode gating, and state.
 *
 * Stage A scope:
 *   · Inventory + structured manifest. No wiring changes.
 *   · No new banners. No deletions of existing banners.
 *   · Surfaces the duplication map so Stage B can pick a canonical
 *     reward banner without losing the variants.
 *
 * Source-of-truth references (consolidated, not re-audited):
 *   · desktop-2/src/design-os/components/HomeBanner.tsx
 *   · desktop-2/src/design-os/earn/SponsoredRewardStrip.tsx
 *   · desktop-2/src/design-os/earn/SponsoredRewardModule.tsx
 *   · desktop-2/src/design-os/earn/SponsoredRewardCard.tsx
 *   · desktop-2/src/design-os/earn/sponsoredReward.ts (canonical
 *     constants: $50 / 5,000 views / 5 affiliates / 5% fee / $10 min)
 *   · desktop-2/src/design-os/campaigns/CampaignBanner.tsx
 *   · desktop-2/src/design-os/community/CommunityBanner.tsx
 *   · desktop-2/src/components/paywall/AgencyPreviewBanner.tsx
 *   · desktop-2/src/design-os/agency-creation/WhopRewardCard.tsx
 *   · desktop-2/src/components/home/SponsoredBannerCarousel.tsx (LC2
 *     port — not mounted in any current route, status: candidate)
 *   · desktop-2/docs/campaign-banner-generation-audit.md (locked
 *     marketplace rectangle template — spec, no component yet)
 *   · desktop/src/components/BrowseRewardsPanel.tsx (legacy)
 *   · desktop/src/components/PoweredByWhop.tsx (legacy attribution)
 */

import type { AssetEntry } from "./assetRegistry";
import { getAssetById } from "./assetRegistry";

/* ──────────────────────────────────────────────────────────────────
 * Types
 * ────────────────────────────────────────────────────────────────── */

/**
 * Banner taxonomy (Daniel-locked 2026-06-25).
 *
 *   home-product    — promotes a product capability or workflow
 *                     (e.g. "browse Whop without leaving the app").
 *   sponsored-reward— surfaces a paid/reward opportunity to clippers
 *                     (the $50 Sponsored Reward, $50 bonus, etc.).
 *   campaign        — represents an agency/creator campaign (the
 *                     marketplace rectangle: brand, RPM, status).
 *   earn-progress   — shows earnings/reward progress · MUST route to
 *                     Whop for actual payout/withdrawal in v1.
 *   agency-preview  — paywall-style banner for non-Agency users in
 *                     Agency Preview mode.
 *   community       — sidecar-driven community top-banner placement.
 *   legacy          — preserved from the old app · not actively wired
 *                     (so the copy/art isn't lost).
 */
export type BannerType =
  | "home-product"
  | "sponsored-reward"
  | "campaign"
  | "earn-progress"
  | "agency-preview"
  | "community"
  | "legacy";

export type BannerStatus = "active" | "candidate" | "legacy" | "missing";

export type BannerMode = "clipper" | "agency" | "both";

export interface BannerRecord {
  /** Stable id used by helpers + Stage B wiring. */
  id: string;
  type: BannerType;
  /** Short product-side label. */
  displayName: string;
  /** Primary headline / canonical title copy actually shown to users
   *  (paraphrased when the component reads dynamic state). */
  title: string;
  /** One-line sub-copy or value prop, when the banner has one. */
  subCopy?: string;
  /** Eyebrow / kicker label (above the title). */
  eyebrow?: string;
  /** Primary CTA label. May be dynamic — captured here as the canonical
   *  shown-form. */
  cta: string;
  /** Asset registry ids this banner consumes (resolves via
   *  `getAssetById`). Helpers below validate these resolve. */
  assetIds: readonly string[];
  /** Route family where the banner mounts. `null` = chrome-level
   *  (every design-os route, e.g. AgencyPreviewBanner). */
  intendedRoute: string | null;
  mode: BannerMode;
  status: BannerStatus;
  /** Component file (relative to desktop-2/) currently rendering this
   *  banner. `null` when there's no component yet (spec-only banners). */
  currentComponent: string | null;
  /** Mount sites — `file:line` where the component is rendered. */
  mountSites: readonly string[];
  /** Banner id (within this registry) that this entry duplicates, OR
   *  shares a state machine / concept with. `null` when unique. */
  duplicatesOf?: string | null;
  /** Stage B / future canonical placement direction. */
  recommendedPlacement?: string;
  /** Notes — gotchas, iron gates, copy-lock contracts. */
  notes?: string;
}

/* ──────────────────────────────────────────────────────────────────
 * Records
 *
 * Group order: home/product → sponsored-reward → campaign → earn-progress
 * → agency-preview → community → legacy.
 * ────────────────────────────────────────────────────────────────── */

const RECORDS: readonly BannerRecord[] = [
  /* ----- 1 · Home / Product banner ---------------------------------- */
  {
    id: "banner.home.whop-browse",
    type: "home-product",
    displayName: "Home · Whop browse promo",
    title: "Stack paid Whop skills without leaving the app.",
    subCopy:
      "Scout skills in-app · Copy URL or Use in Engine pulls them straight into Create Clips. No tabs, no juggling.",
    eyebrow: "RUNTIME UPDATE TEST · v2.3.1",
    cta: "Browse Whop",
    assetIds: ["kade.celebration"],
    intendedRoute: "home",
    mode: "clipper",
    status: "active",
    currentComponent: "src/design-os/components/HomeBanner.tsx",
    mountSites: ["src/design-os/routes/CommandRoom.tsx:86"],
    notes:
      "Added 2026-06-24. The eyebrow currently doubles as a runtime " +
      "update test marker ('RUNTIME UPDATE TEST · v2.3.1') — Stage B " +
      "should split that into a real eyebrow vs a debug marker so the " +
      "production copy stays clean.",
  },

  /* ----- 2 · Sponsored Reward · 3 surface variants ------------------ *
   * All three are driven by the SAME state machine
   * (`useActivationBonus`) and the SAME canonical constants in
   * `sponsoredReward.ts` ($50 / 5,000 views / 5 affiliates / 5% fee /
   * $10 min withdraw). Intentional 3-surface presentation per the
   * Sovereign-2.2 IRON GATE. Stage B should pick ONE canonical
   * source of truth (recommendation below) without deleting the
   * presentation variants.
   * ----------------------------------------------------------------- */
  {
    id: "banner.sponsored-reward.module",
    type: "sponsored-reward",
    displayName: "Sponsored Reward · full module",
    title: "Claim your $50",
    subCopy:
      "Activation bonus · 5,000 authenticated views OR 5 paying-sub referrals · $50 USD net of 5% protocol fee · $10 minimum withdrawal · payout via Whop / Sui USDC rail.",
    eyebrow: "Sponsored Reward · activation bonus",
    cta: "View rules · withdraw on Earn",
    assetIds: ["intro.intro-splash"], // MP4 banner: /brand/intro/intro-splash.mp4
    intendedRoute: "earn",
    mode: "clipper",
    status: "active",
    currentComponent: "src/design-os/earn/SponsoredRewardModule.tsx",
    mountSites: ["src/design-os/routes/Earn.tsx:202"],
    recommendedPlacement:
      "CANONICAL · keep on Earn as the full dashboard. Strip + Card " +
      "above are entry points that deep-link here.",
    notes:
      "IRON GATE IG-SOV-2.2-001 · Sponsored Reward Rules. Changing " +
      "amount/threshold/fee/min-withdraw requires explicit override " +
      "in the same turn. Honest copy contract: pending money is NOT " +
      "withdrawable, subscription is NOT paid from the bonus, payout " +
      "is NOT promised before clearance.",
  },
  {
    id: "banner.sponsored-reward.strip",
    type: "sponsored-reward",
    displayName: "Sponsored Reward · home strip",
    title: "$50 bonus",
    subCopy: "{viewCount} / 5,000 views — status pill reflects state machine.",
    eyebrow: "SPONSORED REWARD",
    cta: "→ Open on Earn",
    assetIds: [],
    intendedRoute: "home",
    mode: "clipper",
    status: "active",
    currentComponent: "src/design-os/earn/SponsoredRewardStrip.tsx",
    mountSites: ["src/design-os/routes/CommandRoom.tsx:141"],
    duplicatesOf: "banner.sponsored-reward.module",
    recommendedPlacement:
      "Keep as the Home teaser — but per Phase 1 journey review, it " +
      "currently duplicates the 'Track Earnings' tile target. Stage B " +
      "should pick ONE Earn entry on Home (tile OR strip), not both.",
  },
  {
    id: "banner.sponsored-reward.card",
    type: "sponsored-reward",
    displayName: "Sponsored Reward · campaign-grid card",
    title: "Claim your $50",
    subCopy: "per 5,000 views · sponsored reward variant of the campaign grid.",
    eyebrow: "Sponsored Reward",
    cta: "Open on Earn",
    assetIds: ["intro.intro-splash"], // same MP4 banner as the module
    intendedRoute: "campaigns",
    mode: "clipper",
    status: "active",
    currentComponent: "src/design-os/earn/SponsoredRewardCard.tsx",
    mountSites: ["src/design-os/routes/Campaigns.tsx:280"],
    duplicatesOf: "banner.sponsored-reward.module",
    recommendedPlacement:
      "Keep ONLY if Campaigns ever serves clippers (per the journey " +
      "lens, Campaigns is becoming agency-only). If Campaigns goes " +
      "agency-only post-Phase 5, this card should be cut — clippers " +
      "see the Sponsored Reward on Home strip + Earn module instead.",
  },

  /* ----- 3 · Campaign banner ---------------------------------------- */
  {
    id: "banner.campaign.featured",
    type: "campaign",
    displayName: "Campaign · featured hero",
    title: "{campaign.title}",
    subCopy: "{campaign.subtitle}",
    eyebrow: "{placement} · {campaignType}",
    cta: "View campaign →",
    assetIds: [], // dynamic: campaign.featuredThumbUrl or campaign.bannerUrl
    intendedRoute: "campaigns",
    mode: "both",
    status: "active",
    currentComponent: "src/design-os/campaigns/CampaignBanner.tsx",
    mountSites: ["src/design-os/routes/Campaigns.tsx:255"],
    notes:
      "Featured-slot banner. Reads Campaign.featuredThumbUrl || " +
      "bannerUrl. Renders nothing when no featured campaign exists " +
      "(no fake hero). Shows payoutLine + rewardPoolCents + " +
      "deadlineLabel + Whop-snapshot pill when applicable.",
  },
  {
    id: "banner.campaign.marketplace-rectangle",
    type: "campaign",
    displayName: "Campaign · marketplace rectangle (LOCKED SPEC)",
    title: "{campaign.title}",
    subCopy: "{$RPM} RPM · {fundedPill | rewardLinkedPill}",
    cta: "Open campaign · Open in Whop",
    assetIds: [
      "logo.glyph",
      "logo.wordmark",
      "logo.made-with",
      // platform pills come from /brand/decks/ — registered as deck.* entries
    ],
    intendedRoute: "campaigns",
    mode: "both",
    status: "missing",
    currentComponent: null,
    mountSites: [],
    notes:
      "Specced + locked in docs/campaign-banner-generation-audit.md " +
      "(2026-06-19). 16:9 or 3:2 landscape rectangle, deterministic " +
      "Liquid Clips frame + AI-generated background-only, dynamic " +
      "fields: RPM / company logo / platform pills / status pill / " +
      "'Powered by Whop' pill / LC watermark. Spec exists; no React " +
      "component implements it yet. Stage B candidate — when wired, " +
      "this should be the unified surface for every agency campaign " +
      "card (cuts duplication between CampaignCard + CampaignBanner).",
  },

  /* ----- 4 · Earn / Progress banner --------------------------------- */
  {
    id: "banner.earn-progress.home-pill",
    type: "earn-progress",
    displayName: "Home · earn progress pill",
    title: "{earnedUsd} earned · {pendingUsd} pending · via Whop",
    cta: "→ Open Earn",
    assetIds: [],
    intendedRoute: "home",
    mode: "clipper",
    status: "active",
    currentComponent: "src/design-os/routes/CommandRoom.tsx (inline)",
    mountSites: ["src/design-os/routes/CommandRoom.tsx (lc-home-earn button)"],
    duplicatesOf: "banner.sponsored-reward.strip", // both surface earn state on home
    notes:
      "Per BUG-040, derived from `useEarnSummary()` so it never lies " +
      "to the customer. 'via Whop' suffix enforces the v1 rule: " +
      "Whop owns payout, Liquid Clips does not natively pay.",
    recommendedPlacement:
      "Per Phase 1 journey review, this pill duplicates the " +
      "'Track Earnings' tile target. Pick ONE entry on Home.",
  },

  /* ----- 5 · Agency Preview banner ---------------------------------- */
  {
    id: "banner.agency-preview",
    type: "agency-preview",
    displayName: "Agency Preview Mode banner",
    title:
      "Build your campaign now. Upgrade to Agency to launch, publish, invite clients, and activate rewards.",
    subCopy:
      "You can draft and preview campaigns for free. Payment is only required when you launch.",
    eyebrow: "Agency Preview Mode",
    cta: "Upgrade to {agencyPlan.displayName} · ${agencyPlan.priceMonthlyUsd}/mo",
    assetIds: [],
    intendedRoute: null, // chrome — every design-os route
    mode: "agency",
    status: "active",
    currentComponent: "src/components/paywall/AgencyPreviewBanner.tsx",
    mountSites: ["src/design-os/components/AppShell.tsx:73"],
    notes:
      "Renders nothing in clipper mode. For Agency users (tier == " +
      "'agency') collapses to a small 'Agency active' pill instead " +
      "of the full banner. Fires inbox notification once per browser " +
      "via lc.agency-preview.seen.v1.",
  },

  /* ----- 6 · Community banner --------------------------------------- */
  {
    id: "banner.community.top",
    type: "community",
    displayName: "Community · top banner",
    title: "{banner.title}",
    subCopy: "{banner.subtitle}",
    eyebrow: "From the team",
    cta: "{banner.ctaLabel | default open URL}",
    assetIds: [], // dynamic: banner.imageUrl from sidecar
    intendedRoute: "community",
    mode: "both",
    status: "active",
    currentComponent: "src/design-os/community/CommunityBanner.tsx",
    mountSites: ["src/design-os/routes/Community.tsx:108"],
    notes:
      "Consumes useCommunity().communityTopBanners (placement = " +
      "'community_top'). Renders nothing when empty (no fake content).",
  },

  /* ----- 7 · Whop Reward Card (read-only snapshot) ------------------ */
  {
    id: "banner.whop-reward-card",
    type: "campaign",
    displayName: "Whop reward snapshot card",
    title: "{rewardId or 'Unlinked'}",
    subCopy: "{rewardState label — 11 honest states}",
    eyebrow: "Whop reward",
    cta: "Refresh snapshot · Copy reward id",
    assetIds: [],
    intendedRoute: "campaigns",
    mode: "both",
    status: "active",
    currentComponent: "src/design-os/agency-creation/WhopRewardCard.tsx",
    mountSites: [
      "src/design-os/agency-creation/steps.tsx:218 (Step 1 preview)",
      "src/design-os/agency-creation/steps.tsx:1031 (Step 8 review)",
      "src/design-os/campaigns/CampaignPageShell.tsx:263 (clipper-facing)",
    ],
    notes:
      "Read-only snapshot of a Whop reward. 11 honest states — " +
      "unlinked, pending_reward, connected, live, funded, " +
      "partially_funded, capacity_reached, closed, unreachable, " +
      "not_visible, stale. Snapshot copy is URL-first ('via Whop " +
      "snapshot') so the agency / clipper never confuses what we " +
      "know directly vs what we pulled from enrichment.",
  },

  /* ----- 8 · Legacy / pre-LC2 ports --------------------------------- */
  {
    id: "banner.legacy.sponsored-banner-carousel",
    type: "legacy",
    displayName: "Sponsored Banner Carousel (LC2 port · not mounted)",
    title: "Sponsored campaign carousel — 4:1 long-rectangle slots, auto-advance every 6s",
    subCopy:
      "Instant code-based hero card always paints first; branded reward campaigns render as a wide horizontal carousel below.",
    eyebrow: "Sponsored campaigns",
    cta: "Open campaign · external Whop link",
    assetIds: [], // dynamic, fixture-driven via loadSampleCampaigns()
    intendedRoute: "home",
    mode: "clipper",
    status: "candidate", // LC2 port file exists, no current route mounts it
    currentComponent: "src/components/home/SponsoredBannerCarousel.tsx",
    mountSites: [],
    duplicatesOf: "banner.home.whop-browse",
    notes:
      "Ported from desktop/src/components/earn/SponsoredBannerCarousel.tsx " +
      "(v0.7.77 SECTION C1) but never wired into any desktop-2 route. " +
      "Has 4:1 slot template, instant-paint hero card, sample-campaign " +
      "cache (lc:home:sample-campaigns:v1, 15-min TTL), tier visibility " +
      "filtering. Either revive on Home/Earn or formally retire. Today " +
      "it's dead code — the LC2 home uses HomeBanner (single card) " +
      "instead of a carousel.",
    recommendedPlacement:
      "Stage B decision needed: (a) wire on Home as a richer alternative " +
      "to HomeBanner, or (b) delete. The marketplace rectangle template " +
      "spec (banner.campaign.marketplace-rectangle) supersedes the " +
      "carousel concept if wired as a single hero + grid pattern.",
  },
  {
    id: "banner.legacy.browse-rewards-panel",
    type: "legacy",
    displayName: "Browse Rewards panel (legacy desktop)",
    title: "Browse Whop · Clipping.net · Klipy · Opus.pro",
    subCopy:
      "Save this page as a campaign · Copy URL to clipboard · Browse content rewards across platforms.",
    cta: "Save campaign · Copy URL · Open external",
    assetIds: [],
    intendedRoute: "browse-overlay",
    mode: "clipper",
    status: "legacy",
    currentComponent: "desktop/src/components/BrowseRewardsPanel.tsx",
    mountSites: ["(legacy desktop only — not present in desktop-2)"],
    notes:
      "Legacy desktop panel that browsed multiple reward platforms " +
      "(Whop, Clipping.net, Klipy, Opus.pro) with save-as-campaign + " +
      "copy-URL actions. In desktop-2 this UX folded into BrowseOverlay " +
      "(top-bar Copy URL + Use in Engine) — the multi-platform browse-row " +
      "concept did NOT port. Preserved here so Stage B has the option " +
      "of restoring it as a banner / panel inside the in-app browser.",
    recommendedPlacement:
      "Candidate for BrowseOverlay header — a row of 'browse Whop / " +
      "Clipping.net / Klipy / Opus.pro' quick-chips. Currently the " +
      "Quick row only has Whop targets.",
  },
  {
    id: "banner.legacy.powered-by-whop",
    type: "legacy",
    displayName: "Powered by Whop attribution badge (legacy)",
    title: "powered by whop",
    cta: "Open Whop · external",
    assetIds: [], // wordmark glyph rendered inline as SVG in the legacy component
    intendedRoute: null,
    mode: "both",
    status: "legacy",
    currentComponent: "desktop/src/components/PoweredByWhop.tsx",
    mountSites: ["(legacy desktop only — not ported to desktop-2)"],
    notes:
      "Legacy attribution badge. Required by the campaign-banner-" +
      "generation-audit lock (2026-06-19): 'Powered by Whop pill — " +
      "always present when the campaign has a Whop reward connected.' " +
      "Today the desktop-2 Whop-attribution copy lives inline in " +
      "WhopRewardCard (state labels say 'via Whop snapshot') but " +
      "there's no atomic 'powered by whop' badge component. Stage B " +
      "candidate when the marketplace rectangle template is wired.",
    recommendedPlacement:
      "Port to desktop-2 as a reusable atom <PoweredByWhop /> " +
      "consumed by: marketplace-rectangle campaign banner, " +
      "WhopRewardCard, Whop bounty rows, OAuth sign-in surface.",
  },
];

/* ──────────────────────────────────────────────────────────────────
 * Public exports
 * ────────────────────────────────────────────────────────────────── */

export const BANNER_REGISTRY: readonly BannerRecord[] = RECORDS;

export function getBannerById(id: string): BannerRecord | undefined {
  return RECORDS.find((b) => b.id === id);
}

export function listByType(type: BannerType): readonly BannerRecord[] {
  return RECORDS.filter((b) => b.type === type);
}

export function listByStatus(status: BannerStatus): readonly BannerRecord[] {
  return RECORDS.filter((b) => b.status === status);
}

export function listByRoute(route: string): readonly BannerRecord[] {
  return RECORDS.filter((b) => b.intendedRoute === route);
}

export function listByMode(mode: BannerMode): readonly BannerRecord[] {
  return RECORDS.filter((b) => b.mode === mode || b.mode === "both");
}

/** Returns banners that share a state machine / duplicate another. */
export function listDuplicates(): readonly BannerRecord[] {
  return RECORDS.filter((b) => !!b.duplicatesOf);
}

/** Returns the asset-registry entries each banner references, with the
 *  missing-asset flag so Stage B's wiring can fail loudly when an
 *  expected asset was renamed or removed. */
export function resolveBannerAssets(banner: BannerRecord): ReadonlyArray<{
  assetId: string;
  entry: AssetEntry | undefined;
  resolved: boolean;
}> {
  return banner.assetIds.map((assetId) => {
    const entry = getAssetById(assetId);
    return { assetId, entry, resolved: !!entry };
  });
}

/** Summary by type — useful for the asset browser / Stage A report. */
export function summaryByType(): Record<BannerType, number> {
  const out = {} as Record<BannerType, number>;
  for (const b of RECORDS) {
    out[b.type] = (out[b.type] ?? 0) + 1;
  }
  return out;
}

/** Summary by status. */
export function summaryByStatus(): Record<BannerStatus, number> {
  const out = {} as Record<BannerStatus, number>;
  for (const b of RECORDS) {
    out[b.status] = (out[b.status] ?? 0) + 1;
  }
  return out;
}
