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
// Log the pricing snapshot · BUG-A-001 proof
// Agency active-CTA price should be 99.99 (launch offer) · normal $500.
// Recovery brief 2026-07-08 pricing correction.
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
