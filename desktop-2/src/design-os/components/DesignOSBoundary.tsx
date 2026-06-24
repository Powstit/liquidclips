/**
 * DesignOSBoundary · single quarantine wrapper for every Design OS route
 *
 * Why this exists:
 *   - Legacy Liquid Clips shell (.lc-shell / .lc-aurora / .lc-sidenav / etc.)
 *     stays mounted so the section registry and sidecar wiring don't break.
 *   - This component sets body[data-design-os="active"] while mounted, which
 *     AppShell.css uses to occlude the legacy shell.
 *   - SINGLE source of truth — replaces the duplicate body-attr useEffects in
 *     SimulatorRouter + AppShell.
 *   - Exposes runLeakTest() so every route can grep the DOM for legacy
 *     class/label survivors before claiming done.
 *
 * Hard rule: every Design OS route lives inside this boundary.
 */

import { useEffect, type ReactNode } from "react";
import { mountTauriAdapter } from "../bridge/tauri-adapter";

const BANNED_SUBSTRINGS = [
  "FLOW_",
  "SECTION_",
  "HOME · SECTION_HOME",
  "lucide-react",
];

const BANNED_SELECTORS = [
  ".lc-shell",
  ".lc-aurora",
  ".lc-sidenav",
  ".lc-topbar",
  ".lc-canvas",
  ".lc-deck-atmosphere",
  ".lc-page",
  ".lc-section",
  ".lc-browse-rail-tab",
  ".lc-signal-line",
  ".lucide",
];

export interface LeakReport {
  /** Banned substrings actually found inside the rendered DOM (boundary subtree). */
  substrings: string[];
  /** Banned selectors that matched at least one element inside the boundary subtree. */
  selectors: string[];
}

/** Scan the Design OS boundary subtree for legacy survivors. Returns `[]`
 *  lists when clean. Mount-time + on-demand from devtools. */
export function runLeakTest(): LeakReport {
  if (typeof document === "undefined") return { substrings: [], selectors: [] };
  const root = document.querySelector(".lc-design-os-boundary") as HTMLElement | null;
  if (!root) return { substrings: [], selectors: [] };

  const dom = root.innerHTML;
  const substrings = BANNED_SUBSTRINGS.filter((s) => dom.includes(s));

  const selectors: string[] = [];
  for (const sel of BANNED_SELECTORS) {
    // Skip occlusion partners that survive intentionally outside the boundary.
    if (root.querySelector(sel)) selectors.push(sel);
  }

  return { substrings, selectors };
}

export interface DesignOSBoundaryProps {
  children: ReactNode;
}

export function DesignOSBoundary({ children }: DesignOSBoundaryProps) {
  // Pin body attr while mounted — AppShell.css reads this to hide legacy chrome.
  useEffect(() => {
    document.body.setAttribute("data-design-os", "active");
    return () => { document.body.removeAttribute("data-design-os"); };
  }, []);

  // Mount the Tauri ↔ bus adapter exactly once for the lifetime of the
  // Design OS surface. Re-emits sidecar:* events as engine:* bus events.
  useEffect(() => {
    return mountTauriAdapter();
  }, []);

  return <div className="lc-design-os-boundary">{children}</div>;
}

/* Expose for devtools so Daniel can verify visually:
 *   window.__lcRunLeakTest()
 *
 * Returns { substrings: [], selectors: [] } when clean. */
if (typeof window !== "undefined") {
  (window as unknown as { __lcRunLeakTest?: () => LeakReport }).__lcRunLeakTest = runLeakTest;
}
