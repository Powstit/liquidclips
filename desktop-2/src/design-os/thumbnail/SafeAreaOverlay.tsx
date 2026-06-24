/**
 * SafeAreaOverlay · Phase 6F
 *
 * Renders the title + face safe-area SVGs as absolute overlays on a
 * thumbnail preview. Uses the existing brand-kit SVGs at
 *   /brand/icons/canvas/safe-area-title.svg
 *   /brand/icons/canvas/safe-area-face.svg
 *
 * No new assets generated. The overlay is purely advisory — it doesn't
 * gate generation or block the user. Toggle via the gallery toolbar.
 */

import "./SafeAreaOverlay.css";

export interface SafeAreaOverlayProps {
  showTitle?: boolean;
  showFace?: boolean;
}

export function SafeAreaOverlay({ showTitle = false, showFace = false }: SafeAreaOverlayProps) {
  if (!showTitle && !showFace) return null;
  return (
    <div className="lc-sao" aria-hidden="true">
      {showFace && (
        <img
          className="lc-sao-img lc-sao-face"
          src="/brand/icons/canvas/safe-area-face.svg"
          alt=""
          draggable={false}
        />
      )}
      {showTitle && (
        <img
          className="lc-sao-img lc-sao-title"
          src="/brand/icons/canvas/safe-area-title.svg"
          alt=""
          draggable={false}
        />
      )}
    </div>
  );
}
