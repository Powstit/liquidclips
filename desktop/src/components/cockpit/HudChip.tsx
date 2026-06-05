// v0.6.36 — HudChip.
//
// Shared filter / option pill that matches the cockpit language: transparent
// fill, fuchsia HUD bracket corners on the active state, dashed underline on
// hover. Used by Library filters today; reusable for any future "pick one
// of several" surface that needs to feel like the same cockpit, not a SaaS
// segmented control.
//
// Press is springy (whileTap), active is the only "loud" state, hover is a
// quiet hint. No solid pill backgrounds — same discipline as the Workstation
// tiles.

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

export function HudChip({
  active,
  onClick,
  children,
  trailing,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  /** Optional trailing slot — used by Library's "Archived" chip to show
   *  the count without breaking the active/inactive visual rhythm. */
  trailing?: ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={reduced ? undefined : { y: -1, transition: { type: "spring", stiffness: 420, damping: 24 } }}
      whileTap={reduced ? undefined : { scale: 0.96 }}
      data-active={active ? "true" : "false"}
      className="hud-chip relative inline-flex items-center gap-1.5 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] outline-none"
    >
      <span aria-hidden="true" className="hud-chip-corner hud-chip-corner-tl" />
      <span aria-hidden="true" className="hud-chip-corner hud-chip-corner-tr" />
      <span aria-hidden="true" className="hud-chip-corner hud-chip-corner-bl" />
      <span aria-hidden="true" className="hud-chip-corner hud-chip-corner-br" />
      <span className="hud-chip-label relative z-10">{children}</span>
      {trailing && <span className="relative z-10 opacity-70">{trailing}</span>}
    </motion.button>
  );
}
