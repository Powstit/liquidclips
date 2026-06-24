import { logoGlyph } from "../brand/brandAssets";

export function LiquidInvaderLoader() {
  return (
    <span
      className="lc-liquid-loader"
      aria-hidden="true"
      style={{ ["--liquid-mask" as string]: `url("${logoGlyph}")` }}
    />
  );
}
