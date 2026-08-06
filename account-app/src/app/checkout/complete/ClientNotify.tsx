"use client";

// v0.7.55 — post a `lc:checkout-complete` message to the embed parent
// when the success page renders. The desktop EarnPanelMount or auth
// panel listener uses it to fire a fresh /sync without waiting for the
// user to reopen Earn manually.
//
// 2026-08-05 — added the liquidclips://checkout-complete deep-link fire.
// The postMessage above only reaches a parent window when this page is
// embedded (iframe), which checkout never actually is — Whop's checkout
// runs in the system browser (commerce URLs are deliberately kept out of
// the in-app webview). Without this, nothing brought the user back to
// the desktop app after paying; they had to alt-tab manually and wait on
// a throttled focus-revalidation to see their new tier. The deep-link
// uses the same liquidclips:// custom-URL-scheme handoff `activate`
// already relies on — the OS brings the app to the foreground, and
// deepLinkBoot.ts on the desktop side forces an immediate /me refetch +
// success toast. Fire-and-forget: if no app is registered for the
// scheme, the browser no-ops (some show a one-time "open app?" prompt),
// and the visible "Open Liquid Clips" button on the page is the fallback.
//
// Server-component parent renders an empty hook on the page; this
// client island handles both side-effects. No UI rendered.

import { useEffect } from "react";

export function ClientNotify({ status, plan }: { status: "success"; plan: string }) {
  useEffect(() => {
    if (status !== "success") return;
    try {
      window.parent.postMessage(
        { type: "lc:checkout-complete", status: "success" },
        "*",
      );
    } catch {
      /* not in an iframe — no-op */
    }
    try {
      window.location.href = `liquidclips://checkout-complete?status=success&plan=${encodeURIComponent(plan)}`;
    } catch {
      /* deep-link navigation blocked — the visible button is the fallback */
    }
  }, [status, plan]);
  return null;
}
