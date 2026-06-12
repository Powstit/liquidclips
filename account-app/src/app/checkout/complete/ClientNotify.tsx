"use client";

// v0.7.55 — post a `lc:checkout-complete` message to the embed parent
// when the success page renders. The desktop EarnPanelMount or auth
// panel listener uses it to fire a fresh /sync without waiting for the
// user to reopen Earn manually.
//
// Server-component parent renders an empty hook on the page; this
// client island handles the postMessage side-effect. No UI rendered.

import { useEffect } from "react";

export function ClientNotify({ status }: { status: "success" }) {
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
  }, [status]);
  return null;
}
