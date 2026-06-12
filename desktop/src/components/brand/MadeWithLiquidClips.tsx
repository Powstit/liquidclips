// v0.7.55 — "Made with Liquid Clips" lockup, React surface.
//
// THIS IS NOT THE EXPORT WATERMARK. The export watermark lives in
// `python-sidecar/stages.py` (_made_with_animated_watermark_filter) and
// is composited into the final MP4 bytes by ffmpeg — the only place
// that matters for free-tier attribution. This component renders the
// same visual identity inside the React app:
//
//   • Splash screen (after the cinematic intro)
//   • About panel
//   • End-card previews in the workspace
//   • Marketing/demo HTML snapshots
//
// Reuses the canonical master SVG at
//   desktop/src/assets/made-with-liquid-clips.svg
// imported via Vite's `?url` query so the SVG file ships in the bundle
// and is renderable from <img>. CSS animations in the SVG run when the
// browser/Tauri webview displays it inline. The bug crawls every 12s
// per the spec — intro sting 0–3s, settled idle 3–10.2s, walk-off,
// re-enter. Respects prefers-reduced-motion (handled inside the SVG).
//
// Sizes via the standard Tailwind h-/w- pattern. Defaults to a width-
// constrained 240px lockup (corner-bug + small wordmark) but accepts
// any className for end-card use at 480px+ or hero use at 640px+.

import mwlcUrl from "../../assets/made-with-liquid-clips.svg?url";

export function MadeWithLiquidClips({
  className = "h-12 w-[240px]",
  /**
   * `loading`: lazy by default — most consumers (Splash, About) render
   * the lockup below the fold. Set to "eager" when the lockup is the
   * landmark element (e.g. an end-card preview).
   */
  loading = "lazy",
  /**
   * `ariaLabel` override for screen readers. Default is the spoken
   * attribution. Set to "" on decorative-only mounts (rare — the
   * lockup is meant to attribute).
   */
  ariaLabel = "Made with Liquid Clips",
}: {
  className?: string;
  loading?: "eager" | "lazy";
  ariaLabel?: string;
}) {
  return (
    <img
      src={mwlcUrl}
      alt={ariaLabel}
      role="img"
      loading={loading}
      draggable={false}
      className={className}
    />
  );
}
