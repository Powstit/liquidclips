import { useCurrentFrame, spring, useVideoConfig, interpolate } from "remotion";
import { colors, radius, font } from "../lib/tokens";

export const InputPanel: React.FC<{ thumbnailUrl: string; videoTitle: string; channelName: string }> = ({
  thumbnailUrl,
  videoTitle,
  channelName,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Panel slides in from left after chrome
  const y = spring({ frame: frame - 20, fps, config: { damping: 180 }, from: -40, to: 0 });
  const opacity = interpolate(frame, [20, 40], [0, 1], { extrapolateRight: "clamp" });

  return (
    <div style={{
      position: "absolute", top: 90, left: 300, width: 520,
      background: colors.paperElev,
      borderRadius: radius.card,
      padding: 24,
      opacity,
      transform: `translateY(${y}px)`,
      border: `1px solid rgba(255,255,255,0.08)`,
      boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
    }}>
      <div style={{ fontFamily: font.sans, fontSize: 12, textTransform: "uppercase", letterSpacing: 1.2, color: colors.inkSoft, marginBottom: 12 }}>
        Input · Long-form video
      </div>
      <img
        src={thumbnailUrl}
        crossOrigin="anonymous"
        style={{ width: "100%", height: 260, objectFit: "cover", borderRadius: radius.control }}
      />
      <div style={{ marginTop: 14, fontFamily: font.display, fontSize: 18, fontWeight: 600, color: colors.ink, lineHeight: 1.3 }}>
        {videoTitle}
      </div>
      <div style={{ marginTop: 6, fontFamily: font.sans, fontSize: 13, color: colors.inkSoft }}>
        {channelName}
      </div>
    </div>
  );
};
