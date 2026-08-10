"use client";

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";

// Auto-link fallback for the affiliate → Whop-checkout flow.
//
// When someone buys a Liquid Clips plan through an affiliate's Whop checkout, the Whop
// membership webhook stashes a pending membership keyed by email (the buyer has
// no Liquid Clips account yet). Whop's post-checkout redirect to /get is finicky, so
// rather than depend on it, we link the moment a signed-in user loads ANY account
// page: call /onboarding/link-whop, which matches the pending membership by email
// and applies the tier. The endpoint is idempotent and a no-op when nothing is
// pending (e.g. direct Clerk/Stripe customers), so this is safe for everyone.
// sessionStorage guards it to one call per session.
//
// 2026-08-10 — routed through the server-side proxy (api/onboarding/link-whop)
// instead of calling the backend directly. The backend endpoint requires
// x-internal-secret + a server-verified clerk_user_id; this component runs
// in the browser and never held either, so every call 401'd silently since
// the endpoint's 2026-07-04 security tightening — this auto-link feature
// has been dead for over a month. See the proxy route for the full story.
export function WhopLinkBoot() {
  const { isLoaded, isSignedIn, user } = useUser();

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;
    const email = user.primaryEmailAddress?.emailAddress;
    if (!email) return;
    try {
      if (sessionStorage.getItem("jnr_whop_link_done")) return;
      sessionStorage.setItem("jnr_whop_link_done", "1");
    } catch {
      /* sessionStorage unavailable — fall through and attempt once */
    }
    fetch("/api/onboarding/link-whop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => {
      /* best-effort — the /get page + Whop webhook remain the primary paths */
    });
  }, [isLoaded, isSignedIn, user]);

  return null;
}
