import { madeWithLiquidClips } from "./brandAssets";

export function MadeWithLiquidClips({ height = 16 }: { height?: number }) {
  return (
    <img
      src={madeWithLiquidClips}
      alt="Made with Liquid Clips"
      height={height}
      className="block"
      style={{
        height,
        width: "auto",
        filter: "drop-shadow(0 0 6px rgba(255, 26, 140, 0.55))",
      }}
    />
  );
}
