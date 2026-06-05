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
      className={`cockpit-room-wrap flex w-full ${
        align === "top" ? "items-start" : "items-center"
      } justify-center`}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, filter: "blur(8px)" }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, filter: "blur(0px)" }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98, filter: "blur(6px)" }}
      transition={reduced ? { duration: 0.14 } : { type: "spring", stiffness: 260, damping: 28 }}
    >
      {children}
    </motion.div>
  );
}
