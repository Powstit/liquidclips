"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { JuniorLoader } from "./JuniorLoader";

// Always-visible navigation splash. Shows the JuniorLoader as a full-bleed
// overlay for ~700ms on every pathname change, so the brand voice is the
// thing the user sees between pages — even when the route resolves instantly.
//
// We hook into both the actual pathname change (via usePathname) and Link
// clicks (via a capture-phase event listener) so the overlay is up before
// the new route paints.

const MIN_MS = 700;
const PATH_TO_MESSAGE: Record<string, string> = {
  "/": "One moment",
  "/sign-up": "Spinning up your seat",
  "/sign-in": "Logging you in",
  "/dashboard": "Reading your account",
};

function messageFor(path: string): string {
  return PATH_TO_MESSAGE[path] ?? "One moment";
}

export function RouteSplash() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  // Capture-phase: catch any internal link click before it navigates.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Only respond to plain left-clicks without modifiers.
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = (e.target as HTMLElement | null)?.closest("a");
      if (!target) return;
      const href = target.getAttribute("href");
      if (!href || href.startsWith("http") || href.startsWith("mailto") || href.startsWith("#")) return;
      // Same-origin internal link — show splash.
      setPending(href);
      setActive(true);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // When pathname actually changes (or after MIN_MS), tear down.
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setActive(false), MIN_MS);
    return () => clearTimeout(timer);
  }, [pathname, active]);

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-paper/95 backdrop-blur-md">
      <JuniorLoader message={messageFor(pending ?? pathname)} />
    </div>
  );
}
