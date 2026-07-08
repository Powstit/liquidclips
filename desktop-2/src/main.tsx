import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { App } from "./App";
import { BootErrorBoundary } from "./lib/BootErrorBoundary";
import { bootDiag, probeSidecarState, lcDiag } from "./lib/diagnosticLogger";
import "./index.css";

// Phase 1 recovery brief · boot-time golden-path diagnostics.
// Fires before React mounts so we capture env/runtime/Tauri state before
// any product code can throw. Sidecar probe is fire-and-forget after
// mount so BootErrorBoundary sees it without blocking render.
bootDiag();
void probeSidecarState().catch((e) => {
  lcDiag("sidecar_probe_error", { error: e instanceof Error ? e.message : String(e) });
});
// Log the pricing snapshot · BUG-A-001 proof (Agency should be $99.99, not $500)
void (async () => {
  try {
    const mod = await import("./lib/billing/types");
    const catalog = mod.PLAN_CATALOG;
    lcDiag("pricing_snapshot", {
      free: catalog.free?.priceMonthlyUsd,
      pro: catalog.pro?.priceMonthlyUsd,
      growth: catalog.growth?.priceMonthlyUsd,
      agency: catalog.agency?.priceMonthlyUsd,
      accountpack: catalog.accountpack?.priceMonthlyUsd,
      agency_matches_locked_9999: catalog.agency?.priceMonthlyUsd === 99.99,
    });
  } catch (e) {
    lcDiag("pricing_snapshot_error", { error: e instanceof Error ? e.message : String(e) });
  }
})();

// 2026-07-08 · v2.2.34 hotfix. Vite bakes VITE_* env at build time.
// v2.2.33 shipped with an empty publishable key and crashed on Intel
// because ClerkProvider throws when the key is missing. Now:
//   1. BootErrorBoundary wraps everything · a throw during mount
//      renders a Kade-branded contact panel instead of a white screen
//   2. Missing publishable key falls back to LC-ID / Whop lanes via
//      isClerkAvailable() gate in WelcomeRoute · no throw at boot
const CLERK_PUBLISHABLE_KEY =
  (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined) ?? "";

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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BootErrorBoundary>
      <AppTree />
    </BootErrorBoundary>
  </React.StrictMode>,
);
