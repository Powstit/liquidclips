"use client";

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { initAnalytics, identifyUser, resetAnalytics } from "@/lib/analytics";

// Boots PostHog once on first render and keeps the identified user in sync
// with Clerk. Lives in the root layout via a client wrapper so SSR pages
// stay server-rendered. Returns null — it's effects-only.
export function PostHogBoot() {
  const { isLoaded, isSignedIn, user } = useUser();

  useEffect(() => {
    initAnalytics();
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
