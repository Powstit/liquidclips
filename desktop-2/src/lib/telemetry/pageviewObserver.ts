/**
 * pageviewObserver · fires `$pageview` events into PostHog on route changes.
 *
 * The desktop app is a Tauri webview (SPA · hash routing) so PostHog's
 * automatic pageview capture is disabled in monitoringInit.ts. Without
 * a manual replacement, PostHog dashboards can see individual custom
 * events firing but can't build funnels because they have no anchor
 * for "user was on route X at time T."
 *
 * This module fixes that with one hashchange listener + one bus
 * subscribe. Neither is expensive. Both fire the same shape event:
 *
 *   posthog.capture('$pageview', {
 *     $current_url: 'app://liquidclips/home',
 *     lc_route: 'home',
 *     lc_source: 'hashchange' | 'nav:click',
 *   })
 *
 * The synthetic `$current_url` gives PostHog's "Recordings" and
 * "Paths" features a stable per-route URL (real Tauri window.location
 * is `tauri://localhost/…` which PostHog can't render). `lc_route` is
 * the raw route id so you can filter without regex on the URL.
 *
 * Idempotency: guarded so init-twice (StrictMode double-invoke,
 * runtime bundle swap) doesn't double-attach listeners.
 */

import { bus } from "../../design-os/bridge";

// Guard against double-init when the file is imported twice (e.g.
// under React StrictMode's double-invoke pattern or after a runtime
// bundle swap during hot promotion).
let installed = false;
let lastFiredRoute: string | null = null;

/**
 * Install the observer. Safe to call multiple times — subsequent
 * calls are a no-op. Called once from main.tsx after initMonitoring().
 */
export function installPageviewObserver(): void {
  if (installed) return;
  installed = true;

  const fire = (route: string, source: "hashchange" | "nav:click" | "boot"): void => {
    if (!route) return;
    // Suppress duplicate consecutive fires — SimulatorRouter fires
    // both hashchange AND nav:click for the same transition, and we
    // don't want two $pageview events per navigation.
    if (route === lastFiredRoute) return;
    lastFiredRoute = route;
    try {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const ph = (globalThis as unknown as { posthog?: {
        capture: (event: string, props: Record<string, unknown>) => void;
      }}).posthog;
      if (!ph || typeof ph.capture !== "function") return;
      ph.capture("$pageview", {
        // Synthetic URL so PostHog's Paths / Recordings features render
        // something usable. Real Tauri window.location is opaque.
        $current_url: `app://liquidclips/${route}`,
        lc_route: route,
        lc_source: source,
      });
    } catch {
      /* PostHog absent (dev, no key) · silent no-op */
    }
  };

  const routeFromHash = (): string => {
    try {
      const raw = (window.location.hash || "").replace(/^#\/?/, "").trim();
      // Truncate at query/anchor separators so `#/campaigns?x=1` and
      // `#/campaigns#more` both fire as `campaigns`.
      const bare = raw.split(/[?#]/)[0] || "home";
      return bare;
    } catch {
      return "";
    }
  };

  // Wire 1 · hashchange fires whenever the outer URL hash changes
  // (typed URL, window.history.pushState in SimulatorRouter Block 3,
  // browser back / forward).
  try {
    window.addEventListener("hashchange", () => {
      fire(routeFromHash(), "hashchange");
    });
  } catch {
    /* SSR / hostile environment · no-op */
  }

  // Wire 2 · bus 'nav:click' fires for design-os internal route
  // changes (sidebar clicks · browse-overlay quick-links · programmatic
  // route swaps). Payload is `{ route: string }` per the router
  // subscribe at design-os/routing/SimulatorRouter.tsx:296.
  try {
    bus.on("nav:click", (payload) => {
      const route = payload?.route;
      if (typeof route === "string" && route.length > 0) {
        fire(route, "nav:click");
      }
    });
  } catch {
    /* bus API drift · no-op */
  }

  // Wire 3 · initial fire on boot so the first route the user lands
  // on becomes the anchor for their session, without waiting for
  // their first navigation.
  const initial = routeFromHash();
  if (initial) fire(initial, "boot");
}
