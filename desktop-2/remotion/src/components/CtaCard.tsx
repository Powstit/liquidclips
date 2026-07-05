import { useCurrentFrame, spring, useVideoConfig, interpolate, AbsoluteFill } from "remotion";
import { colors, radius, font } from "../lib/tokens";

export const CtaCard: React.FC<{ handle: string; claimUrl: string; totalClips: number }> = ({
  handle,
  claimUrl,
  totalClips,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const START = 480;

  const opacity = interpolate(frame, [START - 5, START + 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scale = spring({ frame: frame - START, fps, config: { damping: 120 }, from: 0.9, to: 1 });

  return (
    <AbsoluteFill style={{
      opacity,
      background: `radial-gradient(ellipse at center, ${colors.paper} 60%, rgba(11,11,16,0.98) 100%)`,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        transform: `scale(${scale})`,
        maxWidth: 720, padding: 48,
        background: `linear-gradient(180deg, ${colors.paperWarm}, ${colors.paper})`,
        borderRadius: radius.cardLg,
        border: `2px solid ${colors.fuchsia}`,
        boxShadow: `0 40px 100px rgba(255,26,140,0.3), 0 0 60px rgba(255,26,140,0.2)`,
        textAlign: "center",
      }}>
        <div style={{ fontFamily: font.sans, fontSize: 13, textTransform: "uppercase", letterSpacing: 2, color: colors.fuchsia, marginBottom: 16 }}>
          Ready for {handle}
        </div>
        <div style={{ fontFamily: font.display, fontSize: 56, fontWeight: 800, color: colors.ink, lineHeight: 1.1, marginBottom: 20 }}>
          Your <span style={{ color: colors.fuchsia }}>{totalClips} clips</span> are ready
        </div>
        <div style={{ fontFamily: font.sans, fontSize: 18, color: colors.inkSoft, marginBottom: 28, lineHeight: 1.5 }}>
          Download Liquid Clips · unlock instantly · post today
        </div>
        <div style={{
          display: "inline-block",
          background: colors.fuchsia,
          color: colors.paper,
          padding: "16px 32px",
          borderRadius: radius.pill,
          fontFamily: font.display,
          fontSize: 20,
          fontWeight: 800,
          letterSpacing: 0.3,
        }}>
          {claimUrl}
        </div>
      </div>
    </AbsoluteFill>
  );
};
