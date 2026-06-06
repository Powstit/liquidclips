// ViewModeToggle.tsx
//
// Pill toggle that flips ResultsGrid between the legacy card grid and the
// 8x8 workbench canvas. Mounts inside the ResultsGrid header row, just
// upstream of ClipsBulkToolbar so the user sees mode FIRST, controls SECOND.
//
// Behaviour rules:
//   - Two segments: "Grid" / "Workbench". Active = fuchsia, inactive = ink/quiet.
//   - On coarse-pointer or sub-1024px viewports, the Workbench segment is
//     disabled with a tooltip — auto-snaps to "grid" if currently "workbench".
//   - Tier default: on first render of a project session, paid tiers
//     (pro/agency/growth/autopilot) auto-flip to "workbench" unless we already
//     persisted a view choice (handled inside the store's hydration).
//
// USER JOURNEY · ViewModeToggle
//   ENABLES — explicit mode switch + paid-tier first-open defaults to workbench
//   PREVENTS — silent broken workbench on touch / narrow windows (forced grid)
//   BREAKS — none; toggle is purely additive
//   STRANDS — none; the disabled segment carries a tooltip so the user knows why

import { useEffect, useRef } from "react";
import { useWorkbenchStore } from "./useWorkbenchStore";
import { useTier } from "../../lib/useTier";
import { useCoarsePointer } from "./useCoarsePointer";

const PAID_TIERS = new Set(["pro", "agency", "growth", "autopilot"]);

export function ViewModeToggle(): JSX.Element {
  const view = useWorkbenchStore((s) => s.view);
  const setView = useWorkbenchStore((s) => s.setView);
  const tier = useTier();
  const forced = useCoarsePointer();

  // Coarse / narrow → snap back to grid. Runs whenever `forced` flips true
  // mid-session (e.g. user dragged the Tauri window narrower). One-way: we
  // never auto-flip BACK to workbench just because the viewport grew, because
  // the user might have explicitly chosen grid before — defer to their choice.
  useEffect(() => {
    if (forced && view === "workbench") {
      setView("grid");
    }
  }, [forced, view, setView]);

  // First-time tier default. Fire exactly once per mount when paid + not
  // forced + we're still on the "grid" landing default. The store handles
  // per-project hydration (it knows whether this slug already has a session);
  // here we only nudge the in-memory view for paid-tier first-open clarity.
  const didDefaultRef = useRef(false);
  useEffect(() => {
    if (didDefaultRef.current) return;
    if (forced) return;
    if (tier.loading) return; // wait until /sync resolves so we don't flicker
    if (!PAID_TIERS.has(tier.tier)) return;
    if (view === "workbench") {
      didDefaultRef.current = true;
      return;
    }
    didDefaultRef.current = true;
    setView("workbench");
  }, [forced, tier.loading, tier.tier, view, setView]);

  const isGrid = view === "grid";
  const isWorkbench = view === "workbench";
  const workbenchDisabled = forced;

  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-line bg-paper p-1" role="group" aria-label="View mode">
      <button
        type="button"
        onClick={() => {
          if (!isGrid) setView("grid");
        }}
        aria-pressed={isGrid}
        className={
          "rounded-full px-4 py-1 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors " +
          (isGrid
            ? "bg-fuchsia text-white shadow-[var(--glow-sm)]"
            : "text-text-tertiary hover:text-ink")
        }
      >
        Grid
      </button>
      <button
        type="button"
        disabled={workbenchDisabled}
        onClick={() => {
          if (workbenchDisabled) return;
          if (!isWorkbench) setView("workbench");
        }}
        aria-pressed={isWorkbench}
        aria-disabled={workbenchDisabled}
        title={workbenchDisabled ? "Desktop only" : "Workbench"}
        className={
          "rounded-full px-4 py-1 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors " +
          (workbenchDisabled
            ? "cursor-not-allowed text-text-tertiary opacity-50"
            : isWorkbench
            ? "bg-fuchsia text-white shadow-[var(--glow-sm)]"
            : "text-text-tertiary hover:text-ink")
        }
      >
        Workbench
      </button>
    </div>
  );
}
