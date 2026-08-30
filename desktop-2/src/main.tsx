import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { App } from "./App";
import { BootErrorBoundary } from "./lib/BootErrorBoundary";
import { bootDiag, probeSidecarState, lcDiag } from "./lib/diagnosticLogger";
// 2026-08-30 · Sentry + PostHog init. Fires synchronously BEFORE
// bootDiag() so both monitors are online in time to catch boot-path
// crashes. Env-gated inside — missing VITE_SENTRY_DSN or
// VITE_POSTHOG_KEY = silent no-op, no throw.
import { initMonitoring } from "./lib/telemetry/monitoringInit";
// 2026-08-30 · PostHog page-view observer. The desktop is a Tauri SPA
// so PostHog's autocapture is disabled — this observer fires
// `$pageview` events on hashchange + design-os `nav:click` so funnel
// analytics have a real anchor per route. Silent no-op when PostHog
// isn't initialised.
import { installPageviewObserver } from "./lib/telemetry/pageviewObserver";
// BUG-001 · Train B2 · 2026-07-12 · boot telemetry emit. Fires the
// `boot` topic with runtime_version + source_sha + bundle_index_html
// _sha256 so downstream nav-click absence becomes an actionable signal
// (previously we couldn't tell whether a stale bundle rendered or the
// diagnostic buffer never flushed). Idempotent · safe to call from
// multiple boot paths.
import { emitBootTelemetry } from "./lib/navPerf";
// Wave D1 · j015-runtime-update (2026-07-12) · Codex-model.
// Boot-side restore verification. Reads `lc.restore.v1` (written by
// the RestartGate before the app quit for an update), compares the
// booted runtime version against the staged version, and either
// restores state (matched) or flips the journey to State 7 failed
// (mismatched). Called AFTER runtime_info resolves so we compare
// against the real active bundle, not the shell fallback.
import { verifyBootAndRestore } from "./lib/updateJourney";
import "./index.css";

// 2026-07-08 · v2.2.34 hotfix. Vite bakes VITE_* env at build time.
// v2.2.33 shipped with an empty publishable key and crashed on Intel
// because ClerkProvider throws when the key is missing. Declared FIRST
// so the Phase 1 diagnostic probes below can inspect it before mount.
const CLERK_PUBLISHABLE_KEY =
  (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined) ?? "";

// 2026-08-30 · Monitor bootstrap. Must run BEFORE bootDiag() so
// PostHog is attached to globalThis when the first lcDiag event
// batch flushes, and BEFORE React mount so Sentry catches any
// crash inside the boot path itself.
const monitoringStatus = initMonitoring();
// PostHog page-view observer. Runs right after init so the initial
// $pageview fires with the correct globalThis.posthog reference.
// Silent no-op when PostHog isn't initialised (env-gated inside).
installPageviewObserver();

// Phase 1 recovery brief · boot-time golden-path diagnostics.
// Fires before React mounts so we capture env/runtime/Tauri state before
// any product code can throw. Sidecar probe is fire-and-forget after
// mount so BootErrorBoundary sees it without blocking render.
bootDiag();
// 2026-08-30 · confirm whether the monitors came online. Shows up
// in the diagnostic buffer so support tickets can distinguish
// "silent monitoring" from "silent product" during triage.
lcDiag("monitoring_boot", monitoringStatus);
// BUG-001 · Train B2 · 2026-07-12 · emit the nav-perf boot topic
// synchronously alongside bootDiag() so the very first telemetry
// batch flushed by lcDiag carries proof of which bundle rendered.
// bundle_index_html_sha256 is computed async · the topic still lands
// on the first flush interval (2s). Idempotent — a StrictMode double-
// invoke or a runtime hot-swap re-mount is a silent no-op.
emitBootTelemetry();
void probeSidecarState().catch((e) => {
  lcDiag("sidecar_probe_error", { error: e instanceof Error ? e.message : String(e) });
});
// Wave D1 · j015-runtime-update State 6 · boot-restore check.
// Read the runtime-active version (falls back to the shell version
// in browser preview) then hand it to `verifyBootAndRestore`. Emits
// `update_boot_verified` + `route_restored_after_update` telemetry
// and clears `lc.restore.v1` on success. Fire-and-forget so a slow
// `runtime_info` invoke doesn't block React mount.
void (async () => {
  try {
    let bootedVersion: string | null = null;
    const w = typeof window !== "undefined"
      ? (window as unknown as Record<string, unknown>)
      : {};
    if ("__TAURI_INTERNALS__" in w) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const info = await invoke<{ active_version: string }>("runtime_info");
        bootedVersion = info?.active_version ?? null;
      } catch {
        /* runtime_info missing · fall through */
      }
    }
    if (!bootedVersion) {
      // Shell fallback · use the sync reader from useRuntimeVersion.
      const mod = await import("./lib/useRuntimeVersion");
      bootedVersion = mod.runtimeVersionSync();
    }
    verifyBootAndRestore({ bootedVersion });
  } catch (e) {
    lcDiag("update_boot_verify_error", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
})();
// Recovery brief P0 (2026-07-08) · Daniel-mandated probe. The .load() crash
// on WelcomeRoute was mistakenly attributed to Clerk. Log the shape of
// @clerk/clerk-react as it is actually imported so we can rule Clerk in or
// out of any future TypeError shaped like "X.load is not a function".
void (async () => {
  try {
    const clerkMod = await import("@clerk/clerk-react");
    const modAny = clerkMod as unknown as Record<string, unknown>;
    lcDiag("clerk_import_shape", {
      valueType: typeof clerkMod,
      keys: Object.keys(modAny).slice(0, 24),
      hasClerkProvider: typeof modAny.ClerkProvider !== "undefined",
      hasUseSignIn: typeof modAny.useSignIn !== "undefined",
      hasUseAuth: typeof modAny.useAuth !== "undefined",
      hasLoad: !!(modAny.load),                // false expected · we DO NOT call .load() manually
      hasDefaultExport: typeof modAny.default !== "undefined",
      publishable_key_len: CLERK_PUBLISHABLE_KEY.length,
      publishable_key_prefix: CLERK_PUBLISHABLE_KEY.slice(0, 8),
    });
  } catch (e) {
    lcDiag("clerk_import_error", { error: e instanceof Error ? e.message : String(e) });
  }
})();
// Log the pricing snapshot · Agency flat $99.99/mo (pricing pivot
// 2026-07-06 · liquid_clips_pricing_pivot_2026-07-06). No launch-offer
// strike-through, no "$500 normally" leak. If launchOffer.active flips
// back on in types.ts the snapshot below reflects it automatically.
void (async () => {
  try {
    const mod = await import("./lib/billing/types");
    const catalog = mod.PLAN_CATALOG;
    const agency = catalog.agency;
    lcDiag("pricing_snapshot", {
      free: catalog.free?.priceMonthlyUsd,
      pro: catalog.pro?.priceMonthlyUsd,
      growth: catalog.growth?.priceMonthlyUsd,
      agency_active_cta_price: agency?.priceMonthlyUsd,
      agency_launch_offer_active: agency?.launchOffer?.active ?? false,
      agency_launch_offer_label: agency?.launchOffer?.label ?? null,
      agency_normal_price: agency?.launchOffer?.normalPriceMonthlyUsd ?? null,
      agency_matches_whop_9999: agency?.priceMonthlyUsd === 99.99,
      accountpack: catalog.accountpack?.priceMonthlyUsd,
    });
  } catch (e) {
    lcDiag("pricing_snapshot_error", { error: e instanceof Error ? e.message : String(e) });
  }
})();

// (CLERK_PUBLISHABLE_KEY moved to top of file so diagnostic probes above
// can inspect it. Docstring for its role:
//   Vite bakes VITE_* env at build time. v2.2.33 shipped with an empty
//   key and crashed on Intel because ClerkProvider throws when the key
//   is missing. Now: BootErrorBoundary wraps everything (Kade panel on
//   crash), and missing key falls back to LC-ID / Whop lanes via
//   isClerkAvailable() gate in WelcomeRoute · no throw at boot.)

function AppTree(): React.ReactElement {
  if (!CLERK_PUBLISHABLE_KEY) {
    // eslint-disable-next-line no-console
    console.warn(
      "[clerk] VITE_CLERK_PUBLISHABLE_KEY unset · OTP sign-in disabled · fallbacks operable",
    );
    return <App />;
  }
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <App />
    </ClerkProvider>
  );
}

// LCOS Golden Path Proof · dev-only canonical-state probe.
// Exposes a READ-ONLY window handle that Playwright uses to snapshot
// data-identity-* attributes + LocalStorage + telemetry buffer for each
// step of the golden-path walk. Gated on `import.meta.env.DEV` so the
// production bundle tree-shakes it. Does NOT touch auth / payment /
// identity behaviour — INV-008 compliant (READ-ONLY exposure).
if (import.meta.env.DEV) {
  type LcosProbe = {
    getIdentityCopy(): string | null;
    getIdentityKind(): string | null;
    getIdentityState(): string | null;
    hasJwt(): boolean;
    getJwtLen(): number;
    getMode(): string | null;
    getRouteHash(): string;
    canonicalState(): Record<string, unknown>;
  };
  const probe: LcosProbe = {
    getIdentityCopy() {
      const el = document.querySelector("[data-identity-copy]");
      return el?.getAttribute("data-identity-copy") ?? null;
    },
    getIdentityKind() {
      const el = document.querySelector("[data-identity-kind]");
      return el?.getAttribute("data-identity-kind") ?? null;
    },
    getIdentityState() {
      const el = document.querySelector("[data-identity-state]");
      return el?.getAttribute("data-identity-state") ?? null;
    },
    hasJwt() {
      try {
        return !!window.localStorage.getItem("lc.license.jwt.v1");
      } catch {
        return false;
      }
    },
    getJwtLen() {
      try {
        return (window.localStorage.getItem("lc.license.jwt.v1") ?? "").length;
      } catch {
        return 0;
      }
    },
    getMode() {
      try {
        return window.localStorage.getItem("lc.mode.v1");
      } catch {
        return null;
      }
    },
    getRouteHash() {
      try {
        return window.location.hash || "";
      } catch {
        return "";
      }
    },
    canonicalState() {
      return {
        "state.authenticated": {
          hasJwt: this.hasJwt(),
          jwtLen: this.getJwtLen(),
          source: "localStorage",
        },
        "state.current-user.identity-copy": this.getIdentityCopy(),
        "state.current-user.identity-kind": this.getIdentityKind(),
        "state.current-user.identity-state": this.getIdentityState(),
        "state.mode": this.getMode(),
        "state.route-hash": this.getRouteHash(),
      };
    },
  };
  (window as unknown as { __LCOS_PROBE__: LcosProbe }).__LCOS_PROBE__ = probe;
  // Telemetry buffer capture: mirror lcDiag events into a ring buffer so
  // Playwright can grab them after each step.
  (window as unknown as { __LCOS_TELEMETRY__: unknown[] }).__LCOS_TELEMETRY__ = [];
  void import("./lib/diagnosticLogger").then((mod) => {
    const orig = mod.lcDiag;
    (mod as unknown as { lcDiag: typeof orig }).lcDiag = (
      topic: string,
      data: Record<string, unknown> = {},
    ) => {
      try {
        const buf = (window as unknown as { __LCOS_TELEMETRY__: unknown[] })
          .__LCOS_TELEMETRY__;
        buf.push({ ts: Date.now(), topic, data });
        if (buf.length > 500) buf.shift();
      } catch {
        /* noop */
      }
      return orig(topic, data);
    };
  }).catch(() => { /* noop */ });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BootErrorBoundary>
      <AppTree />
    </BootErrorBoundary>
  </React.StrictMode>,
);
