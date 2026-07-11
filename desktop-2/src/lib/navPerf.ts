/**
 * navPerf · Phase 1 · Campaign click-to-interactive waterfall
 * ------------------------------------------------------------
 * Instrumentation-only helper. Zero product logic. Every function
 * is wrapped in try/catch so a broken performance API never crashes
 * a nav click.
 *
 * Emits the four canonical marks + PerformanceObserver-derived
 * paint/longtask/layout-shift events through the `lcDiag` rail so
 * a normal Campaigns click writes a full waterfall to
 * /telemetry/diagnostic on the Railway backend.
 *
 * MARK 1 · nav_click              — NavRow onClick (t0)
 * MARK 2 · route_mount_start      — top of the route component body
 * MARK 3 · first_contentful_render — rAF inside a mount effect
 * MARK 4 · interactive_ready      — data source flip resolved
 *
 * Cross-module handshake: each mark is a globally-named
 * `performance.mark("lc-<phase>:<route>")` so downstream reads use
 * `performance.getEntriesByName(name)` — no module-scoped state to
 * leak across renders.
 *
 * Hardware context: Daniel is on an Intel Iris Plus iGPU where
 * backdrop-filter blur costs 4-8ms per rule per frame. This
 * instrumentation is what tells us whether those 33 rules OR the
 * React/framer/lazy-chunk pipeline is where the lag actually lives.
 */

import { lcDiag } from "./diagnosticLogger";

/** Canonical mark names — kept as helpers so no caller hand-rolls the string. */
export const navClickMark = (route: string): string => `lc-nav-click:${route}`;
export const routeMountStartMark = (route: string): string => `lc-route-mount-start:${route}`;
export const fcrMark = (route: string): string => `lc-fcr:${route}`;
export const interactiveMark = (route: string): string => `lc-interactive:${route}`;

/**
 * Emit-once dedupe. Each mark emits at most once per nav_click t0 so
 * re-renders don't storm /telemetry/diagnostic. The key is the phase
 * name + the current nav_click startTime for the route — a new click
 * (new t0) produces a fresh key and re-arms every phase.
 */
const EMITTED = new Set<string>();

function dedupeKey(phase: string, route: string): string {
  const t0 = lookupMark(navClickMark(route));
  return `${phase}:${route}:${t0 ?? "no-t0"}`;
}

function shouldEmit(phase: string, route: string): boolean {
  const key = dedupeKey(phase, route);
  if (EMITTED.has(key)) return false;
  EMITTED.add(key);
  // Bound the set so a very-long session doesn't grow unbounded.
  if (EMITTED.size > 500) {
    const first = EMITTED.values().next().value;
    if (first) EMITTED.delete(first);
  }
  return true;
}

/** Safe wrapper around `performance.mark` — never throws. */
function safeMark(name: string): number | null {
  try {
    if (typeof performance === "undefined" || !performance.mark) return null;
    performance.mark(name);
    const entries = performance.getEntriesByName(name);
    const last = entries[entries.length - 1];
    return last ? last.startTime : performance.now();
  } catch {
    return null;
  }
}

/** Return the startTime of the most-recent mark with `name`, or null. */
function lookupMark(name: string): number | null {
  try {
    if (typeof performance === "undefined" || !performance.getEntriesByName) return null;
    const entries = performance.getEntriesByName(name);
    if (entries.length === 0) return null;
    const last = entries[entries.length - 1];
    return last.startTime;
  } catch {
    return null;
  }
}

/**
 * Wall-clock measure between two marks. Returns duration or null.
 * `performance.measure` is preferred over subtracting `startTime`s
 * because the browser records it as a User Timing entry (visible in
 * DevTools Performance panel).
 */
function safeMeasure(name: string, startMark: string, endMark: string): number | null {
  try {
    if (typeof performance === "undefined" || !performance.measure) return null;
    const entry = performance.measure(name, startMark, endMark);
    // Safari returns void from measure() in older builds; fall back
    // to the last measure entry with this name.
    if (entry && typeof entry.duration === "number") return entry.duration;
    const entries = performance.getEntriesByName(name, "measure");
    const last = entries[entries.length - 1];
    return last ? last.duration : null;
  } catch {
    return null;
  }
}

/**
 * MARK 1 · nav_click
 * Fired the moment the user clicks a NavRow. This is t0 for the
 * whole waterfall. No delta — every other mark measures back to
 * this one.
 */
export function markNavClick(route: string): void {
  const t = safeMark(navClickMark(route));
  try {
    lcDiag("nav_click_performance", {
      route,
      ts_ms: t !== null ? Math.round(t) : null,
    });
  } catch { /* diag emit never blocks a click */ }
}

/**
 * MARK 2 · route_mount_start
 * Fired at the top of the route component body. For a lazy route
 * this includes chunk streaming + parse time — delta from
 * nav_click is our chunk-load estimate. Deduped per nav_click t0
 * so re-renders inside the same click cycle only emit once.
 */
export function markRouteMountStart(route: string): void {
  // Ship-lens P1-003 · 2026-07-11 · dedupe FIRST so a re-render inside
  // one click cycle (state churn, StrictMode double-render) doesn't
  // append a new entry to performance.getEntries() every time. Prior
  // code marked before the dedupe check → session-lifetime User Timing
  // buffer growth on any long Campaigns visit.
  if (!shouldEmit("route_mount", route)) return;
  safeMark(routeMountStartMark(route));
  const delta = safeMeasure(
    `lc-measure:mount-from-click:${route}`,
    navClickMark(route),
    routeMountStartMark(route),
  );
  try {
    lcDiag("route_mount_performance", {
      route,
      delta_ms_from_nav_click: delta !== null ? Math.round(delta) : null,
      chunk_load_ms_estimated: delta !== null ? Math.round(delta) : null,
    });
  } catch { /* diag emit never blocks a mount */ }
}

/**
 * MARK 3 · first_contentful_render
 * Fired inside a mount useEffect wrapped in requestAnimationFrame
 * so we hit the paint tick after DOM commit. Delta from
 * route_mount_start captures React render + framer entrance.
 */
export function markFirstContentfulRender(route: string): void {
  // Ship-lens P1-003 · same dedupe-first fix as markRouteMountStart.
  if (!shouldEmit("fcr", route)) return;
  safeMark(fcrMark(route));
  const dFromMount = safeMeasure(
    `lc-measure:fcr-from-mount:${route}`,
    routeMountStartMark(route),
    fcrMark(route),
  );
  const dFromClick = safeMeasure(
    `lc-measure:fcr-from-click:${route}`,
    navClickMark(route),
    fcrMark(route),
  );
  try {
    lcDiag("first_contentful_render_performance", {
      route,
      delta_ms_from_mount_start: dFromMount !== null ? Math.round(dFromMount) : null,
      total_delta_ms_from_click: dFromClick !== null ? Math.round(dFromClick) : null,
    });
  } catch { /* non-fatal */ }
}

/**
 * MARK 4 · interactive_ready
 * Fired the tick the campaigns data source flips out of the
 * initial state (real-http / real-rpc / mock resolved). Delta
 * from fcr captures /campaigns fetch + tier-cap resolution.
 */
export function markInteractiveReady(
  route: string,
  extras: {
    campaigns_data_source: "real-rpc" | "real-http" | "mock" | "unknown";
    campaigns_count: number;
  },
): void {
  // Ship-lens P1-003 · same dedupe-first fix — this one especially
  // matters because it re-runs whenever the campaigns hook state
  // changes (filter flip, tier hydration). Would otherwise be the
  // largest User Timing buffer contributor.
  if (!shouldEmit("interactive", route)) return;
  safeMark(interactiveMark(route));
  const dFromFcr = safeMeasure(
    `lc-measure:interactive-from-fcr:${route}`,
    fcrMark(route),
    interactiveMark(route),
  );
  const dFromClick = safeMeasure(
    `lc-measure:interactive-from-click:${route}`,
    navClickMark(route),
    interactiveMark(route),
  );
  try {
    lcDiag("interactive_ready_performance", {
      route,
      delta_ms_from_fcr: dFromFcr !== null ? Math.round(dFromFcr) : null,
      total_delta_ms_from_click: dFromClick !== null ? Math.round(dFromClick) : null,
      campaigns_data_source: extras.campaigns_data_source,
      campaigns_count: extras.campaigns_count,
    });
  } catch { /* non-fatal */ }
}

/**
 * PerformanceObserver setup · paint + longtask + layout-shift
 *
 * Attached ONCE per route mount. Each observer type is registered
 * in its own try/catch so an unsupported type (older Chromium)
 * doesn't kill the others. Returns a cleanup fn the caller must
 * invoke on unmount so observers don't leak across route swaps.
 */
export function attachRoutePerformanceObservers(route: string): () => void {
  const observers: PerformanceObserver[] = [];

  if (typeof PerformanceObserver === "undefined") {
    return () => { /* no-op */ };
  }

  // Paint entries · first-paint · first-contentful-paint
  try {
    const paintObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        try {
          lcDiag("paint_performance", {
            route,
            entry_name: entry.name,
            start_time_ms: Math.round(entry.startTime),
            duration_ms: Math.round(entry.duration),
          });
        } catch { /* non-fatal */ }
      }
    });
    paintObs.observe({ type: "paint", buffered: true });
    observers.push(paintObs);
  } catch { /* paint not supported */ }

  // Long tasks · >50ms main-thread blocks
  try {
    const longObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        try {
          lcDiag("long_task_performance", {
            route,
            entry_name: entry.name,
            start_time_ms: Math.round(entry.startTime),
            duration_ms: Math.round(entry.duration),
          });
        } catch { /* non-fatal */ }
      }
    });
    longObs.observe({ type: "longtask", buffered: true });
    observers.push(longObs);
  } catch { /* longtask not supported in some builds */ }

  // Layout shifts · CLS increments
  try {
    const lsObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // layout-shift entries carry `value` + `hadRecentInput` but
        // aren't in the standard TS lib · widen inline.
        const ls = entry as PerformanceEntry & {
          value?: number;
          hadRecentInput?: boolean;
        };
        try {
          lcDiag("layout_shift_performance", {
            route,
            start_time_ms: Math.round(entry.startTime),
            value: typeof ls.value === "number" ? ls.value : null,
            had_recent_input: typeof ls.hadRecentInput === "boolean" ? ls.hadRecentInput : null,
          });
        } catch { /* non-fatal */ }
      }
    });
    lsObs.observe({ type: "layout-shift", buffered: true });
    observers.push(lsObs);
  } catch { /* layout-shift not supported */ }

  return () => {
    for (const obs of observers) {
      try { obs.disconnect(); } catch { /* non-fatal */ }
    }
  };
}
