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

import { lazy, Suspense, useEffect, useState, type ReactElement } from "react";
import { useEvent, bus, type RouteId } from "../bridge";
import { DesignOSBoundary } from "../components/DesignOSBoundary";
import { ModalPortal } from "../components/ModalPortal";

/* Gate 7 (2026-06-26) — every route was being eager-imported into the
 * initial JS chunk. The home surface (CommandRoom) is the only one
 * needed on first paint; every other surface streams in when its
 * route is selected. Initial JS dropped from ~2.45 MB across 25
 * chunks to a much smaller home-only chunk + per-route chunks. */
import { CommandRoom } from "../routes/CommandRoom";
const WorkstationRoute = lazy(() => import("../routes/Workstation").then((m) => ({ default: m.WorkstationRoute })));
const SubmissionsReviewRoute = lazy(() => import("../routes/SubmissionsReview").then((m) => ({ default: m.SubmissionsReviewRoute })));
const ThumbnailStudioRoute = lazy(() => import("../routes/ThumbnailStudio").then((m) => ({ default: m.ThumbnailStudioRoute })));
const EarnRoute = lazy(() => import("../routes/Earn").then((m) => ({ default: m.EarnRoute })));
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
const LoginOnboardingRoute = lazy(() => import("../routes/LoginOnboarding").then((m) => ({ default: m.LoginOnboardingRoute })));
const StopPagesRoute = lazy(() => import("../routes/StopPages").then((m) => ({ default: m.StopPagesRoute })));

type ExtendedRouteId = RouteId | "login" | "stop-pages" | "import" | "retrieve";

/* Primary surfaces — render directly. */
const SURFACE_FOR: Record<string, () => ReactElement> = {
  home:        () => <CommandRoom />,
  workstation: () => <WorkstationRoute />,
  submissions: () => <SubmissionsReviewRoute />,
  thumbnail:   () => <ThumbnailStudioRoute />,
  earn:        () => <EarnRoute />,
  community:   () => <CommunityRoute />,
  library:     () => <LibraryRoute />,
  channels:    () => <ChannelsRoute />,
  campaigns:   () => <CampaignsRoute />,
  "campaign-builder": () => <AgencyCampaignsRoute />,
  clipper:     () => <ClipperJourneyRoute />,
  analytics:   () => <AnalyticsRoute />,
  settings:    () => <SettingsRoute />,
  support:     () => <SettingsRoute />,
  login:       () => <LoginOnboardingRoute />,
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
};

function resolveSurface(route: string): { key: keyof typeof SURFACE_FOR; arrive?: () => void } {
  if (route in SURFACE_FOR) return { key: route as keyof typeof SURFACE_FOR };
  const alias = ALIAS_FOR[route];
  if (alias) return { key: alias.to, arrive: alias.onArrive };
  return { key: "home" };
}

export function SimulatorRouter() {
  const [route, setRoute] = useState<ExtendedRouteId>("home");

  useEvent("nav:click", (p) => {
    setRoute(p.route as ExtendedRouteId);
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

  // Every Design OS route renders inside the boundary — single source of
  // truth for body[data-design-os] + exposes window.__lcRunLeakTest().
  // ModalPortal wraps so context flows down to every route + descendant.
  return (
    <DesignOSBoundary>
      <ModalPortal>
        <Suspense fallback={<RouteChunkFallback />}>
          <Page />
        </Suspense>
      </ModalPortal>
    </DesignOSBoundary>
  );
}
