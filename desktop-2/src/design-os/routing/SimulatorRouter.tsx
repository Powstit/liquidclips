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
 *   #/schedule → workstation
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
const CommunityRoute = lazy(() => import("../routes/Community").then((m) => ({ default: m.CommunityRoute })));
const LibraryRoute = lazy(() => import("../routes/Library").then((m) => ({ default: m.LibraryRoute })));
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

type ExtendedRouteId = RouteId | "login" | "stop-pages" | "import" | "retrieve";

/* Primary surfaces — render directly. */
const SURFACE_FOR: Record<string, () => ReactElement> = {
  home:        () => <CommandRoom />,
  workstation: () => <WorkstationRoute />,
  submissions: () => <SubmissionsReviewRoute />,
  thumbnail:   () => <ThumbnailStudioRoute />,
  earn:        () => (
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
  ),
  community:   () => <CommunityRoute />,
  library:     () => <LibraryRoute />,
  channels:    () => <ChannelsRoute />,
  campaigns:   () => <CampaignsRoute />,
  "campaign-builder": () => <AgencyCampaignsRoute />,
  clipper:     () => <ClipperJourneyRoute />,
  analytics:   () => <AnalyticsRoute />,
  settings:    () => <SettingsRoute />,
  support:     () => <SettingsRoute />,
  login:       () => <SettingsRoute />,
  "stop-pages":() => <StopPagesRoute />,
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

const ALIAS_FOR: Record<string, Alias> = {
  // Home-rooted entry points
  create:    { to: "home", onArrive: () => bus.emit("home:open-panel", { tab: "url" }) },
  import:    { to: "home", onArrive: () => bus.emit("home:open-panel", { tab: "upload" }) },
  retrieve:  { to: "workstation" },
  // Workstation-absorbed legacy routes
  engine:    { to: "workstation" },
  studio:    { to: "workstation" },
  export:    { to: "workstation" },
  schedule:  { to: "workstation" },
  // UX-4 · Library is folded into My Clips. Old bookmarks still resolve.
  library:   { to: "workstation" },
  // 2026-07-10 · Chapter 3 — `#/account` primarily resolves at the
  // outer AppShell (sectionRegistry → AccountSection → WalletDetail).
  // If a deep-link ever leaks into the Design-OS hash listener before
  // the outer shell claims it, alias it to the wallet-detail surface
  // so the user never sees an empty home fallback.
  account:   { to: "earn" },
};

function resolveSurface(route: string): { key: keyof typeof SURFACE_FOR; arrive?: () => void } {
  if (route in SURFACE_FOR) return { key: route as keyof typeof SURFACE_FOR };
  const alias = ALIAS_FOR[route];
  if (alias) return { key: alias.to, arrive: alias.onArrive };
  return { key: "home" };
}

function isRouteId(route: string): route is RouteId {
  return route in ROUTE_REGISTRY;
}

export function SimulatorRouter() {
  const [route, setRoute] = useState<ExtendedRouteId>("home");

  useEvent("nav:click", (p) => {
    if (p.route === route) return;
    startTransition(() => {
      setRoute(p.route as ExtendedRouteId);
    });
    window.scrollTo({ top: 0, behavior: "instant" });
    // Run alias arrival effect (e.g. open create panel) on the next tick so
    // the new surface has mounted its event listeners.
    const alias = ALIAS_FOR[p.route];
    if (alias?.onArrive) window.setTimeout(alias.onArrive, 40);
  });

  // Allow direct deep-link via URL hash (e.g. #/workstation)
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace(/^#\/?/, "").trim() as ExtendedRouteId;
      if (h && (h in SURFACE_FOR || h in ALIAS_FOR)) {
        setRoute(h);
        const alias = ALIAS_FOR[h];
        if (alias?.onArrive) window.setTimeout(alias.onArrive, 60);
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
