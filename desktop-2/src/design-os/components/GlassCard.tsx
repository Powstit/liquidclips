/**
 * GlassCard · the .lc-glass primitive as a React component
 *
 * Mounts the brand-locked glass surface. Per Phase 4B-rev:
 *   - top inner highlight line
 *   - subtle noise overlay
 *   - hover lift (off by default — opt in via `hoverLift`)
 *   - NO pill collisions: children manage their own padding
 */

import type { HTMLAttributes, ReactNode } from "react";
import { motion } from "framer-motion";
import { presets, useMotionGate } from "../motion";
import "./GlassCard.css";

export type GlassDensity = "quiet" | "default" | "heavy";

/** We type the public API as a plain div — framer-motion only enters the
 *  picture when `hoverLift` is set, and we pass the standard HTML props
 *  through. This keeps TS happy with React's `ReactNode` children. */
export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  density?: GlassDensity;
  hoverLift?: boolean;
  /** Subtle fuchsia/cyan tint of the glow bloom inside the card (used by mascot tiles) */
  bloom?: "fx" | "cy" | "none";
  children?: ReactNode;
}

export function GlassCard({
  density = "default",
  hoverLift = false,
  bloom = "none",
  className = "",
  children,
  ...rest
}: GlassCardProps) {
  const { reduced } = useMotionGate();
  const cls = [
    "lc-glass",
    `lc-glass-${density}`,
    bloom !== "none" ? `lc-glass-bloom-${bloom}` : "",
    className,
  ].filter(Boolean).join(" ");

  if (!hoverLift) {
    return <div className={cls} {...rest}>{children}</div>;
  }

  // motion.div has its own animation-event prop signatures that don't merge
  // with HTMLAttributes — strip the conflicting ones before spreading.
  const {
    onAnimationStart: _animStart, onAnimationEnd: _animEnd,
    onAnimationIteration: _animIter, onDrag: _drag, onDragStart: _dragStart,
    onDragEnd: _dragEnd,
    ...safe
  } = rest as Record<string, unknown>;
  void _animStart; void _animEnd; void _animIter; void _drag; void _dragStart; void _dragEnd;

  return (
    <motion.div
      className={cls}
      variants={presets.cardHover}
      initial="rest"
      whileHover={reduced ? undefined : "hover"}
      {...safe}
    >
      {children}
    </motion.div>
  );
}
