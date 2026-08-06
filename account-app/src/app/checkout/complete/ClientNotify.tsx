"use client";

// v0.7.55 — post a `lc:checkout-complete` message to the embed parent
// when the success page renders. The desktop EarnPanelMount or auth
// panel listener uses it to fire a fresh /sync without waiting for the
// user to reopen Earn manually.
//
// 2026-08-05 — added the liquidclips://checkout-complete deep-link fire.
// The postMessage above only reaches a parent window when this page is
// embedded in an iframe. On desktop it instead loads inside the app's
// in-app browser overlay — a genuinely separate native webview panel
// (see desktop-2/src-tauri/src/browse.rs's open_browse_panel), not a
// child of the main app window, so postMessage can't reach it either.
// Without this, nothing told the main app a payment had just gone
// through; the new tier only appeared on the next throttled
// focus-revalidation. The deep-link uses the same liquidclips://
// custom-URL-scheme handoff `activate` already relies on — the OS
// routes it to the running app instance regardless of which webview
// fired it, and deepLinkBoot.ts on the desktop side forces an immediate
// /me refetch + success toast. Fire-and-forget: if no app is registered
// for the scheme, the browser no-ops (some show a one-time "open app?"
// prompt), and the visible "Open Liquid Clips" button is the fallback.
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
