/**
 * CursorGlow · subtle fuchsia energy follows the cursor
 *
 * Mount once at the Design-OS shell root. Single div, position:fixed,
 * pointer-events:none. Updated via requestAnimationFrame + CSS variables —
 * GPU-friendly transform, no React state churn, no canvas.
 *
 * Respects prefers-reduced-motion (renders nothing).
 */

import { useEffect, useRef } from "react";
import "./CursorGlow.css";

export function CursorGlow() {
  const glowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (document.body.classList.contains("rm")) return;

    const el = glowRef.current;
    if (!el) return;

    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 2;
    let curX = targetX;
    let curY = targetY;
    let raf = 0;
    let visible = false;

    const onMove = (e: PointerEvent) => {
      targetX = e.clientX;
      targetY = e.clientY;
      if (!visible) {
        visible = true;
        el.style.opacity = "1";
      }
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const onLeave = () => {
      visible = false;
      el.style.opacity = "0";
    };

    const tick = () => {
      // Spring lerp — fast enough to feel responsive, soft enough to feel premium.
      curX += (targetX - curX) * 0.22;
      curY += (targetY - curY) * 0.22;
      // Glow is 160px → translate by half-width (80) to centre on cursor.
      el.style.transform = `translate3d(${curX - 80}px, ${curY - 80}px, 0)`;
      const dx = Math.abs(targetX - curX);
      const dy = Math.abs(targetY - curY);
      if (dx > 0.4 || dy > 0.4) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    document.addEventListener("mouseleave", onLeave);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("mouseleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return <div ref={glowRef} className="lc-cursor-glow" aria-hidden="true" />;
}
