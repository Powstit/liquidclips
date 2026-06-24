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

import { useEffect, useState, type ReactElement } from "react";
import { useEvent, bus, type RouteId } from "../bridge";
import { DesignOSBoundary } from "../components/DesignOSBoundary";
import { ModalPortal } from "../components/ModalPortal";

import { CommandRoom } from "../routes/CommandRoom";
import { WorkstationRoute } from "../routes/Workstation";
import { SubmissionsReviewRoute } from "../routes/SubmissionsReview";
import { ThumbnailStudioRoute } from "../routes/ThumbnailStudio";
import { EarnRoute } from "../routes/Earn";
import { CommunityRoute } from "../routes/Community";
import { LibraryRoute } from "../routes/Library";
import { ChannelsRoute } from "../routes/Channels";
import { CampaignsRoute } from "../routes/Campaigns";
import { ClipperJourneyRoute } from "../routes/ClipperJourney";
import { AnalyticsRoute } from "../routes/Analytics";
import { SettingsRoute } from "../routes/Settings";
import { LoginOnboardingRoute } from "../routes/LoginOnboarding";
import { StopPagesRoute } from "../routes/StopPages";

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
  campaigns:   () => <CampaignsRoute />,   // UI-3 · restored as a real surface so the agency manage strip is reachable.
  clipper:     () => <ClipperJourneyRoute />, // UI-3 · dedicated 5-chip mission map.
  analytics:   () => <AnalyticsRoute />,   // UX-4 · honest stub · agency-only.
  settings:    () => <SettingsRoute />,
  support:     () => <SettingsRoute />,
  login:       () => <LoginOnboardingRoute />,
  "stop-pages":() => <StopPagesRoute />,
};

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
        <Page />
      </ModalPortal>
    </DesignOSBoundary>
  );
}
