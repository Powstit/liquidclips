"use client";

// v0.7.55 — Client-only CTAs used by /embed/earn/page.tsx (a server
// component). Server components can't pass inline onClick handlers to
// rendered <button>s — pre-fix the page errored at hydration ("Event
// handlers cannot be passed to Client Component props") and the embed
// rendered the error-boundary digest instead of the page (the "blank
// Earn" report). All postMessage CTAs live here so the page stays a
// pure async server render.
//
// SURFACE: /embed/earn — top affiliate strip CTA + connection-badge
//          "connect bank" button.
// MAP TAGS: (O #7 — proof of identity)

import type { ReactNode } from "react";

type LinkStatus = "linked" | "unlinked" | "unknown";

/** Headline CTA on the top affiliate strip. Posts `lc:nav` so the desktop
 *  parent intercepts. When already linked, the CTA opens the affiliate
 *  dashboard panel natively; when unlinked, it opens the Whop sign-up flow
 *  (the same endpoint the connection card uses). */
export function AffiliateStripCta({
  label,
  linkStatus,
}: {
  label: string;
  linkStatus: LinkStatus;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        try {
          if (linkStatus === "linked") {
            window.parent.postMessage(
              { type: "lc:nav", to: "settings/affiliate" },
              "*",
            );
          } else {
            // Same destination as the connection card — open Whop signup
            // through the desktop's affiliate panel (handles both the Whop
            // path and the Stripe Connect path).
            window.parent.postMessage(
              { type: "lc:nav", to: "settings/account" },
              "*",
            );
          }
        } catch {
          /* outside an iframe — no-op */
        }
      }}
      className="shrink-0 self-end font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-fuchsia transition-colors hover:text-fuchsia-bright md:self-auto md:tracking-[0.16em]"
    >
      {label}
    </button>
  );
}

/** Secondary CTA inside the ConnectionBadge unlinked panel — opens the
 *  desktop's Stripe Connect flow via the same `lc:nav` channel. */
export function ConnectStripeButton({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => {
        try {
          window.parent.postMessage(
            { type: "lc:nav", to: "settings/account" },
            "*",
          );
        } catch {
          /* embed posts to parent; if parent isn't desktop, no-op */
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia/40 bg-transparent px-4 py-2 font-sans text-[13px] font-medium text-fuchsia-deep transition-colors hover:bg-fuchsia-soft/40"
    >
      {children}
    </button>
  );
}
