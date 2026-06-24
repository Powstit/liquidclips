/**
 * KadeController · Kade mascot host
 *
 * Mounts 19 still-pose webps and crossfades between them via Framer Motion.
 *
 * Rule (Phase 4B-rev):
 *   - State changes are USER-DRIVEN (nav hover/click, route enter, demo buttons).
 *   - Default = single still + idle bob. NO random cycle.
 *   - Flipbook reserved for emotional moments (success, celebration). For Phase
 *     5A we keep all 19 states as stills; flipbooks land in Phase 6+.
 */

import { motion, AnimatePresence } from "framer-motion";
import { presets, useMotionGate } from "../motion";
import type { KadeState } from "../bridge";
import "./KadeController.css";

const POSE_PATH: Record<KadeState, string> = {
  "idle":                "/brand/kade/kade-idle.webp",
  "hover":               "/brand/kade/kade-hover.webp",
  "create-clips":        "/brand/kade/kade-create-clips.webp",
  "import-footage":      "/brand/kade/kade-import-footage.webp",
  "reading-brief":       "/brand/kade/kade-reading-brief.webp",
  "cutting-clips":       "/brand/kade/kade-cutting-clips.webp",
  "generating-captions": "/brand/kade/kade-generating-captions.webp",
  "exporting":           "/brand/kade/kade-exporting.webp",
  "publishing":          "/brand/kade/kade-publishing.webp",
  "campaign-mode":       "/brand/kade/kade-campaign-mode.webp",
  "earn-mode":           "/brand/kade/kade-earn-mode.webp",
  "community-mode":      "/brand/kade/kade-community-mode.webp",
  "settings-mode":       "/brand/kade/kade-settings-mode.webp",
  "shooter":             "/brand/kade/kade-shooter.webp",
  "success":             "/brand/kade/kade-success.webp",
  "celebration":         "/brand/kade/kade-celebration.webp",
  "warning":             "/brand/kade/kade-warning.webp",
  "error":               "/brand/kade/kade-error.webp",
};

export interface KadeControllerProps {
  state: KadeState;
  className?: string;
}

export function KadeController({ state, className = "" }: KadeControllerProps) {
  const { reduced } = useMotionGate();
  const path = POSE_PATH[state];

  return (
    <div className={`lc-kade-host ${className}`}>
      <motion.div
        className="lc-kade-bob"
        variants={presets.kadeBob}
        animate={reduced ? undefined : "idle"}
      >
        <AnimatePresence mode="popLayout">
          <motion.img
            key={state}
            src={path}
            alt=""
            className="lc-kade-pose"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduced ? { duration: 0 } : presets.kadeXfade}
            draggable={false}
          />
        </AnimatePresence>
      </motion.div>
      <div className="lc-kade-bloom" aria-hidden="true" />
      <div className="lc-kade-exhaust" aria-hidden="true" />
    </div>
  );
}
