// Full-viewport fixed overlay with scanlines + corner vignette.
// Respects prefers-reduced-motion via globals.css.
export function CRTOverlay() {
  return <div className="crt-overlay" aria-hidden="true" />;
}
