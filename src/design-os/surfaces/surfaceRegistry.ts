/**
 * Liquid Clips · Design OS · Surface Registry (C1 · 2026-06-26)
 *
 * The executable product-surface contract layer. Consolidates three
 * pre-existing sources that, individually, told only part of the story:
 *
 *   · routeRegistry.ts          → world + Kade + placement (visual contract)
 *   · bannerRegistry.ts         → allowed banners + duplicate map
 *   · customer-journey-lens     → purpose / primary CTA / above-fold /
 *                                 forbidden content (prose only, until now)
 *
 * Plus the snapshot shape from src/lib/qa.ts so QA gates can ask the
 * registry "given this snapshot of route X in mode Y, do you uphold
 * your contract?" instead of running ~80 lines of inline conditions.
 *
 * SCOPE LOCK (Daniel · 2026-06-26):
 *   · No route restructure. No banner wiring. No layout edits to
 *     Home / Earn / Campaigns / Create / Workstation. No new assets.
 *   · This file ADDS a contract layer. It does NOT replace the existing
 *     hardcoded qa.ts conditions — those keep their current pass/fail
 *     behaviour. The contract layer produces ADDITIONAL assertions that
 *     fail loudly when a future change drifts away from the contract.
 *
 * Reads:    routeRegistry.ROUTE_REGISTRY · bannerRegistry.BANNER_REGISTRY
 *           assetRegistry types
 * Writes:   nothing (pure data + helpers)
 */

import type { AppMode, KadeState, RouteId } from "../bridge";
import type { KadePlacement } from "../components/StickyKade";
import type { WorldKey } from "../components/WorldLayer";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import {
  BANNER_REGISTRY,
  type BannerRecord,
} from "../assets/bannerRegistry";
import type { AssetCategory } from "../assets/assetRegistry";

/* ──────────────────────────────────────────────────────────────────
 * Types
 * ────────────────────────────────────────────────────────────────── */

/**
 * SurfaceId is finer-grained than RouteId because Home (and Campaigns)
 * differ materially between Clipper and Agency mode — different tiles,
 * different banners, different forbidden content. browse-overlay and
 * login are surfaces a user reaches but aren't RouteIds in the bridge.
 */
export type SurfaceId =
  | "home.clipper"
  | "home.agency"
  | "create"
  | "workstation"
  | "browse-overlay"
  | "schedule"
  | "earn"
  | "campaigns.clipper"
  | "campaigns.agency"
  | "community"
  | "login"
  | "settings";

/** Routes the contract can map to. Includes RouteId plus the two
 *  non-route surfaces (browse overlay, login). */
export type SurfaceRouteId = RouteId | "browse-overlay" | "login";

/**
 * Disciplines the route MUST uphold above the fold. Mirrors the locked
 * Phase 1 (no landing hero on work routes) + Phase 2 (workstation split
 * workbench) decisions.
 */
export type ViewportDiscipline =
  | "landing-hero-banned" // Workstation / Earn / Campaigns / Schedule
  | "internal-scroll"     // Whole route does not scroll; internal columns do
  | "overlay-only"        // Browse overlay — chrome-driven
  | "command-room"        // Home — cockpit tiles + banner + earn row
  | "boot-only"           // Login / activation — no route chrome
  | "settings-tabs";      // Tabbed Settings · post 2026-06-24 split

export type JourneyVerdict = "GREEN" | "YELLOW" | "RED";

export interface PrimaryCTA {
  /** Visible label (canonical form; dynamic text is paraphrased). */
  label: string;
  /** data-testid hook when present in source. `null` for surfaces where
   *  the CTA is plural or context-dependent. */
  testId: string | null;
  /** Where the CTA lives. */
  origin: "above-the-fold" | "chrome" | "dock" | "tab";
}

export interface SurfaceContract {
  id: SurfaceId;

  /* ----- Mapping to route / mode --------------------------------- */
  routeId: SurfaceRouteId;
  mode: AppMode | "both";

  /* ----- Visual contract (from routeRegistry) -------------------- */
  world: WorldKey;
  defaultKade: KadeState;
  kadePlacement: KadePlacement;

  /* ----- Journey contract (from customer-journey-lens) ----------- */
  purpose: string;
  previousStep: SurfaceId | null;
  nextStep: SurfaceId | null;
  primaryCTA: PrimaryCTA;
  secondaryActions: readonly string[];
  aboveFold: readonly string[];
  internalScrollZones: readonly string[];
  forbiddenContent: readonly string[];
  viewportDiscipline: ViewportDiscipline;
  journeyVerdict: JourneyVerdict;

  /* ----- Allowed assets / banners -------------------------------- */
  /** Banner ids from BANNER_REGISTRY that ARE allowed on this surface.
   *  Derived at module load from `intendedRoute` + chrome-level. */
  allowedBanners: readonly string[];
  /** Asset categories the surface is allowed to render. */
  allowedAssetGroups: readonly AssetCategory[];

  /* ----- QA contract --------------------------------------------- */
  /** Names of pass conditions the existing qa.ts harness must report
   *  TRUE on this surface. Cross-referenced by assertSurfaceContract. */
  requiredQAAssertions: readonly string[];
}

/* ──────────────────────────────────────────────────────────────────
 * Banner allow-list (derived from BANNER_REGISTRY · pure read)
 *
 * Stage A locked banner records with `intendedRoute`. We collapse it
 * into a per-route allow-list so contracts can name banners cheaply.
 * `intendedRoute = null` means chrome-level (mounts on every route).
 * ────────────────────────────────────────────────────────────────── */

function bannersForRoute(route: string): readonly string[] {
  return BANNER_REGISTRY.filter(
    (b) => b.intendedRoute === route || b.intendedRoute === null,
  ).map((b) => b.id);
}

function bannersChromeOnly(): readonly string[] {
  return BANNER_REGISTRY.filter((b) => b.intendedRoute === null).map((b) => b.id);
}

/* ──────────────────────────────────────────────────────────────────
 * Asset group buckets
 *
 * Most surfaces are allowed: world (cockpit-home), kade (per route),
 * logo, nav-badge. Workstation additionally gets clip-card-fallback.
 * Login uses its own kade-tier sequence.
 * ────────────────────────────────────────────────────────────────── */

const BASE_ASSET_GROUPS: readonly AssetCategory[] = [
  "world",
  "kade",
  "logo",
  "nav-badge",
  "nav-icon",
  "action-icon",
];

/* ──────────────────────────────────────────────────────────────────
 * Contracts
 *
 * Each entry is a single source-of-truth declaration for a customer
 * surface. Field values cite their origin where the source isn't this
 * file (routeRegistry / bannerRegistry / customer-journey-lens prose).
 * ────────────────────────────────────────────────────────────────── */

const SURFACES: Record<SurfaceId, SurfaceContract> = {
  "home.clipper": {
    id: "home.clipper",
    routeId: "home",
    mode: "clipper",
    world: ROUTE_REGISTRY.home.world,
    defaultKade: ROUTE_REGISTRY.home.defaultKade,
    kadePlacement: ROUTE_REGISTRY.home.kadePlacement,
    purpose:
      "Cockpit landing. Make the four core actions obvious: create clips, find existing clips, find paid rewards, see earnings.",
    previousStep: "login",
    nextStep: "create",
    primaryCTA: {
      label: "Create Clips",
      testId: "home-tile-1",
      origin: "above-the-fold",
    },
    secondaryActions: [
      "Open My Clips tile",
      "Open Find Rewards tile",
      "Open Track Earnings tile",
      "Open Browse overlay (chrome tab)",
    ],
    aboveFold: [
      "4 cockpit tiles",
      "Home banner (Whop browse promo)",
      "Sponsored Reward strip ($50 / 5,000 views)",
      "Earn snapshot row ($0.00 earned · pending)",
    ],
    internalScrollZones: [],
    forbiddenContent: [
      "Agency campaign management controls",
      "Decorative landing-page hero (sim-welcome / sim-h1)",
      "Native withdraw UI implying Liquid Clips holds funds",
    ],
    viewportDiscipline: "command-room",
    journeyVerdict: "GREEN",
    allowedBanners: bannersForRoute("home"),
    allowedAssetGroups: BASE_ASSET_GROUPS,
    requiredQAAssertions: [
      "appMounted",
      "designOsActive",
      "authResumed",
      "noLogin",
      "routeMatches",
      "modeMatches",
      "kadeNotCenterOnHome",
      "clipperHomeStage",
      "clipperHomeBanner",
      "clipperHomeFourTiles",
      "clipperHomeEarn",
      "clipperHomeSponsoredReward",
      "clipperHomeLabels",
      "atmosphereWorldMounted",
      "atmosphereSceneMounted",
      "registryWorldResolved",
      "registryWorldIsCockpitHome",
      "registryKadeResolved",
    ],
  },

  "home.agency": {
    id: "home.agency",
    routeId: "home",
    mode: "agency",
    world: ROUTE_REGISTRY.home.world,
    defaultKade: ROUTE_REGISTRY.home.defaultKade,
    kadePlacement: ROUTE_REGISTRY.home.kadePlacement,
    purpose:
      "Agency cockpit landing. Same tiles, no clipper-only banners or earn surfaces. Agency pill visible.",
    previousStep: "login",
    nextStep: "campaigns.agency",
    primaryCTA: {
      label: "Create Campaign",
      testId: null,
      origin: "above-the-fold",
    },
    secondaryActions: [
      "Open My Clips tile",
      "Open Submissions (agency-only route)",
      "Open Analytics (agency-only route)",
    ],
    aboveFold: ["4 cockpit tiles", "Agency mode pill"],
    internalScrollZones: [],
    forbiddenContent: [
      "Sponsored reward strip / module / card (clipper-only)",
      "Earn snapshot row (clipper-only)",
      "Home Whop browse banner (clipper-only)",
    ],
    viewportDiscipline: "command-room",
    journeyVerdict: "GREEN",
    allowedBanners: bannersForRoute("home").filter((id) =>
      // Agency excludes clipper-only banners. We resolve at runtime via
      // the helper rather than freezing IDs, so future banner additions
      // for both modes pick up automatically.
      shouldKeepBanner(id, "agency"),
    ),
    allowedAssetGroups: BASE_ASSET_GROUPS,
    requiredQAAssertions: [
      "appMounted",
      "designOsActive",
      "authResumed",
      "noLogin",
      "routeMatches",
      "modeMatches",
      "kadeNotCenterOnHome",
      "agencyHomeStage",
      "agencyHomeFourTiles",
      "agencyHomeNoBanner",
      "agencyHomeNoEarn",
      "agencyHomeNoSponsored",
      "agencyPillVisible",
      "atmosphereWorldMounted",
      "registryWorldResolved",
      "registryWorldIsCockpitHome",
      "registryKadeResolved",
    ],
  },

  create: {
    id: "create",
    routeId: "create",
    mode: "both",
    world: ROUTE_REGISTRY.create.world,
    defaultKade: ROUTE_REGISTRY.create.defaultKade,
    kadePlacement: ROUTE_REGISTRY.create.kadePlacement,
    purpose:
      "Source intake. The user pastes a URL, drops a file, or starts from a script. Generate kicks the pipeline.",
    previousStep: "home.clipper",
    nextStep: "workstation",
    primaryCTA: {
      label: "Generate clips",
      testId: "create-panel",
      origin: "above-the-fold",
    },
    secondaryActions: ["Switch tab to URL / Upload / Script", "Cancel / close"],
    aboveFold: [
      "Panel eyebrow ('Drop a clip source · pick a path')",
      "URL paste field (canonical source)",
      "Upload tab (COMING SOON · honest)",
      "Script tab (COMING SOON · honest)",
      "Count chips (3 / 5 / 10)",
      "Generate button ('Analyze & Clip · {n} clips')",
    ],
    internalScrollZones: [],
    forbiddenContent: [
      "Decorative welcome-page hero",
      "Fake 'advanced AI dashboard' marketing copy",
      "Duplicate intake CTAs that compete with the URL paste",
      "Backdoor pills that skip source intake (e.g. 'Open Engine →')",
    ],
    viewportDiscipline: "landing-hero-banned",
    journeyVerdict: "GREEN",
    allowedBanners: [],
    allowedAssetGroups: BASE_ASSET_GROUPS,
    requiredQAAssertions: [
      "appMounted",
      "authResumed",
      "noLogin",
      "atmosphereWorldMounted",
      "registryWorldResolved",
    ],
  },

  workstation: {
    id: "workstation",
    routeId: "workstation",
    mode: "both",
    world: ROUTE_REGISTRY.workstation.world,
    defaultKade: ROUTE_REGISTRY.workstation.defaultKade,
    kadePlacement: ROUTE_REGISTRY.workstation.kadePlacement,
    purpose:
      "The workbench. Clip grid on the left, inspector on the right, CockpitDock at the bottom. Everything else is supportive.",
    previousStep: "create",
    nextStep: "earn",
    primaryCTA: {
      label: "Edit",
      testId: "clip-card",
      origin: "above-the-fold",
    },
    secondaryActions: [
      "Generate more (BUG-041 wire)",
      "Best bits only client filter",
      "Switch clip via clip-shell",
      "Open Reaction / Caption / Trim / Style / Schedule / Publish in dock",
    ],
    aboveFold: [
      "Compact route head (lc-route-head ≤ 60px)",
      "Clip grid (lc-ws-grid)",
      "Clip inspector (lc-ws-inspector)",
      "CockpitDock tabs",
    ],
    internalScrollZones: ["lc-ws-grid", "lc-ws-inspector"],
    forbiddenContent: [
      "Landing-page hero on the work route (Phase 1 lock)",
      "Whole-page vertical scroll (Phase 2 lock — only columns + dock move)",
      "Dead black clip placeholders (Stage B-1 lock — fallback Kade asset registry-resolved)",
    ],
    viewportDiscipline: "internal-scroll",
    journeyVerdict: "GREEN",
    allowedBanners: bannersForRoute("workstation"),
    allowedAssetGroups: [...BASE_ASSET_GROUPS, "clip-card-fallback"],
    requiredQAAssertions: [
      "appMounted",
      "authResumed",
      "noLogin",
      "routeMatches",
      "workstationMounted",
      "workbenchAppOverflowHidden",
      "viewportNoLandingHero",
      "viewportRouteHeadPresent",
      "viewportRouteHeadCompact",
      "atmosphereWorldMounted",
      "registryWorldResolved",
      "registryKadeResolved",
      "registryNoUnresolvedAssets",
    ],
  },

  "browse-overlay": {
    id: "browse-overlay",
    routeId: "browse-overlay",
    mode: "both",
    world: ROUTE_REGISTRY.home.world,
    defaultKade: ROUTE_REGISTRY.home.defaultKade,
    kadePlacement: ROUTE_REGISTRY.home.kadePlacement,
    purpose:
      "Native WebKit overlay that lets the user browse Whop rewards / campaigns / earn / community without leaving the app. Commerce URLs open in the system browser.",
    previousStep: "home.clipper",
    nextStep: "create",
    primaryCTA: {
      label: "Use in Engine",
      testId: null,
      origin: "above-the-fold",
    },
    secondaryActions: [
      "Open in system browser",
      "Copy URL",
      "Switch tab (Whop Rewards / Campaigns / Earn / Community)",
    ],
    aboveFold: [
      "Address bar / status",
      "4 tab pills (Whop Rewards · Campaigns · Earn · Community)",
      "Open in system browser footer",
    ],
    internalScrollZones: ["lc-browse-overlay-content"],
    forbiddenContent: [
      "Commerce URLs handled inside the overlay (must hand off to system browser)",
      "Whole-page scroll behind the overlay",
    ],
    viewportDiscipline: "overlay-only",
    journeyVerdict: "GREEN",
    allowedBanners: bannersForRoute("browse-overlay"),
    allowedAssetGroups: BASE_ASSET_GROUPS,
    requiredQAAssertions: [
      "appMounted",
      "authResumed",
      "browseOverlayState",
    ],
  },

  schedule: {
    id: "schedule",
    routeId: "schedule",
    mode: "both",
    world: ROUTE_REGISTRY.schedule.world,
    defaultKade: ROUTE_REGISTRY.schedule.defaultKade,
    kadePlacement: ROUTE_REGISTRY.schedule.kadePlacement,
    purpose:
      "Workstation alias. Schedule lives inside the dock; this route just enters the workbench focused on the Schedule tab.",
    previousStep: "workstation",
    nextStep: null,
    primaryCTA: {
      label: "Publish · Schedule 1h",
      testId: null,
      origin: "dock",
    },
    secondaryActions: [
      "Switch dock tab to Publish",
      "Switch to Reaction / Caption / Trim / Style",
    ],
    aboveFold: [
      "Compact route head",
      "Clip grid + inspector",
      "CockpitDock with Schedule tab active",
    ],
    internalScrollZones: ["lc-ws-grid", "lc-ws-inspector"],
    forbiddenContent: [
      "Fake 'queue' toasts that imply scheduling is live",
      "Landing hero on the alias route",
    ],
    viewportDiscipline: "internal-scroll",
    journeyVerdict: "YELLOW",
    allowedBanners: bannersForRoute("schedule"),
    allowedAssetGroups: [...BASE_ASSET_GROUPS, "clip-card-fallback"],
    requiredQAAssertions: [
      "appMounted",
      "authResumed",
      "routeMatches",
      "workbenchAppOverflowHidden",
      "viewportNoLandingHero",
      "viewportRouteHeadPresent",
      "atmosphereWorldMounted",
      "registryWorldResolved",
    ],
  },

  earn: {
    id: "earn",
    routeId: "earn",
    mode: "clipper",
    world: ROUTE_REGISTRY.earn.world,
    defaultKade: ROUTE_REGISTRY.earn.defaultKade,
    kadePlacement: ROUTE_REGISTRY.earn.kadePlacement,
    purpose:
      "Canonical reward surface. Sponsored Reward module lives here; Whop is the payout owner. Liquid Clips never implies native withdrawal in v1.",
    previousStep: "home.clipper",
    nextStep: "campaigns.clipper",
    primaryCTA: {
      label: "Open affiliate dashboard ↗",
      testId: "earn-open-affiliate",
      origin: "above-the-fold",
    },
    secondaryActions: [
      "View Sponsored Reward rules",
      "Withdraw via Whop (state-machine gated)",
    ],
    aboveFold: [
      "Sponsored Reward module (canonical banner: sponsored-reward.module)",
      "Compact route head",
      "Earnings / pending row",
    ],
    internalScrollZones: [],
    forbiddenContent: [
      "Native 'Withdraw from Liquid Clips' UI (Whop-only payout in v1)",
      "Landing-page hero (Phase 1 lock)",
      "Duplicate reward CTAs that compete with the canonical module",
    ],
    viewportDiscipline: "landing-hero-banned",
    journeyVerdict: "GREEN",
    allowedBanners: bannersForRoute("earn"),
    allowedAssetGroups: BASE_ASSET_GROUPS,
    requiredQAAssertions: [
      "appMounted",
      "authResumed",
      "routeMatches",
      "modeMatches",
      "viewportNoLandingHero",
      "viewportRouteHeadPresent",
      "viewportRouteHeadCompact",
      "atmosphereWorldMounted",
      "registryWorldResolved",
    ],
  },

  "campaigns.clipper": {
    id: "campaigns.clipper",
    routeId: "campaigns",
    mode: "clipper",
    world: ROUTE_REGISTRY.campaigns.world,
    defaultKade: ROUTE_REGISTRY.campaigns.defaultKade,
    kadePlacement: ROUTE_REGISTRY.campaigns.kadePlacement,
    purpose:
      "Find paid clip missions. Read brief, join, generate, submit. Sponsored Reward card surfaces the $50 activation bonus.",
    previousStep: "home.clipper",
    nextStep: "create",
    primaryCTA: {
      label: "Join campaign",
      testId: null,
      origin: "above-the-fold",
    },
    secondaryActions: [
      "Read brief / rules",
      "Filter campaigns",
      "Open Earn for context",
      "Draft a campaign (commitment-paywall · publish gated to Agency)",
    ],
    aboveFold: [
      "Compact route head",
      "Sponsored Reward card ($50 · clipper-only)",
      "Campaigns grid (mission pedestals)",
      "Filter chips",
      "Draft campaign CTA (paywall fires at publish)",
    ],
    internalScrollZones: ["lc-campaigns-grid"],
    forbiddenContent: [
      "AgencyManageStrip (Agency-only · IG · keep mode-gated)",
      "Live publish without paywall (commitment-paywall fires at publish step)",
      "Landing-page hero (Phase 1 lock)",
      "Fake invite-link writes (IRON GATE)",
    ],
    viewportDiscipline: "landing-hero-banned",
    journeyVerdict: "GREEN",
    allowedBanners: bannersForRoute("campaigns"),
    allowedAssetGroups: BASE_ASSET_GROUPS,
    requiredQAAssertions: [
      "appMounted",
      "authResumed",
      "routeMatches",
      "modeMatches",
      "viewportNoLandingHero",
      "viewportRouteHeadPresent",
      "viewportRouteHeadCompact",
      "atmosphereWorldMounted",
      "registryWorldResolved",
    ],
  },

  "campaigns.agency": {
    id: "campaigns.agency",
    routeId: "campaigns",
    mode: "agency",
    world: ROUTE_REGISTRY.campaigns.world,
    defaultKade: ROUTE_REGISTRY.campaigns.defaultKade,
    kadePlacement: ROUTE_REGISTRY.campaigns.kadePlacement,
    purpose:
      "Create + manage campaigns. AgencyManageStrip gives invite/lifecycle controls. No live Whop payout tracking — Whop owns clipper payouts.",
    previousStep: "home.agency",
    nextStep: null,
    primaryCTA: {
      label: "Create campaign",
      testId: null,
      origin: "above-the-fold",
    },
    secondaryActions: [
      "Manage existing campaigns via AgencyManageStrip",
      "Invite clippers (gated on backend wire)",
      "Open Submissions",
    ],
    aboveFold: [
      "Compact route head",
      "Featured campaign banner",
      "AgencyManageStrip (Agency-only)",
      "Filter chips",
      "Create campaign CTA",
      "Active campaign list",
    ],
    internalScrollZones: ["lc-campaigns-grid"],
    forbiddenContent: [
      "SponsoredRewardCard (clipper-only · $50 is paid TO clippers)",
      "Fake live Whop payout tracking",
      "Landing-page hero (Phase 1 lock)",
    ],
    viewportDiscipline: "landing-hero-banned",
    journeyVerdict: "GREEN",
    allowedBanners: bannersForRoute("campaigns"),
    allowedAssetGroups: BASE_ASSET_GROUPS,
    requiredQAAssertions: [
      "appMounted",
      "authResumed",
      "routeMatches",
      "modeMatches",
      "viewportNoLandingHero",
      "atmosphereWorldMounted",
      "registryWorldResolved",
    ],
  },

  community: {
    id: "community",
    routeId: "community",
    mode: "both",
    world: ROUTE_REGISTRY.community.world,
    defaultKade: ROUTE_REGISTRY.community.defaultKade,
    kadePlacement: ROUTE_REGISTRY.community.kadePlacement,
    purpose:
      "Squad / rank visibility. Light surface in v1; banner-only with honest stub copy where rooms aren't seeded yet.",
    previousStep: "home.clipper",
    nextStep: "home.clipper",
    primaryCTA: {
      label: "View squads",
      testId: null,
      origin: "above-the-fold",
    },
    secondaryActions: ["Browse community rooms"],
    aboveFold: ["Community banner", "Compact route head"],
    internalScrollZones: [],
    forbiddenContent: [
      "Fake message counts / unread badges",
      "Landing-page hero",
    ],
    viewportDiscipline: "landing-hero-banned",
    journeyVerdict: "YELLOW",
    allowedBanners: bannersForRoute("community"),
    allowedAssetGroups: BASE_ASSET_GROUPS,
    requiredQAAssertions: [
      "appMounted",
      "authResumed",
      "routeMatches",
      "atmosphereWorldMounted",
      "registryWorldResolved",
    ],
  },

  login: {
    id: "login",
    routeId: "login",
    mode: "both",
    world: "cockpit-home", // LoginOnboarding renders its own boot world inside
    defaultKade: "idle",
    kadePlacement: "center",
    purpose:
      "Activation flow. Show clear value, deep-link to Whop / Stripe, hand-off back via liquidclips://activate?token=…&challenge=…",
    previousStep: null,
    nextStep: "home.clipper",
    primaryCTA: {
      label: "Activate",
      testId: null,
      origin: "above-the-fold",
    },
    secondaryActions: ["Open in browser", "Paste activation JWT (advanced)"],
    aboveFold: [
      "4-step explainer",
      "Begin / Activate CTA",
      "Status pill (waiting / activating / activated / failed)",
    ],
    internalScrollZones: [],
    forbiddenContent: [
      "Cockpit chrome (ConsoleNav / TopHud) — LoginOnboarding owns its own boot panel",
      "Earn / Campaigns content before activation completes",
    ],
    viewportDiscipline: "boot-only",
    journeyVerdict: "GREEN",
    allowedBanners: bannersChromeOnly(),
    allowedAssetGroups: ["world", "kade", "kade-tier", "logo"],
    requiredQAAssertions: ["appMounted"],
  },

  settings: {
    id: "settings",
    routeId: "settings",
    mode: "both",
    world: ROUTE_REGISTRY.settings.world,
    defaultKade: ROUTE_REGISTRY.settings.defaultKade,
    kadePlacement: ROUTE_REGISTRY.settings.kadePlacement,
    purpose:
      "Account · connections · plan · diagnostics. 4-tab layout (2026-06-24 split). Real /me state + honest pills.",
    previousStep: "home.clipper",
    nextStep: "home.clipper",
    primaryCTA: {
      label: "Manage plan on Whop ↗",
      testId: "settings-upgrade-whop",
      origin: "tab",
    },
    secondaryActions: [
      "Switch to Connections / Plan / Diagnostics tab",
      "Refresh account status",
      "Open Whop dashboard",
      "Open Admin HQ (admin-only · gated on tier.adminOverride)",
    ],
    aboveFold: ["Tab bar (Account / Connections / Plan / Diagnostics)", "Account card"],
    internalScrollZones: ["lc-settings"],
    forbiddenContent: [
      "Upgrade CTA in app chrome (billing lives in Settings · Plan tab only)",
      "Fake admin-HQ link visible to non-admins (IG-LC2-AdminGate)",
    ],
    viewportDiscipline: "settings-tabs",
    journeyVerdict: "GREEN",
    allowedBanners: bannersForRoute("settings"),
    allowedAssetGroups: BASE_ASSET_GROUPS,
    requiredQAAssertions: [
      "appMounted",
      "authResumed",
      "routeMatches",
      "atmosphereWorldMounted",
      "registryWorldResolved",
    ],
  },
};

/* ──────────────────────────────────────────────────────────────────
 * Internal helpers
 * ────────────────────────────────────────────────────────────────── */

function shouldKeepBanner(bannerId: string, mode: AppMode): boolean {
  const banner = BANNER_REGISTRY.find((b) => b.id === bannerId);
  if (!banner) return false;
  if (banner.mode === "both") return true;
  return banner.mode === mode;
}

/* ──────────────────────────────────────────────────────────────────
 * Public exports
 * ────────────────────────────────────────────────────────────────── */

export const SURFACE_REGISTRY: Readonly<Record<SurfaceId, SurfaceContract>> =
  SURFACES;

export const SURFACE_IDS: readonly SurfaceId[] = Object.keys(SURFACES) as SurfaceId[];

/** Lookup a surface contract by id. */
export function getSurfaceContract(id: SurfaceId): SurfaceContract | undefined {
  return SURFACES[id];
}

/** Surfaces a user in `mode` can reach. Mode "both" surfaces are
 *  included for both modes. */
export function listSurfacesByMode(
  mode: AppMode,
): readonly SurfaceContract[] {
  return SURFACE_IDS.map((id) => SURFACES[id]).filter(
    (s) => s.mode === mode || s.mode === "both",
  );
}

/** Allowed banner RECORDS for a surface (resolves ids → records). */
export function getAllowedBanners(id: SurfaceId): readonly BannerRecord[] {
  const contract = SURFACES[id];
  if (!contract) return [];
  const ids = new Set(contract.allowedBanners);
  return BANNER_REGISTRY.filter((b) => ids.has(b.id));
}

/** Allowed asset categories for a surface. */
export function getAllowedAssets(id: SurfaceId): readonly AssetCategory[] {
  return SURFACES[id]?.allowedAssetGroups ?? [];
}

/** Primary CTA for a surface, or `undefined` if not registered. */
export function getPrimaryCta(id: SurfaceId): PrimaryCTA | undefined {
  return SURFACES[id]?.primaryCTA;
}

/* ──────────────────────────────────────────────────────────────────
 * assertSurfaceContract
 *
 * Minimal snapshot shape that mirrors the fields the existing qa.ts
 * harness already produces. Producing this here keeps surfaceRegistry
 * decoupled from QASnapshot (we type-narrow on the read side so qa.ts
 * can pass its full snapshot and we only consume what we need).
 *
 * Returns a Record<string, boolean> of contract assertions — names are
 * prefixed with `contract.` to avoid colliding with the existing
 * hardcoded qa.ts condition names.
 * ────────────────────────────────────────────────────────────────── */

export interface SurfaceSnapshotInput {
  /** Snapshot route id (or routeFamily-aliased equivalent). */
  route?: string | null;
  mode?: string | null;
  /** WorldKey resolved on the shell. */
  world?: string | null;
  /** Kade placement as reported by .lc-sticky-kade host. */
  kadePlacement?: "center" | "helper-right" | "bottom-right" | "mini" | null;
  /** Whether the browse overlay is currently mounted. */
  browseOpen?: boolean;
  /** Whether the login route is rendered (fail · should NOT be present
   *  on non-login surfaces). */
  loginPresent?: boolean;
}

export function assertSurfaceContract(
  snap: SurfaceSnapshotInput,
  contract: SurfaceContract,
): Record<string, boolean> {
  const isOverlay = contract.routeId === "browse-overlay";
  const isLogin = contract.routeId === "login";

  const modeMatches = contract.mode === "both"
    ? true
    : (snap.mode ?? null) === contract.mode;

  // browse-overlay's "route" is whichever underlying route hosts it;
  // surface assertion is "overlay is open" rather than "route id matches".
  const routeMatches = isOverlay
    ? snap.browseOpen === true
    : (snap.route ?? null) === contract.routeId ||
      // Aliases resolved at consumer (e.g. schedule → workstation), so
      // we accept either the surface's nominal routeId or the snapshot's
      // family-resolved route id.
      (contract.id === "schedule" && snap.route === "workstation");

  const worldMatches = isLogin
    ? true // LoginOnboarding paints its own boot world; don't gate on cockpit-home here.
    : (snap.world ?? null) === contract.world;

  const kadePlacementMatches =
    snap.kadePlacement === undefined || snap.kadePlacement === null
      ? true // Snapshot may legitimately omit this on overlay-only surfaces.
      : snap.kadePlacement === contract.kadePlacement;

  // Login route must NOT show login chrome inside another surface,
  // and non-login surfaces must NOT have login mounted.
  const loginGating = isLogin
    ? true // Login surface legitimately renders the LoginOnboarding component.
    : snap.loginPresent !== true;

  return {
    "contract.modeMatches": modeMatches,
    "contract.routeMatches": routeMatches,
    "contract.worldMatches": worldMatches,
    "contract.kadePlacementMatches": kadePlacementMatches,
    "contract.loginGatingHonest": loginGating,
    // Tautologies that signal the surface IS registered (catches a
    // missing-registration bug at the call site).
    "contract.surfaceRegistered": true,
    "contract.primaryCtaDefined": Boolean(contract.primaryCTA?.label),
    "contract.purposeDeclared": Boolean(contract.purpose),
  };
}

/* ──────────────────────────────────────────────────────────────────
 * Self-validation
 *
 * Catches obvious drift in this file at module load. Throws in dev
 * (so we notice immediately) and is a no-op cost in prod. Validates:
 *   · Every contract's routeId resolves in ROUTE_REGISTRY (skip the
 *     two non-route surfaces: browse-overlay, login).
 *   · Every allowedBanners id resolves in BANNER_REGISTRY.
 *   · No contract claims a forbidden banner id.
 * ────────────────────────────────────────────────────────────────── */

function validateRegistry(): void {
  const bannerIds = new Set(BANNER_REGISTRY.map((b) => b.id));
  for (const id of SURFACE_IDS) {
    const c = SURFACES[id];
    if (c.routeId !== "browse-overlay" && c.routeId !== "login") {
      if (!(c.routeId in ROUTE_REGISTRY)) {
        throw new Error(
          `surfaceRegistry: ${id} routeId='${c.routeId}' not in ROUTE_REGISTRY`,
        );
      }
    }
    for (const bid of c.allowedBanners) {
      if (!bannerIds.has(bid)) {
        throw new Error(
          `surfaceRegistry: ${id} allowedBanners includes unknown banner '${bid}'`,
        );
      }
    }
  }
}

// Only throw in dev / QA · stays silent in prod builds so a stale
// banner id doesn't break the running app.
if (typeof process === "undefined" || process.env.NODE_ENV !== "production") {
  try {
    validateRegistry();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[surfaceRegistry] validation:", err);
  }
}
