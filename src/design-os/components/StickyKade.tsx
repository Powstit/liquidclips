/**
 * StickyKade · ALWAYS above-fold Kade host
 *
 * Senior-level rule (Phase 5B):
 *   1. Kade is visible in the first viewport on every primary route.
 *   2. Placement is route-driven (item 5 adds per-route override):
 *        center        → large, anchored beside the hero (Command Room default)
 *        helper-right  → medium, right rail (workspace routes — Studio, Engine)
 *        bottom-right  → docked bottom-right of viewport (legacy default)
 *   3. Mini mode is triggered by IntersectionObserver on a [data-kade-anchor]
 *      element inside the route's hero. Once the anchor leaves the viewport,
 *      Kade shrinks to a top-right mini-helper. Tiny scrolls do NOT evict him.
 *   4. Never hidden under scroll unless deliberately in a proof panel.
 *
 * Mounted by DesignOSAppShell. Routes don't render Kade directly anymore.
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { KadeController } from "./KadeController";
import { bus, useEvent, type KadeState } from "../bridge";
import "./StickyKade.css";

/* 2026-06-30 · Kade mood overlay · DISTINCT from KadeState pose.
 *   idle      · default · no wrapper effect
 *   thinking  · sub-pulse glow · "Kade is processing"
 *   alert     · fuchsia ring + pulse · paired with a speech bubble
 *   collapsed · minimised affordance (mini mode + dim) · "Kade stepped aside" */
type KadeMood = "idle" | "thinking" | "alert" | "collapsed";

export type KadePlacement = "center" | "helper-right" | "bottom-right";

export interface StickyKadeProps {
  defaultState: KadeState;
  /** Where Kade sits in the first viewport. Default bottom-right. */
  placement?: KadePlacement;
}

export function StickyKade({ defaultState, placement = "bottom-right" }: StickyKadeProps) {
  const [state, setState] = useState<KadeState>(defaultState);
  const [mini, setMini] = useState(false);
  // BUG-023 · pulse Kade on every engine:progress event so the surface
  // visibly tracks the heartbeat even when the pose itself doesn't change
  // (e.g. mid-reframe across multiple clips).
  const [pulse, setPulse] = useState(false);
  // 2026-06-30 · troubleshooting mood overlay · listens to kade:mood bus
  // events emitted by AppShell's global error listener (engine:error +
  // unhandledrejection). Resets to "idle" when nothing is in flight.
  const [mood, setMood] = useState<KadeMood>("idle");

  // Reset on route change
  useEffect(() => {
    setState(defaultState);
  }, [defaultState]);

  // Hover/click via bus
  useEvent("nav:hover", (p) => {
    setState(p.kade);
    const t = window.setTimeout(() => setState(defaultState), 900);
    return () => window.clearTimeout(t);
  });

  // Engine progress → visible pulse. Self-clears so the next event re-pulses.
  useEvent("engine:progress", () => {
    setPulse(true);
    const t = window.setTimeout(() => setPulse(false), 600);
    return () => window.clearTimeout(t);
  });

  // 2026-06-30 · mood overlay channel · AppShell's global error listener
  // emits "kade:mood" with mood="alert" on engine:error + unhandled
  // rejections. The wrapper CSS class drives the keyframe animation.
  useEvent("kade:mood", (p) => {
    setMood(p.mood);
  });

  // IntersectionObserver: watch the route's [data-kade-anchor]. While it's
  // on screen, Kade stays in its hero placement. Once it leaves, mini mode.
  // Fallback (no anchor on the page) → never shrink, hero-anchored stays.
  useEffect(() => {
    setMini(false);
    let attempts = 0;
    let observer: IntersectionObserver | null = null;
    let raf = 0;

    const attach = () => {
      const anchor = document.querySelector("[data-kade-anchor]") as HTMLElement | null;
      if (!anchor) {
        // Hero hasn't mounted yet — try again next frame, up to ~30 frames.
        if (attempts++ < 30) {
          raf = requestAnimationFrame(attach);
        }
        return;
      }
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            // Mini when anchor is mostly out of view (threshold gives a buffer
            // so a 1-line scroll doesn't flip state).
            setMini(!entry.isIntersecting);
          }
        },
        { threshold: 0.15, rootMargin: "0px 0px -10% 0px" }
      );
      observer.observe(anchor);
    };

    attach();

    return () => {
      if (observer) observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [placement]);

  const mode = mini ? "is-mini" : `is-${placement}`;
  const pulseClass = pulse ? "is-pulsing" : "";
  // 2026-06-30 · mood drives a wrapper CSS class · keyframes per state
  // live in StickyKade.css under .lc-sticky-kade.lc-mood-{state}.
  // Collapsed mood is no longer a CSS class · it's a separate badge
  // rendered below (CollapsedDock) so the main portrait can crossfade
  // to zero scale cleanly via framer-motion.
  const moodClass = mood === "idle" || mood === "collapsed" ? "" : `lc-mood-${mood}`;
  const isCollapsed = mood === "collapsed";

  const onMinimize = () => bus.emit("kade:mood", { mood: "collapsed" });
  const onExpand = () => bus.emit("kade:mood", { mood: "idle" });

  return (
    <>
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            key="lc-sticky-kade-host"
            id="lc-sticky-kade-portrait"
            className={`lc-sticky-kade ${mode} ${pulseClass} ${moodClass}`}
            data-kade-mood={mood}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.35, transition: { duration: 0.22, ease: [0.22, 0.9, 0.35, 1] } }}
            transition={{ type: "spring", stiffness: 240, damping: 22, mass: 0.6 }}
          >
            <div className="lc-sticky-kade-glow" />
            <div className="lc-sticky-kade-host">
              <KadeController state={state} />
              {/* Minimize affordance · click to send Kade to the dock badge.
                  Only paints when NOT mini (mini already shrinks Kade for
                  scroll-evict purposes; collapse is the user-driven version). */}
              {!mini && (
                <button
                  type="button"
                  className="lc-sticky-kade-minimize"
                  onClick={onMinimize}
                  aria-label="Minimise Kade"
                  aria-expanded="true"
                  aria-controls="lc-sticky-kade-portrait"
                  data-testid="kade-minimize"
                >
                  −
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collapsed dock badge · bottom-left, near the sidebar.
          Click to bring Kade back. AppShell's engine:error listener
          calls bus.emit("kade:mood", { mood: "alert" }) which overrides
          the collapsed state automatically · the AnimatePresence above
          re-mounts the portrait and the speech bubble paints alongside. */}
      <AnimatePresence>
        {isCollapsed && (
          <motion.button
            key="lc-sticky-kade-dock"
            type="button"
            className="lc-sticky-kade-dock"
            data-testid="kade-dock-badge"
            initial={{ opacity: 0, scale: 0.6, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.6, y: 10, transition: { duration: 0.18 } }}
            transition={{ type: "spring", stiffness: 260, damping: 24, mass: 0.5 }}
            onClick={onExpand}
            aria-label="Restore Kade"
            aria-expanded="false"
            aria-controls="lc-sticky-kade-portrait"
          >
            <span className="lc-sticky-kade-dock-glyph" aria-hidden="true">
              ✦
            </span>
            <span className="lc-sticky-kade-dock-label">Kade</span>
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
}
