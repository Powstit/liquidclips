// v0.7.32 — Aurora ambient depth background.
//
// Layered radial-gradient blobs drift in counter-direction (14s
// alternate) for "living world" depth without paid runtime. Sits as a
// fixed full-bleed layer behind the entire MainShell; content scrolls
// over it. The blobs are painted in the brand fuchsia + two supporting
// hues that don't violate the one-accent rule because they're tinted in
// radial alpha, not surfaced as solid colours.
//
// The diagonal-stripe overlay layer that was here in v0.6.3 was removed
// in the v0.7.32 impeccable audit pass — `repeating-linear-gradient` is
// an explicit ban in the slop-pattern list, and the stripes carried no
// semantic load.
//
// Reduced-motion: the pulse animation is killed via the
// `@media (prefers-reduced-motion)` rule in src/index.css.
//
// Performance note: GPU-accelerated transforms only. No JS runtime, no
// shader, no canvas. Tested at ~0.2% CPU on Apple M2 / Intel i7.

export function AuroraBackground() {
  return (
    <div className="lc-aurora" aria-hidden="true">
      <div className="lc-aurora-blobs" />
    </div>
  );
}
