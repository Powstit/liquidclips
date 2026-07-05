import { useCurrentFrame, spring, useVideoConfig, interpolate } from "remotion";
import { colors, radius, font } from "../lib/tokens";

export const ClipGrid: React.FC<{ frameUrls: string[]; clipTitles: string[]; totalClips: number }> = ({
  frameUrls,
  clipTitles,
  totalClips,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const gridStart = 130;
  const tileStagger = 12;
  const gridOpacity = interpolate(frame, [gridStart - 10, gridStart], [0, 1], { extrapolateRight: "clamp" });

  return (
    <div style={{
      position: "absolute", top: 90, left: 860, right: 40, bottom: 40,
      opacity: gridOpacity,
    }}>
      <div style={{ fontFamily: font.sans, fontSize: 12, textTransform: "uppercase", letterSpacing: 1.2, color: colors.inkSoft, marginBottom: 12 }}>
        Clips generated
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 16,
      }}>
        {frameUrls.slice(0, 8).map((url, i) => {
          const tileFrame = frame - (gridStart + i * tileStagger);
          const scale = spring({ frame: tileFrame, fps, config: { damping: 100, mass: 0.5 }, from: 0.7, to: 1 });
          const tileOpacity = interpolate(tileFrame, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <div key={i} style={{
              opacity: tileOpacity, transform: `scale(${scale})`,
              background: colors.paperElev, borderRadius: radius.card, overflow: "hidden",
              border: `1px solid rgba(255,255,255,0.06)`,
            }}>
              <div style={{ aspectRatio: 9 / 16, position: "relative", background: colors.paper }}>
                <img
                  src={url}
                  crossOrigin="anonymous"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
                <div style={{
                  position: "absolute", top: 8, left: 8,
                  background: colors.fuchsia, color: colors.ink,
                  padding: "3px 8px", borderRadius: radius.pill,
                  fontFamily: font.mono, fontSize: 10, fontWeight: 700,
                }}>
                  #{i + 1}
                </div>
              </div>
              <div style={{
                padding: 12,
                fontFamily: font.sans, fontSize: 12, color: colors.ink,
                lineHeight: 1.35,
                minHeight: 44,
              }}>
                {clipTitles[i] ?? `Clip ${i + 1}`}
              </div>
            </div>
          );
        })}
      </div>

      {/* "94 more clips ready" */}
      <div style={{
        opacity: interpolate(frame, [380, 400], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        marginTop: 20,
        textAlign: "center", fontFamily: font.sans, fontSize: 14, color: colors.inkSoft,
      }}>
        + <span style={{ color: colors.fuchsia, fontWeight: 700 }}>{totalClips - 8}</span> more clips locked
      </div>
    </div>
  );
};
