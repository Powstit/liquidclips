"use client";

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";

const BACKEND = process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "http://localhost:8000";

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
    fetch(`${BACKEND}/onboarding/link-whop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clerk_user_id: user.id, email }),
    }).catch(() => {
      /* best-effort — the /get page + Whop webhook remain the primary paths */
    });
  }, [isLoaded, isSignedIn, user]);

  return null;
}
