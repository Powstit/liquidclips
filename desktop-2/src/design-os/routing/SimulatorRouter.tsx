/**
 * SimulatorRouter · UI-1 collapsed map
 *
 * Restores the original two-surface customer journey:
 *
 *   Home        → 4 cockpit tiles (Create / Import / Retrieve / Open Engine)
 *   Workstation → unified clip grid + cockpit shell (was engine/studio/export/schedule)
 *
 * Drift routes (Campaigns, ClipperJourney, TimelineStudio, ExportRoute,
 * Schedule) are aliased into Home or Workstation. Their on-disk files are
 * still present (deletion scheduled for UI-2). Earn / Community / Library /
 * Channels / Settings remain untouched — they're not in UI-1 scope.
 *
 * Deep-link aliases:
 *   #/create   → home, opens panel on URL tab
 *   #/import   → home, opens panel on Upload tab
 *   #/retrieve → workstation
 *   #/engine   → workstation
 *   #/studio   → workstation
 *   #/export   → workstation
 *
 * L3 (2026-07-11): `#/schedule` now resolves to the real ScheduleRoute
 * (Phase 6J-A · WeekStrip + assisted-schedule rows) instead of
 * aliasing to workstation. The alias was misleading — the nav label
 * said "Schedule · Assisted" but landed the user on My Clips with no
 * schedule pane. The ScheduleRoute component already ships in
 * `src/design-os/routes/Schedule.tsx`; it just wasn't wired.
 *
 * L2 (2026-07-11): `#/support` now emits `settings:open-tab` with
 * `tab: "support"` on arrival so the customer lands on the Support
 * pane of Settings instead of the default Account tab.
 */

import { lazy, startTransition, Suspense, useEffect, useState, type ReactElement } from "react";
import { useEvent, bus, type RouteId } from "../bridge";
import { DesignOSBoundary } from "../components/DesignOSBoundary";
import { PersistentDesignOSAppShell } from "../components/AppShell";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { ModalPortal } from "../components/ModalPortal";
import { Watchdog } from "../../lib/watchdog";
import { ROUTE_REGISTRY } from "./routeRegistry";

/* Gate 7 (2026-06-26) — every route was being eager-imported into the
 * initial JS chunk. The home surface (CommandRoom) is the only one
 * needed on first paint; every other surface streams in when its
 * route is selected. Initial JS dropped from ~2.45 MB across 25
 * chunks to a much smaller home-only chunk + per-route chunks. */
import { CommandRoom } from "../routes/CommandRoom";
const WorkstationRoute = lazy(() => import("../routes/Workstation").then((m) => ({ default: m.WorkstationRoute })));
// Phase 1c · Composer sibling of Workstation. Opt-in only · reached via
// the "Try new Composer" Home tile (localStorage-gated) or the direct
// `#/composer` deep-link. Zero impact on the Workstation route.
// 2026-07-20 · Daniel: "create a new composer page and wire it properly
// and delete this one if u have to i need it to work now."
// The prior Composer.tsx wraps KadeComposerBody in a heavy chain
// (CockpitProvider · EngineSession · ComposerKade absolute portrait ·
// silence counter · voice input · reaction preview). Any one of those
// hooks hanging on mount = the whole route hangs. SimpleComposerRoute
// mounts KadeComposerBody DIRECTLY with defaults · zero context chain
// · zero fetch dependencies at mount. Restore the heavy path by
// swapping the import back to `../routes/Composer` when the diag work
// on the fat wire is complete.
// 2026-07-22 · Sprint 2.5 · single ComposerRoute renders SimpleComposerShell
// when idle and MasterComposerShell when engaged · state shared across
// the swap via useComposerSession Zustand slot · animated with the native
// View Transitions API. Replaces the prior direct-mount SimpleComposer.
const ComposerRoute = lazy(() =>
  import("../routes/ComposerRoute").then((m) => ({ default: m.ComposerRoute })),
);
// 2026-07-21 · staff-only diagnostic center · fires on hash #/diagnostics
// after `localStorage.setItem("lc.staff.flag", "1")`. Non-staff users see
// a hard block panel with the enable instruction.
const DiagnosticCenterRoute = lazy(() =>
  import("../routes/DiagnosticCenter").then((m) => ({ default: m.DiagnosticCenterRoute })),
);
// 2026-07-21 · Sprint 1 Tier 1 · staff-only iframe preview of the
// approved kade-composer-simulator.html mockup. #/composer-preview
const MasterComposerPreviewRoute = lazy(() =>
  import("../routes/MasterComposerPreview").then((m) => ({ default: m.MasterComposerPreviewRoute })),
);
// 2026-07-21 · Sprint 2 Tier 2 · staff-only React port of the mockup
// with real state wiring (mood, sidecar, engine events, tier pill,
// Base Window JSON live). SimpleComposer remains the default composer
// until Daniel greenlights swap. Route: #/composer-master?staff=1
const MasterComposerRoute = lazy(() =>
  import("../routes/MasterComposer").then((m) => ({ default: m.MasterComposerRoute })),
);
const SubmissionsReviewRoute = lazy(() => import("../routes/SubmissionsReview").then((m) => ({ default: m.SubmissionsReviewRoute })));
const ThumbnailStudioRoute = lazy(() => import("../routes/ThumbnailStudio").then((m) => ({ default: m.ThumbnailStudioRoute })));
// 2026-07-10 · Chapter 3 (Lane A · Product surface) — the Design-OS
// EarnRoute has been demoted behind the money-surface rule (see
// `desktop-2/CLAUDE.md` § "The money-surface rule (LOCKED 2026-07-10)").
// The nav "Wallet" (route id `earn`) now resolves to the Section-
// pipeline WalletDetail, wrapped in Watchdog + EngineErrorBoundary
// per the wire contract in the sprint spec. Legacy `EarnRoute` file
// remains on disk (many sibling files in `src/design-os/earn/*`
// import shared primitives) but has no in-shell entry point.
const WalletDetailLazy = lazy(() =>
  import("../../routes/wallet-detail/WalletDetail").then((m) => ({
    default: m.WalletDetail,
  })),
);
// D1 Cluster F (2026-07-12) · Sponsored Reward is a money surface
// locked to Earn. When #/earn resolved through the deprecated
// EarnRoute the SponsoredRewardModule sat above the ledger; the
// money-surface pivot moved the ledger to WalletDetail but left the
// module unmounted on the new route. Free-tier users lost the
// entry-point convert-carrot they were promised. This lazy import
// re-mounts the module ABOVE WalletDetail on the earn surface.
const SponsoredRewardModuleLazy = lazy(() =>
  import("../earn/SponsoredRewardModule").then((m) => ({
    default: m.SponsoredRewardModule,
  })),
);
// D1-cluster-Z (2026-07-12) · Publish → RewardClip downstream needed a
// visible reward-clip title on the earn surface (WalletDetail owns the
// balance/ledger, not the submissions list). Mounted below WalletDetail
// so the mint flow's new row surfaces without duplicating the whole
// Design-OS EarnRoute chrome. Same Watchdog boundary pattern as the
// SponsoredRewardModule mount above.
const WalletRewardClipsSectionLazy = lazy(() =>
  import("../earn/WalletRewardClipsSection").then((m) => ({
    default: m.WalletRewardClipsSection,
  })),
);
const CommunityRoute = lazy(() => import("../routes/Community").then((m) => ({ default: m.CommunityRoute })));
// Phase 1 · 7-category purge (2026-07-10) · LibraryRoute lazy import
// removed alongside the direct route entry. The `library` hash still
// resolves via ALIAS_FOR → workstation. Route file kept on disk
// pending removal in a follow-up sweep so `src/design-os/routes/`
// isn't disturbed mid-Phase-1.
const ChannelsRoute = lazy(() => import("../routes/Channels").then((m) => ({ default: m.ChannelsRoute })));
const CampaignsRoute = lazy(() => import("../routes/Campaigns").then((m) => ({ default: m.CampaignsRoute })));
// Sprint D · agency campaign builder (write surface). Distinct from
// CampaignsRoute (read-only clipper discovery). Own lazy chunk so a
// clipper doesn't ship the builder code.
const AgencyCampaignsRoute = lazy(() =>
  import("../routes/AgencyCampaigns").then((m) => ({ default: m.AgencyCampaignsRoute })),
);
const ClipperJourneyRoute = lazy(() => import("../routes/ClipperJourney").then((m) => ({ default: m.ClipperJourneyRoute })));
const AnalyticsRoute = lazy(() => import("../routes/Analytics").then((m) => ({ default: m.AnalyticsRoute })));
const SettingsRoute = lazy(() => import("../routes/Settings").then((m) => ({ default: m.SettingsRoute })));
// 2026-07-05 · 2.2.24 · LoginOnboardingRoute removed. The "#login" hash-
// route lands on Settings now — the sign-in CTA lives in TopHud and
// opens Whop's hosted checkout in the OS default browser. Any deep-link
// to `#login` still resolves rather than 404s.
const StopPagesRoute = lazy(() => import("../routes/StopPages").then((m) => ({ default: m.StopPagesRoute })));
// L3 · 2026-07-11 · Schedule now resolves to the real ScheduleRoute
// surface (WeekStrip + assisted-schedule rows) instead of aliasing to
// Workstation. The Schedule route already ships (Phase 6J-A) — it was
// simply never registered in SURFACE_FOR after the UI-1 collapse.
const ScheduleRouteLazy = lazy(() => import("../routes/Schedule").then((m) => ({ default: m.ScheduleRoute })));
// Block 3 · 2026-07-11 · Learn tab · 7-demo grid. Was Section-pipeline
// registered but never linked in ConsoleNav so no user could reach it.
// Now mounted as a Design-OS primary surface between My Journey (clipper)
// and Wallet (earn). Section-pipeline duplicate removed from
// sectionRegistry.ts to prevent two chrome shells drifting apart.
const LearnRouteLazy = lazy(() => import("../../routes/learn").then((m) => ({ default: m.LearnTab })));
// 2026-07-10 · Crew P1 · post-verify referral flywheel. Reached at
// `#/crew-onboarding` — routed to explicitly by WelcomeRoute after
// Clerk OTP success when `crew_onboarding_*` markers are unset in
// /me `onboarding_status`. `props.onDone` navigates to Home.
const CrewOnboardingRoute = lazy(() =>
  import("../../routes/crew-onboarding/CrewOnboarding").then((m) => ({
    default: (): ReactElement => (
      <m.CrewOnboarding
        onDone={() => {
          window.location.hash = "#/home";
        }}
      />
    ),
  })),
);

type ExtendedRouteId = RouteId | "login" | "stop-pages" | "import" | "retrieve";

/* Primary surfaces — render directly. */
const SURFACE_FOR: Record<string, () => ReactElement> = {
  home:        () => <CommandRoom />,
  workstation: () => <WorkstationRoute />,
  // Phase 1c · Composer surface. Same shell chrome as Workstation ·
  // separate route id so deep-links + telemetry can tell them apart.
  composer:    () => <ComposerRoute />,
  // 2026-07-21 · staff-only inspection surface · gated inside the route.
  diagnostics: () => <DiagnosticCenterRoute />,
  // 2026-07-21 · Sprint 1 Tier 1 · staff-only preview of the approved
  // kade-composer-simulator.html mockup rendered via iframe.
  "composer-preview": () => <MasterComposerPreviewRoute />,
  // 2026-07-21 · Sprint 2 Tier 2 · staff-only React port of the mockup
  // with real state wiring. #/composer-master?staff=1
  "composer-master": () => <MasterComposerRoute />,
  submissions: () => <SubmissionsReviewRoute />,
  thumbnail:   () => <ThumbnailStudioRoute />,
  earn:        () => (
    <>
      {/* D1 Cluster F (2026-07-12) · Sponsored Reward mounted ABOVE
          WalletDetail so free-tier clippers see the convert carrot on
          the same surface the wallet lives on. Own Watchdog so a
          module crash lands on KadeRepairScreen instead of dragging
          the money surface down. */}
      <Watchdog
        id="money/mo-11/sponsored-reward-module-earn"
        cluster="money"
        label="Sponsored Reward Module (Earn surface)"
        source="src/design-os/routing/SimulatorRouter.tsx:earn (Cluster F)"
      >
        <EngineErrorBoundary route="account" component="SponsoredRewardModule">
          <SponsoredRewardModuleLazy viewCount={0} />
        </EngineErrorBoundary>
      </Watchdog>
      <Watchdog
        id="money/mo-10/wallet-detail"
        cluster="money"
        label="Wallet Referral Ledger"
        source="src/routes/wallet-detail/WalletDetail.tsx"
      >
        <EngineErrorBoundary route="account" component="WalletDetail">
          <WalletDetailLazy />
        </EngineErrorBoundary>
      </Watchdog>
      {/* D1-cluster-Z (2026-07-12) · Publish → RewardClip mint list.
          Mounts BELOW WalletDetail so the reward-clip titles surface
          after a successful mint (publish-reward-mint.spec.ts:39). */}
      <Watchdog
        id="money/mo-12/wallet-reward-clips-earn"
        cluster="money"
        label="Wallet Reward Clips"
        source="src/design-os/earn/WalletRewardClipsSection.tsx"
      >
        <EngineErrorBoundary route="account" component="WalletRewardClips">
          <WalletRewardClipsSectionLazy />
        </EngineErrorBoundary>
      </Watchdog>
    </>
  ),
  community:   () => <CommunityRoute />,
  // Phase 1 · 7-category purge Category 4 (2026-07-10) · standalone
  // Library surface was rendering a "Library · coming soon" honest-stub
  // pane. Now aliased to workstation via ALIAS_FOR (below), consistent
  // with the UX-4 folded-into-My-Clips decision. LibraryRoute lazy
  // import stays for backward compat until the file is removed in a
  // follow-up sweep.
  channels:    () => <ChannelsRoute />,
  campaigns:   () => <CampaignsRoute />,
  "campaign-builder": () => <AgencyCampaignsRoute />,
  clipper:     () => <ClipperJourneyRoute />,
  learn:       () => <LearnRouteLazy />,
  analytics:   () => <AnalyticsRoute />,
  settings:    () => <SettingsRoute />,
  // L2 · 2026-07-11 · Support still renders Settings (the Support pane
  // is a Settings tab, not a standalone surface) BUT we emit the
  // `settings:open-tab` bus event on arrival (via SURFACE_ON_ARRIVE
  // below) so the user lands on the Support tab, not the default
  // Account tab. Direct hash + nav:click both trigger the arrive hook.
  support:     () => <SettingsRoute />,
  login:       () => <SettingsRoute />,
  "stop-pages":() => <StopPagesRoute />,
  "crew-onboarding": () => <CrewOnboardingRoute />,
  // L3 · 2026-07-11 · Schedule surface goes here directly (was aliased
  // to workstation — which showed My Clips with no schedule pane).
  schedule:    () => <ScheduleRouteLazy />,
};

/* Cheap solid-color fallback that matches brand background so the
 * route swap doesn't flash white while the chunk streams in. */
function RouteChunkFallback() {
  return (
    <div
      aria-hidden="true"
      style={{ position: "fixed", inset: 0, background: "#0b0b10" }}
    />
  );
}

/* Aliases — map to a primary surface + optional post-mount effect. */
interface Alias {
  to: keyof typeof SURFACE_FOR;
  /** Fired AFTER the surface mounts. Used to deep-link Create/Import to the
   *  Home panel with the right tab pre-selected. */
  onArrive?: () => void;
}

/* L2 · 2026-07-11 · Post-arrival effects for PRIMARY surfaces too.
 * Prior version only fired onArrive for ALIAS_FOR routes; support/
 * schedule / any future "surface-with-tab" wire needs an arrive hook
 * on the primary route. `SURFACE_ON_ARRIVE` runs on the same tick
 * cadence as the alias branch (40-60ms after mount so the target
 * surface's event listeners are ready). */
const SURFACE_ON_ARRIVE: Partial<Record<keyof typeof SURFACE_FOR, () => void>> = {
  // L2 · Support click / #/support deep-link lands on the Support pane
  // of Settings. Settings mounts, subscribes to settings:open-tab, then
  // this emit flips the tab from the default "account" to "support".
  support: () => bus.emit("settings:open-tab", { tab: "support" }),
};

const ALIAS_FOR: Record<string, Alias> = {
  // Home-rooted entry points
  create:    { to: "home", onArrive: () => bus.emit("home:open-panel", { tab: "url" }) },
  import:    { to: "home", onArrive: () => bus.emit("home:open-panel", { tab: "upload" }) },
  retrieve:  { to: "workstation" },
  // Workstation-absorbed legacy routes
  engine:    { to: "workstation" },
  studio:    { to: "workstation" },
  export:    { to: "workstation" },
  // L3 · 2026-07-11 · `schedule` moved out of ALIAS_FOR into
  // SURFACE_FOR above — nav "Schedule · Assisted" now lands on the
  // real ScheduleRoute (WeekStrip + assisted-schedule rows), not a
  // fake-workstation redirect.
  // UX-4 · Library is folded into My Clips. Old bookmarks still resolve.
  library:   { to: "workstation" },
  // Phase 1c · legacy Composer simulator hash resolves to the real route.
  "kade-composer": { to: "composer" },
  // 2026-07-10 · Chapter 3 — `#/account` primarily resolves at the
  // outer AppShell (sectionRegistry → AccountSection → WalletDetail).
  // If a deep-link ever leaks into the Design-OS hash listener before
  // the outer shell claims it, alias it to the wallet-detail surface
  // so the user never sees an empty home fallback.
  account:   { to: "earn" },
};

function resolveSurface(route: string): { key: keyof typeof SURFACE_FOR; arrive?: () => void } {
  if (route in SURFACE_FOR) {
    const key = route as keyof typeof SURFACE_FOR;
    // L2 · 2026-07-11 · primary surfaces can also carry a post-mount
    // effect (e.g. Support opens the Support tab of Settings).
    return { key, arrive: SURFACE_ON_ARRIVE[key] };
  }
  const alias = ALIAS_FOR[route];
  if (alias) return { key: alias.to, arrive: alias.onArrive };
  return { key: "home" };
}

function isRouteId(route: string): route is RouteId {
  return route in ROUTE_REGISTRY;
}

export function SimulatorRouter() {
  // 2026-07-19 · Cold-boot default. When the URL hash is empty on first
  // paint AND `lc:composer.mock.v1` is opt-in (default), land the user
  // directly on the mockup Composer instead of Home. This is the surface
  // being demoed today; Home + engine will get their own mockup passes
  // in follow-up sprints. Kept behind a runtime check so a user who
  // opts OUT of the mockup (`localStorage.setItem("lc:composer.mock.v1","0")`)
  // still lands on Home.
  const initialRoute: ExtendedRouteId = (() => {
    try {
      if (typeof window === "undefined") return "home";
      const rawHash = window.location.hash.replace(/^#\/?/, "").trim();
      if (rawHash) return rawHash as ExtendedRouteId;
      const useMock = window.localStorage.getItem("lc:composer.mock.v1") !== "0";
      return useMock ? "composer" : "home";
    } catch {
      return "home";
    }
  })();
  const [route, setRoute] = useState<ExtendedRouteId>(initialRoute);

  useEvent("nav:click", (p) => {
    if (p.route === route) return;
    startTransition(() => {
      setRoute(p.route as ExtendedRouteId);
    });
    // Ship-lens Block 3 P1-02 · 2026-07-11 · sync window.location.hash
    // to the clicked route so back/forward buttons + copy-URL + reload
    // land the user on the same surface. Previously nav clicks flipped
    // internal state only; the hash stayed at whatever last resolved
    // (usually `#/home`) so refresh went home + back went nowhere.
    // Guarded against re-entry by comparing before pushing — the
    // hashchange listener below will no-op when the hash already
    // matches the state.
    const nextHash = `#/${p.route}`;
    if (window.location.hash !== nextHash) {
      try {
        window.history.pushState(null, "", nextHash);
      } catch {
        /* history API blocked (e.g. sandbox) · state still flipped. */
      }
    }
    window.scrollTo({ top: 0, behavior: "instant" });
    // Run arrival effect on the next tick so the new surface has
    // mounted its event listeners.
    // L2 · 2026-07-11 · primary surfaces can also declare an arrive
    // hook (e.g. `support` opens the Support tab of Settings).
    const alias = ALIAS_FOR[p.route];
    const arrive = alias?.onArrive
      ?? SURFACE_ON_ARRIVE[p.route as keyof typeof SURFACE_FOR];
    if (arrive) window.setTimeout(arrive, 40);
  });

  // Allow direct deep-link via URL hash (e.g. #/workstation)
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace(/^#\/?/, "").trim() as ExtendedRouteId;
      if (h && (h in SURFACE_FOR || h in ALIAS_FOR)) {
        setRoute(h);
        const alias = ALIAS_FOR[h];
        const arrive = alias?.onArrive
          ?? SURFACE_ON_ARRIVE[h as keyof typeof SURFACE_FOR];
        if (arrive) window.setTimeout(arrive, 60);
      }
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const resolved = resolveSurface(route as string);
  const Page = SURFACE_FOR[resolved.key] ?? SURFACE_FOR.home;
  const shellRoute: RouteId = isRouteId(resolved.key) ? resolved.key : "home";
  const shellSpec = ROUTE_REGISTRY[shellRoute];

  // Every Design OS route renders inside the boundary — single source of
  // truth for body[data-design-os] + exposes window.__lcRunLeakTest().
  // ModalPortal wraps so context flows down to every route + descendant.
  return (
    <DesignOSBoundary>
      <ModalPortal>
        <PersistentDesignOSAppShell
          world={shellSpec.world}
          route={shellRoute}
          defaultKade={shellSpec.defaultKade}
          kadePlacement={shellSpec.kadePlacement}
          hideStickyKade={shellSpec.hideStickyKade}
        >
          <Suspense fallback={<RouteChunkFallback />}>
            <Page />
          </Suspense>
        </PersistentDesignOSAppShell>
      </ModalPortal>
    </DesignOSBoundary>
  );
}
