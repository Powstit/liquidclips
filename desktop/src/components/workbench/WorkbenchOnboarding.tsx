// ship-lens v0.7.8: W4 — Workbench is single-mode (no Grid). Removed dead `view !== "workbench"` guards; onboarding visibility now depends solely on `seen` + `winCount > 0`.
// First-open Workbench onboarding overlay.
//
// Shown ONCE per user (persisted in localStorage via useLocalPref). Three
// labelled arrows teach the core Workbench mental model in five seconds:
//
//   1. "Tick a window"           → top-left tile's chrome checkbox
//   2. "Master toolbar fans out" → canvas top toolbar area
//   3. "+ Add window"            → next-free slot bottom-right
//
// Dismiss = tap anywhere (single full-surface dismiss button). Re-entry is
// guarded by the persisted seen flag, so once dismissed it never shows
// again unless the user clears localStorage.
//
// JOURNEY:
//  ENABLES — first-time Workbench user understands selection-fan-out and
//    "where do I add another window" in one glance.
//  PREVENTS — re-show after dismissal (persisted), AND show when there's
//    nothing on the canvas to point at (winCount === 0 short-circuit).
//  BREAKS — pointer-events: none on the chrome so the overlay can't trap
//    keyboard or pointer focus. Esc also dismisses.
//  STRANDS — none. Single dismiss surface, no nested CTAs, no async.

import { useEffect } from "react";
import { useLocalPref } from "../../lib/useLocalPref";
import { useWorkbenchStore } from "./useWorkbenchStore";
import onboardingArrowUrl from "../../assets/workbench/onboarding-arrow.png";

const SEEN_KEY = "lc:workbench_onboarding_seen";

export function WorkbenchOnboarding() {
  const [seen, setSeen] = useLocalPref<boolean>(SEEN_KEY, false);
  const winCount = useWorkbenchStore((s) => s.windows.size);

  // Esc dismisses too — keyboard users shouldn't have to mouse over the
  // overlay to clear it.
  useEffect(() => {
    if (seen || winCount === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSeen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seen, winCount, setSeen]);

  if (seen) return null;
  if (winCount === 0) return null;

  function dismiss() {
    setSeen(true);
  }

  return (
    <div
      // The wrapper itself is non-interactive so it doesn't intercept
      // clicks on the underlying canvas. Only the dismiss surface and the
      // labelled arrow callouts react. PREVENTS keyboard trap / pointer
      // dead-zones over the rest of the workbench.
      className="pointer-events-none fixed inset-0 z-[60]"
      aria-hidden={false}
      role="dialog"
      aria-label="Workbench tour"
    >
      {/* Full-screen dim + dismiss surface. */}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss workbench tour"
        className="pointer-events-auto absolute inset-0 h-full w-full cursor-pointer bg-ink/55 backdrop-blur-[1px]"
      />

      {/* 1) Tick-a-window arrow — top-left tile region. */}
      <Callout
        className="left-4 top-12"
        arrowRotation={-20}
        step={1}
        label="Tick a window"
        sublabel="Select one or more"
      />

      {/* 2) Master toolbar arrow — canvas toolbar area, top-center. */}
      <Callout
        className="left-1/2 top-2 -translate-x-1/2"
        arrowRotation={180}
        step={2}
        label="Master toolbar fans out"
        sublabel="Acts on every selected window"
      />

      {/* 3) Add-window arrow — next-free slot, bottom-right of canvas. */}
      <Callout
        className="bottom-12 right-6"
        arrowRotation={140}
        step={3}
        label="+ Add window"
        sublabel="Drop a clip into the empty tile"
      />

      {/* Dismiss hint pinned at the very bottom so the user always knows
          how to leave — no keyboard-only dead-end. */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2">
        <span className="rounded-full bg-paper/90 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink">
          tap anywhere or press esc to dismiss
        </span>
      </div>
    </div>
  );
}

function Callout({
  className,
  arrowRotation,
  step,
  label,
  sublabel,
}: {
  className: string;
  arrowRotation: number;
  step: number;
  label: string;
  sublabel: string;
}) {
  return (
    <div
      // pointer-events: none on the wrapper itself — the underlying dim
      // surface stays the dismiss target. The label is for reading, not
      // clicking.
      className={`pointer-events-none absolute flex flex-col items-start gap-1 ${className}`}
    >
      <img
        src={onboardingArrowUrl}
        alt=""
        aria-hidden
        style={{ transform: `rotate(${arrowRotation}deg)` }}
        className="h-12 w-12 drop-shadow-[0_0_8px_rgba(255,26,140,0.6)]"
      />
      <div className="flex flex-col gap-0.5 rounded-xl border border-fuchsia/60 bg-paper px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-fuchsia">
          step {step}
        </span>
        <span className="font-sans text-[13px] font-semibold text-ink">{label}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          {sublabel}
        </span>
      </div>
    </div>
  );
}
