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
 *
 * BUG-001 · Train B2 · 2026-07-12 · `emitBootTelemetry()` was added
 * as the first synchronous signal on cold boot. Without a boot topic
 * carrying `runtime_version` + `source_sha` + `bundle_index_html_sha256`
 * there is no way to distinguish "nav_click_performance was suppressed"
 * from "a stale bundle rendered and this build's code never mounted."
 * That gap made BUG-001 unsolvable from telemetry alone. The boot topic
 * proves which bundle actually rendered so downstream nav-click absence
 * becomes an actionable signal.
 */

import { lcDiag } from "./diagnosticLogger";

declare const __APP_VERSION__: string | undefined;

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

  // BUG-001 · Train B2 · 2026-07-12 · consolidated `nav_click_performance`
  // topic. Contract asks for one waterfall event per route change with
  // { route, click_ts, mount_ts, content_ready_ts } so HQ persistence
  // (B3) doesn't need to join four per-phase topics to reconstruct a
  // single click's timeline. Each field is the raw `startTime` of the
  // corresponding User Timing mark — a `null` means the phase never
  // fired in this cycle (e.g. content_ready_ts is null on a nav click
  // that was interrupted before the data source resolved). Emitted in
  // the SAME dedupe cycle as `interactive_ready_performance` so a
  // re-render inside one click can't storm this topic either.
  try {
    const clickTs = lookupMark(navClickMark(route));
    const mountTs = lookupMark(routeMountStartMark(route));
    const contentReadyTs = lookupMark(interactiveMark(route));
    lcDiag("nav_click_performance", {
      route,
      click_ts: clickTs !== null ? Math.round(clickTs) : null,
      mount_ts: mountTs !== null ? Math.round(mountTs) : null,
      content_ready_ts: contentReadyTs !== null ? Math.round(contentReadyTs) : null,
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

/* ─── BUG-001 · boot telemetry ────────────────────────────────────────
 *
 * The boot topic proves which bundle actually rendered on cold boot.
 * Emitted SYNCHRONOUSLY from `main.tsx` before React mount, then again
 * on `document`'s first paint via `requestAnimationFrame` so we
 * capture both "boot script started" and "first-paint bundle-verified"
 * signals with the SAME session id but DIFFERENT phase markers.
 *
 * Payload contract (BUG-001 · Train B2 spec):
 *   - runtime_version         · from `<meta name="runtime-version">`
 *                                (populated by the staged runtime
 *                                bundle at build time) OR shell fallback.
 *   - source_sha              · from `<meta name="source-sha">` if
 *                                the staged bundle injects one; else
 *                                the shell `__APP_VERSION__` constant.
 *   - bundle_index_html_sha256 · SHA-256 of `document.documentElement
 *                                .outerHTML` at emit time. Computed
 *                                async via WebCrypto — hash is the
 *                                honest "this exact HTML rendered"
 *                                fingerprint. Two boots of the same
 *                                bundle should share the same hash.
 *
 * Emit-once guard prevents accidental double-emission if a caller
 * wires this in more than one boot path (e.g. main.tsx + a StrictMode
 * remount would otherwise fire twice).
 */

const BOOT_EMITTED = { done: false };

/** Read a meta tag by name from the current document. Returns null on
 *  jsdom / non-browser environments. */
function readMeta(name: string): string | null {
  try {
    if (typeof document === "undefined") return null;
    const el = document.querySelector(`meta[name="${name}"]`);
    return el?.getAttribute("content") ?? null;
  } catch {
    return null;
  }
}

/** Shell fallback for `source_sha` / `runtime_version` when no staged
 *  bundle meta tag is present. Uses the Vite-injected `__APP_VERSION__`
 *  constant when defined; otherwise "dev". Never throws. */
function shellVersionFallback(): string {
  try {
    if (typeof __APP_VERSION__ === "string" && __APP_VERSION__.length > 0) {
      return __APP_VERSION__;
    }
  } catch { /* undeclared identifier in test env — swallow */ }
  return "dev";
}

/** Compute SHA-256 of `document.documentElement.outerHTML`. Returns
 *  hex string, or null if WebCrypto / document unavailable (jsdom
 *  without crypto polyfill, no-DOM env). Non-fatal — a null hash still
 *  produces a valid boot event, just without the bundle fingerprint. */
async function computeBundleIndexHtmlSha256(): Promise<string | null> {
  try {
    if (typeof document === "undefined") return null;
    const html = document.documentElement?.outerHTML ?? "";
    if (html.length === 0) return null;
    // Guard: some jsdom builds ship crypto but no crypto.subtle.
    const cryptoObj: Crypto | undefined =
      typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined;
    if (!cryptoObj || !cryptoObj.subtle || !cryptoObj.subtle.digest) return null;
    const bytes = new TextEncoder().encode(html);
    const digest = await cryptoObj.subtle.digest("SHA-256", bytes);
    const view = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < view.length; i++) {
      const byte = view[i]!;
      hex += byte.toString(16).padStart(2, "0");
    }
    return hex;
  } catch {
    return null;
  }
}

/**
 * Emit the `boot` telemetry topic. Idempotent: safe to call more than
 * once per session, second call is a no-op. Runs the SHA-256 hash
 * async so callers on the first-paint path aren't blocked; the boot
 * event lands on `lcDiag` the moment the hash resolves (usually the
 * next microtask). If the hash cannot be computed (no WebCrypto) the
 * event still fires with `bundle_index_html_sha256: null` so downstream
 * consumers can distinguish "unmeasurable" from "not emitted."
 *
 * Called from `main.tsx` on cold boot per BUG-001 acceptance criteria.
 *
 * Returns the in-flight Promise so tests / diagnostic callers can
 * `await` the emission if they need to observe the flushed event
 * synchronously. Production callers can ignore the return value —
 * the `void emitBootTelemetry()` fire-and-forget pattern is fine.
 */
export function emitBootTelemetry(): Promise<void> {
  if (BOOT_EMITTED.done) return Promise.resolve();
  BOOT_EMITTED.done = true;

  const runtimeVersion = readMeta("runtime-version") ?? shellVersionFallback();
  const sourceSha = readMeta("source-sha") ?? shellVersionFallback();

  // Attempt the hash asynchronously. Emit the boot event either way so
  // the topic is never missing from the telemetry stream even if the
  // digest never resolves.
  return computeBundleIndexHtmlSha256()
    .then((hash) => {
      try {
        lcDiag("boot", {
          runtime_version: runtimeVersion,
          source_sha: sourceSha,
          bundle_index_html_sha256: hash,
        });
      } catch { /* diag failure never breaks a boot */ }
    })
    .catch(() => {
      // Extremely defensive · computeBundleIndexHtmlSha256 already
      // returns null on failure, but if a future refactor makes it
      // throw we still emit an honest boot event with null hash.
      try {
        lcDiag("boot", {
          runtime_version: runtimeVersion,
          source_sha: sourceSha,
          bundle_index_html_sha256: null,
        });
      } catch { /* non-fatal */ }
    });
}

/** Test-only reset. Vitest suites call this between tests so
 *  `emitBootTelemetry()` can be re-armed. Do NOT export from an
 *  index barrel — keep the surface scoped to the test files. */
export function _resetBootTelemetryForTests(): void {
  BOOT_EMITTED.done = false;
}
