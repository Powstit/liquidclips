/**
 * CelebrationFlash · Composer Sprint 3 E3 · win-moment overlay.
 *
 * ⚠ IRON GATE IG-COMPOSER-O · Celebration flash contract.
 *
 * Listens for the "composer:celebrate" bus event and shows
 * kade-celebration.webp (via POSES.celebration) at 240 px transparent
 * over the current surface. Fades in + out over 800 ms. Respects
 * prefers-reduced-motion by collapsing to a 40 ms hard show/hide.
 *
 * The component is safe to mount anywhere · it renders nothing until an
 * event fires, then auto-hides. No portal · uses fixed positioning so
 * it stays above the surface without needing a slot.
 */

import { useEffect, useState, type ReactElement } from "react";
import { useEvent } from "../bridge/useEvent";
import { POSES } from "../engine/composer/kadePoses";
import "./CelebrationFlash.css";

const FLASH_DURATION_MS = 800;

export function CelebrationFlash(): ReactElement | null {
  const [visible, setVisible] = useState(false);

  useEvent("composer:celebrate", () => {
    setVisible(true);
  });

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), FLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="lc-celebration-flash"
      data-testid="celebration-flash"
      role="status"
      aria-live="polite"
    >
      <img
        src={POSES.celebration}
        alt=""
        width={240}
        height={240}
        className="lc-celebration-flash-img"
      />
    </div>
  );
}

export default CelebrationFlash;
