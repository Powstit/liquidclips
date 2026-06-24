/**
 * AchievementToast · Phase 6L-C
 *
 * Minimal parity surface for legacy `desktop/src/components/AchievementToast.tsx`.
 * Listens for the `achievement:unlocked` bus event, mounts a glass card
 * with the badge art + copy, runs the existing `achievementUnlock` motion
 * preset, auto-dismisses after a beat.
 *
 * Reuses:
 *   - LC bus (`achievement:unlocked` event added in Phase 6L-C)
 *   - `motion/presets.ts:achievementUnlock` variants
 *   - existing brand assets via the `ACHIEVEMENTS` art map (no new art)
 *
 * Mount once · idempotent · safe under StrictMode.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion as fm } from "framer-motion";
import { useEvent } from "../bridge";
import { achievementUnlock } from "../motion/presets";
import "./AchievementToast.css";

interface ActiveAchievement {
  id: string;
  title: string;
  blurb: string;
  art: string;
  /** Stable key so quick consecutive unlocks animate independently. */
  fireId: number;
}

const VISIBLE_MS = 5500;

export function AchievementToast() {
  const [active, setActive] = useState<ActiveAchievement | null>(null);

  useEvent("achievement:unlocked", (p) => {
    setActive({
      id: p.id,
      title: p.title,
      blurb: p.blurb,
      art: p.art,
      fireId: Date.now(),
    });
  });

  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => setActive(null), VISIBLE_MS);
    return () => window.clearTimeout(t);
  }, [active]);

  return (
    <AnimatePresence>
      {active && (
        <fm.div
          key={active.fireId}
          className="lc-ach-toast"
          variants={achievementUnlock}
          initial="initial"
          animate="animate"
          exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.18 } }}
          role="status"
          aria-live="polite"
        >
          <div className="lc-ach-toast-art-wrap">
            <img src={active.art} alt="" className="lc-ach-toast-art" />
            <span className="lc-ach-toast-burst" aria-hidden="true" />
          </div>
          <div className="lc-ach-toast-body">
            <span className="lc-ach-toast-eb">Achievement unlocked</span>
            <span className="lc-ach-toast-title">{active.title}</span>
            <span className="lc-ach-toast-blurb">{active.blurb}</span>
          </div>
          <button
            type="button"
            className="lc-ach-toast-close"
            onClick={() => setActive(null)}
            aria-label="Dismiss achievement"
          >
            ×
          </button>
        </fm.div>
      )}
    </AnimatePresence>
  );
}
