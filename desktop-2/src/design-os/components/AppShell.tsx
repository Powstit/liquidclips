/**
 * AppShell · the Design-OS room frame
 *
 * NOT the same as `src/shell/AppShell.tsx` (that's the legacy hash-router shell
 * — frozen, do not edit). This is the inner room shell that a single route
 * mounts to wrap its content with WorldLayer + ConsoleNav + TopHud + Kade.
 *
 * Route components compose:
 *   <DesignOSAppShell world="cockpit-home" route="home" kadeState="idle">
 *     ...page content...
 *   </DesignOSAppShell>
 */

import { useEffect, useState, type ReactNode } from "react";
import { WorldLayer, type WorldKey } from "./WorldLayer";
import { ConsoleNav } from "./ConsoleNav";
import { TopHud } from "./TopHud";
import { StickyKade, type KadePlacement } from "./StickyKade";
import { CursorGlow } from "../effects/CursorGlow";
import { DropOverlay } from "../effects/DropOverlay";
import { ToastHost } from "../effects/ToastHost";
import { AgencyPreviewBanner } from "../../components/paywall/AgencyPreviewBanner";
import { bus, useEvent, type KadeState, type RouteId } from "../bridge";
import "./AppShell.css";

export interface DesignOSAppShellProps {
  world: WorldKey;
  /** RouteId for navigable routes; "login" is allowed for the activation
   *  surface so data-route in the DOM is honest about which surface is
   *  mounted. RouteId-keyed lookups (copyMap, routeRegistry) don't need
   *  to grow for "login" since LoginOnboarding bypasses them. */
  route: RouteId | "login";
  /** Default Kade pose for this route — used when no nav-hover or demo is active. */
  defaultKade: KadeState;
  /** Where Kade sits in the first viewport. Defaults to "bottom-right".
   *  Per-route values land via routeRegistry in item 5 — passing it here
   *  lets a route override (e.g. Command Room → "center"). */
  kadePlacement?: KadePlacement;
  children: ReactNode;
  /** Hide the sticky Kade — only used on routes that render Kade INSIDE a panel
   *  (e.g. Login boot sequence). Default false → Kade is always visible above
   *  the fold on every primary route. */
  hideStickyKade?: boolean;
}

export function DesignOSAppShell({
  world, route, defaultKade, kadePlacement = "bottom-right", children, hideStickyKade = false,
}: DesignOSAppShellProps) {
  // Emit route:enter on every route change. Kade lives in StickyKade now.
  // "login" is allowed on the route prop for DOM-attribute honesty, but the
  // bus contract + ConsoleNav lookup tables are keyed by RouteId. Fall back
  // to "home" for those consumers — the login route is a chrome-only state
  // where bus listeners / nav highlighting don't have a meaningful target.
  const routeForRegistry: RouteId = route === "login" ? "home" : route;
  useEffect(() => {
    bus.emit("route:enter", { route: routeForRegistry });
  }, [routeForRegistry]);

  // NOTE: body[data-design-os="active"] is owned by DesignOSBoundary (the
  // single source of truth). See SimulatorRouter — it wraps the whole tree.

  return (
    <div className="lc-app" data-route={route} data-world={world}>
      <CursorGlow />
      <WorldLayer world={world} />

      <ConsoleNav activeRoute={routeForRegistry} />

      <section className="lc-main">
        {/* AgencyPreviewBanner renders nothing in clipper mode; shows
            full banner for non-Agency users in agency mode; shows small
            "Agency active" pill for true Agency users in agency mode. */}
        <AgencyPreviewBanner />
        <TopHud />
        <div className="lc-scroll">
          {children}
        </div>
      </section>

      {!hideStickyKade && <StickyKade defaultState={defaultKade} placement={kadePlacement} />}

      {/* Phase 6B infrastructure · render nothing until used.
       *  NOTE: <ModalPortal> is mounted higher up at SimulatorRouter so its
       *  context is available to every route. */}
      <DropOverlay />
      <ToastHost />
    </div>
  );
}

/** Exposed so route components (e.g. proof panels) can drive a LOCAL Kade
 *  state, distinct from the StickyKade. Used rarely. */
export function useKadeState(defaultKade: KadeState): {
  kade: KadeState;
  setKade: (k: KadeState) => void;
  flashKade: (k: KadeState, ms?: number) => void;
} {
  const [kade, setKade] = useState<KadeState>(defaultKade);

  useEffect(() => {
    setKade(defaultKade);
  }, [defaultKade]);

  useEvent("nav:hover", (p) => {
    setKade(p.kade);
    const t = window.setTimeout(() => setKade(defaultKade), 900);
    return () => window.clearTimeout(t);
  });

  const flashKade = (k: KadeState, ms = 1200) => {
    setKade(k);
    window.setTimeout(() => setKade(defaultKade), ms);
  };

  return { kade, setKade, flashKade };
}
