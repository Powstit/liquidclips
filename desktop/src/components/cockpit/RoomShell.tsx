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
  /** Most pages centre their content; some (Library, Earn, Schedule) want
   *  top-aligned so long lists don't lurch as they fill. */
  align?: "center" | "top";
}) {
  const reduced = useReducedMotion();
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
        className={`flex min-h-full w-full justify-center ${
          align === "top" ? "items-start" : "items-center"
        }`}
      >
        {children}
      </div>
    </motion.div>
  );
}
