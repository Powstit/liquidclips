// useCoarsePointer.ts
//
// Returns true when the workbench should be forced OFF — either the pointer is
// coarse (touch / pen on most tablets) or the viewport is too narrow for the
// 8x8 canvas + resize handles to be usable.
//
// Lives in /workbench/ instead of /lib/ because it's a workbench-feature
// concern only — the grid view does not need to care about pointer class.
//
// Why a hook (not a constant): a user dragging a Tauri window down to phone
// width mid-session needs to downgrade live, not on next launch. matchMedia +
// resize listener cover the two ways that state changes:
//   - Plugging a tablet into a Magic Keyboard flips pointer:coarse → fine
//   - Resizing the desktop window crosses WORKBENCH_MIN_WIDTH_PX
//
// USER JOURNEY · useCoarsePointer
//   ENABLES — workbench auto-falls-back to grid when the surface can't carry it
//   PREVENTS — broken drag-resize on touch + clipped 8x8 canvas on narrow windows
//   BREAKS — none, additive read-only hook
//   STRANDS — none; SSR path returns false safely, listeners cleaned up on unmount

import { useEffect, useState } from "react";
import { WORKBENCH_MIN_WIDTH_PX } from "./types";

function computeCoarse(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.innerWidth < WORKBENCH_MIN_WIDTH_PX) return true;
    if (typeof window.matchMedia === "function") {
      const mq = window.matchMedia("(pointer: coarse)");
      if (mq.matches) return true;
    }
  } catch {
    // matchMedia / innerWidth can throw in sandboxed contexts. Default to
    // "false" — workbench stays available rather than silently disabled.
    return false;
  }
  return false;
}

export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState<boolean>(() => computeCoarse());

  useEffect(() => {
    if (typeof window === "undefined") return;

    const recompute = (): void => {
      setCoarse(computeCoarse());
    };

    let mq: MediaQueryList | null = null;
    try {
      if (typeof window.matchMedia === "function") {
        mq = window.matchMedia("(pointer: coarse)");
        // Safari < 14 only supports addListener / removeListener.
        if (typeof mq.addEventListener === "function") {
          mq.addEventListener("change", recompute);
        } else if (typeof (mq as unknown as { addListener?: (cb: () => void) => void }).addListener === "function") {
          (mq as unknown as { addListener: (cb: () => void) => void }).addListener(recompute);
        }
      }
    } catch {
      // matchMedia can throw — silently skip; resize alone still covers the
      // common case of dragging the Tauri window narrower than the canvas.
    }

    window.addEventListener("resize", recompute);

    return () => {
      window.removeEventListener("resize", recompute);
      if (!mq) return;
      try {
        if (typeof mq.removeEventListener === "function") {
          mq.removeEventListener("change", recompute);
        } else if (typeof (mq as unknown as { removeListener?: (cb: () => void) => void }).removeListener === "function") {
          (mq as unknown as { removeListener: (cb: () => void) => void }).removeListener(recompute);
        }
      } catch {
        // Cleanup best-effort.
      }
    };
  }, []);

  return coarse;
}
