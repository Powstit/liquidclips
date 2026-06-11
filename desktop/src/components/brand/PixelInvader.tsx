// ───── IG-012 brand-kit primitive ─────
// The canonical 24×16 pixel invader landmark. Inlined SVG so consumers
// can size it via Tailwind classes (h-N w-N). Fuchsia fill, drop-shadow,
// optional breathing animation. Reach for this instead of pasting the
// SVG path data again — one source of truth.

export function PixelInvader({
  className = "h-10 w-14",
  glow = "md",
  breathing = true,
}: {
  className?: string;
  /** Drop-shadow intensity. `none` for muted contexts, `md` default, `lg` for
   *  hero/landmark surfaces. */
  glow?: "none" | "sm" | "md" | "lg";
  /** Idle scale breathing animation (5s loop). Defaults on for landmark use;
   *  turn off when the invader sits inside an already-animated container. */
  breathing?: boolean;
}) {
  const glowFilter =
    glow === "none" ? undefined :
    glow === "sm" ? "drop-shadow(0 0 6px rgba(255,26,140,0.55))" :
    glow === "lg" ? "drop-shadow(0 0 36px rgba(255,26,140,0.85))" :
    "drop-shadow(0 0 18px rgba(255,26,140,0.7))";
  return (
    <svg
      viewBox="0 0 24 16"
      className={`fill-fuchsia ${breathing ? "breathing" : ""} ${className}`}
      style={{
        filter: glowFilter,
        imageRendering: "pixelated",
      }}
      aria-hidden="true"
    >
      <rect x="3" y="2" width="2" height="2" />
      <rect x="19" y="2" width="2" height="2" />
      <rect x="5" y="4" width="14" height="2" />
      <rect x="3" y="6" width="2" height="2" />
      <rect x="7" y="6" width="2" height="2" />
      <rect x="15" y="6" width="2" height="2" />
      <rect x="19" y="6" width="2" height="2" />
      <rect x="3" y="8" width="18" height="2" />
      <rect x="5" y="10" width="2" height="2" />
      <rect x="9" y="10" width="6" height="2" />
      <rect x="17" y="10" width="2" height="2" />
      <rect x="1" y="12" width="2" height="2" />
      <rect x="7" y="12" width="2" height="2" />
      <rect x="15" y="12" width="2" height="2" />
      <rect x="21" y="12" width="2" height="2" />
    </svg>
  );
}
