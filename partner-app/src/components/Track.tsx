"use client";

import { useEffect } from "react";
import { initAnalytics, track, type PartnerEvent } from "@/lib/analytics";

// `<TrackOnMount>` — fires a single PostHog event when the surface renders.
// Boots PostHog itself if it hasn't booted yet (partner-app has no Clerk
// provider, so there's no PostHogBoot like account-app has).
export function TrackOnMount({
  event,
  properties,
}: {
  event: PartnerEvent;
  properties?: Record<string, unknown>;
}) {
  useEffect(() => {
    initAnalytics();
    track(event, properties);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
