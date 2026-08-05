// The canonical 24×16 pixel invader landmark — same path data as desktop's
// IG-012 brand primitive (desktop/src/components/brand/PixelInvader.tsx).
// Inline SVG so it's genuinely transparent at any size. The raster export
// (`/brand/logo-monogram.png`) baked an opaque dark glow into its
// background and reads as a near-solid dark square below ~40px — found
// live on the /upgrade checkout page 2026-08-05.
export function PixelInvader({
  size = 20,
  className = "fill-fuchsia",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 16"
      width={size}
      height={(size * 16) / 24}
      className={className}
      style={{ imageRendering: "pixelated" }}
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
