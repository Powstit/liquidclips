import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { App } from "./App";
import { BootErrorBoundary } from "./lib/BootErrorBoundary";
import "./index.css";

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
