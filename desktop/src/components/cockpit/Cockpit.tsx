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

import { useEffect, useRef, type ReactNode } from "react";

export function Cockpit({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reduced-motion: skip the parallax entirely — accessibility + zero
    // unnecessary work when the OS asks for calm.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let rafId = 0;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;

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
        el.style.setProperty("--cockpit-px", currentX.toFixed(3));
        el.style.setProperty("--cockpit-py", currentY.toFixed(3));
      }
      if (Math.abs(targetX - currentX) > 0.001 || Math.abs(targetY - currentY) > 0.001) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = 0;
      }
    }

    el.addEventListener("pointermove", onMove);
    return () => {
      el.removeEventListener("pointermove", onMove);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div ref={ref} className="cockpit-root">
      {children}
    </div>
  );
}
