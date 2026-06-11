// v0.6.35 — Cockpit shell.
//
// Wraps the right-column "main" region with a CSS perspective root + a tiny
// cursor parallax driver. The perspective lets WorkstationRoom tiles tilt
// in 3D and lets AnimatePresence variants translate on Z without the rest of
// the app re-implementing perspective on every page.
//
// Cheap by design: one mousemove listener writes two CSS variables on the
// root (--cockpit-px, --cockpit-py). Children opt-in by reading those vars
// in transform expressions. Nothing else here knows or cares.
//
// v0.7.48 — `active` prop scopes the parallax listener to views that
// actually consume the CSS vars (Workstation / Results). On Library, Earn,
// Settings, Schedule, Learn the pointermove listener used to fire on every
// pixel of cursor motion — each event scheduled a rAF that wrote two CSS
// custom properties on the cockpit root, forcing style recalculation
// throughout the subtree. None of those views read --cockpit-px/py, so it
// was pure waste. Passing active=false skips listener mount entirely.

import { useEffect, useRef, useState, type ReactNode } from "react";

export function Cockpit({
  children,
  active = true,
}: {
  children: ReactNode;
  /** v0.7.48 — When false, skip mounting the parallax pointermove listener.
   *  Defaults to true so existing call sites keep their behaviour; pass
   *  false on views that don't render workstation tiles. */
  active?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  // v0.7.45 — Reactive reduced-motion preference. The old code checked once
  // at mount; users who toggle the OS setting mid-session got no protection.
  const [reducedMotion, setReducedMotion] = useState(() =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion) return;
    // v0.7.48 — Skip listener mount on views that don't consume
    // --cockpit-px/py. Drops per-frame style recalcs on Library / Earn /
    // Settings / Schedule / Learn (smoothness diagnostic finding #2).
    if (!active) return;

    let rafId = 0;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let lastWrittenX = "";
    let lastWrittenY = "";

    function onMove(e: PointerEvent) {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // v0.7.45 — Guard against zero dimensions (hidden / collapsed / not yet
      // laid out). Without this, the lerp permanently poisons currentX/Y with
      // NaN and all child transforms break until restart.
      if (!rect.width || !rect.height) return;
      // Normalise cursor to [-1, 1] around the centre of the cockpit.
      targetX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      targetY = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      if (!rafId) rafId = requestAnimationFrame(tick);
    }

    function tick() {
      // Lerp toward target so the parallax feels weighted, not jittery.
      currentX += (targetX - currentX) * 0.08;
      currentY += (targetY - currentY) * 0.08;
      if (el) {
        // v0.7.45 — Only write when the value materially changes. The old
        // code wrote every frame during the ~80-frame lerp tail, forcing
        // style recalculation for the entire cockpit subtree.
        const nextX = currentX.toFixed(3);
        const nextY = currentY.toFixed(3);
        if (nextX !== lastWrittenX) {
          el.style.setProperty("--cockpit-px", nextX);
          lastWrittenX = nextX;
        }
        if (nextY !== lastWrittenY) {
          el.style.setProperty("--cockpit-py", nextY);
          lastWrittenY = nextY;
        }
      }
      if (Math.abs(targetX - currentX) > 0.001 || Math.abs(targetY - currentY) > 0.001) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = 0;
      }
    }

    // v0.7.45 — Mark listener passive so scroll composition isn't blocked
    // on nested scrollable surfaces inside RoomShell.
    el.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      el.removeEventListener("pointermove", onMove);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [reducedMotion, active]);

  return (
    <div ref={ref} className="cockpit-root">
      {children}
    </div>
  );
}
