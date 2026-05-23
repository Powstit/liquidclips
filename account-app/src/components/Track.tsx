"use client";

import { useEffect } from "react";
import { track, type AnalyticsEvent } from "@/lib/analytics";

// `<TrackOnMount event="..." />` — fires once when the page renders. Use for
// page-view-style events (dashboard_viewed, upgrade_viewed, …).
export function TrackOnMount({
  event,
  properties,
}: {
  event: AnalyticsEvent;
  properties?: Record<string, unknown>;
}) {
  useEffect(() => {
    track(event, properties);
    // event + properties are static per render — re-firing on every prop
    // change would over-count. Dependencies empty by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// `<TrackedLink event="..." />` — anchor that fires a PostHog event before
// navigating. Keeps the click-time properties (e.g. `source: "dashboard"`)
// attached so we can tell where in the funnel the click came from.
export function TrackedLink({
  event,
  properties,
  href,
  className,
  target,
  rel,
  children,
}: {
  event: AnalyticsEvent;
  properties?: Record<string, unknown>;
  href: string;
  className?: string;
  target?: string;
  rel?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={className}
      target={target}
      rel={rel}
      onClick={() => track(event, properties)}
    >
      {children}
    </a>
  );
}
