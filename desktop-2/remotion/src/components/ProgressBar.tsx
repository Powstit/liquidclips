import { useCurrentFrame, interpolate } from "remotion";
import { colors, radius, font } from "../lib/tokens";

export const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const START = 45;
  const END = 130;

  const opacity = interpolate(frame, [START - 5, START], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [END, END + 15], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const finalOpacity = Math.min(opacity, fadeOut);

  const pct = interpolate(frame, [START, END], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const label = pct < 30 ? "Transcribing" : pct < 65 ? "Analysing" : "Clipping";

  return (
    <div style={{
      position: "absolute", top: 470, left: 300, width: 520,
      opacity: finalOpacity,
      fontFamily: font.sans, color: colors.ink,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, fontSize: 14 }}>
        <span>{label}…</span>
        <span style={{ color: colors.fuchsia, fontFamily: font.mono }}>{pct.toFixed(0)}%</span>
      </div>
      <div style={{ height: 8, background: colors.paperElev, borderRadius: radius.pill, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`,
          background: `linear-gradient(90deg, ${colors.fuchsia}, ${colors.fuchsiaBright})`,
          borderRadius: radius.pill,
          boxShadow: `0 0 20px ${colors.fuchsia}`,
        }} />
      </div>
    </div>
  );
};
