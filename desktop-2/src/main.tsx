import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { App } from "./App";
import "./index.css";

// P0 first-run access (2026-07-08) · Clerk OTP is now the primary
// sign-in path. Publishable key wired via Vite env — missing key in
// dev/preview lets the shell render; the primary Clerk lane shows a
// "sign-in temporarily unavailable" state and LC-ID/Whop fallbacks
// remain operable. Production build's config-check should have caught
// a missing key before we ever reach this branch.
const CLERK_PUBLISHABLE_KEY =
  (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined) ?? "";

function AppTree(): React.ReactElement {
  if (!CLERK_PUBLISHABLE_KEY) {
    // eslint-disable-next-line no-console
    console.warn("[clerk] VITE_CLERK_PUBLISHABLE_KEY unset · OTP sign-in disabled · fallbacks operable");
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
    <AppTree />
  </React.StrictMode>
);
