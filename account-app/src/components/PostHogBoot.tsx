"use client";

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { initAnalytics, identifyUser, resetAnalytics, track } from "@/lib/analytics";

// First-touch referral signal: read the affiliate id from the ?ref/?a param
// or the jnr_ref cookie the marketing site set. IDs only — never email/name.
function readAffiliateRef(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const p = new URLSearchParams(window.location.search);
    const fromUrl = p.get("ref") || p.get("a");
    if (fromUrl) return fromUrl;
  } catch {
    /* ignore */
  }
  const m = document.cookie.match(/(?:^|;\s*)jnr_ref=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// Boots PostHog once on first render and keeps the identified user in sync
// with Clerk. Lives in the root layout via a client wrapper so SSR pages
// stay server-rendered. Returns null — it's effects-only.
export function PostHogBoot() {
  const { isLoaded, isSignedIn, user } = useUser();

  useEffect(() => {
    initAnalytics();
    // Fire affiliate_link_clicked once per session if this visitor arrived via
    // a referral. sessionStorage dedup so route changes don't re-count. track()
    // no-ops when PostHog isn't configured, so this is safe with no key.
    try {
      const aff = readAffiliateRef();
      if (aff && !sessionStorage.getItem("jnr_aff_click_sent")) {
        track("affiliate_link_clicked", { affiliate_id: aff, surface: "account_app" });
        sessionStorage.setItem("jnr_aff_click_sent", "1");
      }
    } catch {
      /* analytics is best-effort */
    }
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn || !user) {
      resetAnalytics();
      return;
    }
    const affiliate_id = (user.unsafeMetadata?.affiliate_id as string | undefined) ?? null;
    const tier = (user.publicMetadata?.tier as string | undefined) ?? "free";
    const whop_user_id = (user.publicMetadata?.whop_user_id as string | undefined) ?? null;
    identifyUser({
      clerk_id: user.id,
      affiliate_id,
      tier,
      whop_user_id,
    });
  }, [isLoaded, isSignedIn, user]);

  return null;
}
