// v0.6.36 — RoomShell.
//
// One wrapper per route. Gives every page the same cockpit "room": camera-
// dolly entry, blur on exit, cursor parallax inherited from Cockpit. Without
// this, every page would have to re-implement the same AnimatePresence
// boilerplate, and we'd drift on motion easing across surfaces.
//
// Usage in App.tsx:
//   <RoomShell roomKey="upload"><UploadTab /></RoomShell>
//
// The `roomKey` must change between routes for AnimatePresence to swap.
// Wrap the route conditional once; nothing else needs to know.

// ───── IRON GATE IG-008 (v0.7.43) — see docs/IRON_GATES.md ─────
// Cockpit room scrollability. The OUTER wrap is a block scroller
// (overflow-y-auto on a non-flex container) so content taller than the
// viewport remains scrollable. The INNER wrap is a flex column that uses
// min-h-full so it fills the visible area when content is short (preserving
// the vertical-center "room" feel) AND grows beyond it when content
// overflows (so the outer scroll bar takes over). This pattern survived
// Tailwind 4's refusal to compile `items-[safe_center]` (the original v0.7.43
// attempt) — don't reintroduce that arbitrary value; use the two-layer
// structure. Pairs with the per-room bottom-padding contract that keeps
// content clear of BottomCockpit.

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

export function RoomShell({
  roomKey,
  children,
  align = "center",
}: {
  roomKey: string;
  children: ReactNode;
  /** Most pages centre their content; some (Library, Schedule) want
   *  top-aligned so long lists don't lurch as they fill. The `stretch`
   *  variant is for rooms that pin a NATIVE webview (Earn) behind the
   *  React layer — the child must fill the full visible area so the
   *  ResizeObserver-measured container rect is non-zero. Without this,
   *  `h-full` on the child can't resolve against the IG-008 `min-h-full`
   *  parent (CSS height-percentage needs a definite parent height), the
   *  container collapses to 0 px, and the webview pins to a 0×0 rect →
   *  invisible / "blank Earn" symptom. v0.7.50 fix. */
  // ───── IRON GATE IG-011 (v0.7.50) — see docs/IRON_GATES.md ─────
  // Webview-style rooms (Earn, future native-webview surfaces) MUST be
  // able to request `stretch` so EarnPanelMount's containerRef has a
  // definite height to cascade to the ResizeObserver. Removing the
  // stretch variant OR changing items-stretch to anything else re-breaks
  // the blank-Earn class. Coexists with IG-008 — that gate locks the
  // two-layer block-scroller + min-h-full pattern; this gate locks the
  // cross-axis alignment options.
  align?: "center" | "top" | "stretch";
}) {
  const reduced = useReducedMotion();
  const innerAlign =
    align === "top" ? "items-start" :
    align === "stretch" ? "items-stretch" :  // IRON GATE IG-011 — webview rooms cascade via items-stretch (do not change)
    "items-center";
  return (
    <motion.div
      key={roomKey}
      className="cockpit-room-wrap h-full w-full overflow-y-auto"
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, filter: "blur(8px)" }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, filter: "blur(0px)" }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98, filter: "blur(6px)" }}
      transition={reduced ? { duration: 0.14 } : { type: "spring", stiffness: 260, damping: 28 }}
    >
      <div
        className={`flex min-h-full w-full justify-center ${innerAlign}`}
      >
        {children}
      </div>
    </motion.div>
  );
}
