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
import { getKade } from "../assets/assetRegistry";
import "./KadeController.css";

/** Stage B-1: the 18 KadeState poses now resolve via the asset registry
 *  (`getKade(state)`). Idle is the safety fallback when a state is added
 *  to the union before its pose is registered — never silently blank,
 *  always loud in console + DOM so QA catches the drift. */
const FALLBACK_KADE_STATE: KadeState = "idle";

interface ResolvedKade {
  path: string;
  resolvedFromRegistry: boolean;
  registryId: string | null;
}

function resolveKadePath(state: KadeState): ResolvedKade {
  const entry = getKade(state);
  if (entry) {
    return { path: entry.publicPath, resolvedFromRegistry: true, registryId: entry.id };
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[KadeController] pose "${state}" missing from assetRegistry · falling back to ${FALLBACK_KADE_STATE}.`,
  );
  const fallback = getKade(FALLBACK_KADE_STATE);
  return {
    path: fallback?.publicPath ?? "/brand/kade/kade-idle.webp",
    resolvedFromRegistry: false,
    registryId: fallback?.id ?? null,
  };
}

export interface KadeControllerProps {
  state: KadeState;
  className?: string;
}

export function KadeController({ state, className = "" }: KadeControllerProps) {
  const { reduced } = useMotionGate();
  const resolved = resolveKadePath(state);

  return (
    <div
      className={`lc-kade-host ${className}`}
      data-kade-state={state}
      data-kade-registry-resolved={String(resolved.resolvedFromRegistry)}
      data-kade-registry-id={resolved.registryId ?? ""}
    >
      <motion.div
        className="lc-kade-bob"
        variants={presets.kadeBob}
        animate={reduced ? undefined : "idle"}
      >
        <AnimatePresence mode="popLayout">
          <motion.img
            key={state}
            src={resolved.path}
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
