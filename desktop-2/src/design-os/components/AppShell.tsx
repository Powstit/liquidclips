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
import { KadeSpeechBubble } from "./KadeSpeechBubble";
import { AnnouncementBanner } from "./AnnouncementBanner";
import { ChatToggle } from "./ChatToggle";
import { UpgradeApprovalModal } from "./UpgradeApprovalModal";
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

  /* 2026-06-30 · global troubleshooting bridge.
   * Listens to engine:error (already emitted by useEngineSession on
   * sidecar bake failures) and the browser's unhandledrejection event
   * (catches network failures from authedFetch / fetch wrappers that
   * the route's own error boundary didn't swallow). On either signal:
   *   - flip Kade to "alert" mood via kade:mood
   *   - emit a kade:speak with a human title + body
   * The KadeSpeechBubble mounts the bubble; StickyKade applies the
   * mood overlay. Both auto-dismiss after their respective TTLs. */
  useEvent("engine:error", (p) => {
    bus.emit("kade:mood", { mood: "alert" });
    bus.emit("kade:speak", {
      title: "Engine hit a snag",
      body: p.human ?? p.error ?? "Liquid Clips couldn't finish that run. We saved your progress · try again or open the Diagnostics tab in Settings.",
      severity: "error",
    });
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    /* unhandledrejection · catches uncaught Promise rejections from
     * any background fetch chain. Synchronous throws are caught by
     * EngineErrorBoundary inside each route. */
    const onReject = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "An unexpected background error happened.";
      /* Filter known-safe rejections so the bubble doesn't cry wolf
       * on aborted fetches and dev HMR signals. */
      if (/AbortError|user aborted/i.test(message)) return;
      bus.emit("kade:mood", { mood: "alert" });
      bus.emit("kade:speak", {
        title: "Background hiccup",
        body: message,
        severity: "warn",
      });
    };
    window.addEventListener("unhandledrejection", onReject);
    return () => window.removeEventListener("unhandledrejection", onReject);
  }, []);

  // NOTE: body[data-design-os="active"] is owned by DesignOSBoundary (the
  // single source of truth). See SimulatorRouter — it wraps the whole tree.

  return (
    <div className="lc-app" data-route={route} data-world={world}>
      <CursorGlow />
      <WorldLayer world={world} />

      {/* v2.2.9 broadcast layer · fixed-position banner stack. Default-
       *  hides when /sync.active_announcements is empty so the pinned
       *  Workstation visual baseline stays at 0% pixel drift. */}
      <AnnouncementBanner />

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
      {/* Speech bubble travels with Kade · same hide gate so on routes
       *  that hide Kade entirely (Workstation post-complete · Login boot)
       *  the bubble never paints. */}
      {!hideStickyKade && <KadeSpeechBubble />}

      {/* v2.2.10 native community chat · floating overlay. Mounted at
       *  shell level so every route hosts it. The panel default-hides
       *  behind a toggle so the pinned Workstation visual baseline
       *  stays at 0% drift when closed. Same kade-hide gate so the
       *  Login boot sequence and the Workstation post-complete view
       *  don't paint a chat affordance. */}
      {!hideStickyKade && <ChatToggle />}

      {/* v2.2.15 · one-click trial-to-paid modal · listens for
       *  trial:upgrade-request on the bus (fired by TrialStatusPill,
       *  paywall 402s, Settings). Returns null when the viewer isn't
       *  on a trial · zero visual baseline drift. */}
      <UpgradeApprovalModal />

      {/* Phase 6B infrastructure · render nothing until used.
       *  NOTE: <ModalPortal> is mounted higher up at SimulatorRouter so its
       *  context is available to every route. */}
      <DropOverlay />
      <ToastHost />
    </div>
  );
}

/** Sprint G.4 · Kade Reactive Onboarding · pose reaction map. Each
 *  entry maps a `OnboardingMilestone` to a `KadeState` pose. Every pose
 *  referenced here MUST exist in the KadeState union (line 15 of
 *  events.ts) so `getKade()` can resolve it. Add a new milestone at
 *  the bottom (never rename existing keys — the emitter fires by name
 *  and a rename would silently drop a pose reaction). */
const MILESTONE_TO_POSE = {
  signed_up_at:                  "celebration",
  first_launch_at:               "success",
  first_clip_at:                 "celebration",
  first_publish_at:              "publishing",
  first_earn_view_at:            "earn-mode",
  first_bounty_submit:           "reading-brief",
  first_paid_referral:           "celebration",
  agency_owner_first_campaign:   "campaign-mode",
  agency_owner_first_invite:     "community-mode",
  agency_member_accepted_at:     "campaign-mode",
} as const satisfies Record<string, KadeState>;
type MilestoneKey = keyof typeof MILESTONE_TO_POSE;

const MILESTONE_HOLD_MS = 2400;

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

  // Sprint G.4 · Kade Reactive Onboarding subscriber. When the emitter
  // fires an `onboarding:milestone`, swap to the mapped pose for
  // MILESTONE_HOLD_MS then fall back to the route's default. Silently
  // ignores milestone keys that don't yet have a pose (fail-soft — the
  // emitter's vocabulary can widen without touching this file).
  useEvent("onboarding:milestone", (p) => {
    const pose = MILESTONE_TO_POSE[p.milestone as MilestoneKey];
    if (!pose) return;
    setKade(pose);
    const t = window.setTimeout(() => setKade(defaultKade), MILESTONE_HOLD_MS);
    return () => window.clearTimeout(t);
  });

  const flashKade = (k: KadeState, ms = 1200) => {
    setKade(k);
    window.setTimeout(() => setKade(defaultKade), ms);
  };

  return { kade, setKade, flashKade };
}
