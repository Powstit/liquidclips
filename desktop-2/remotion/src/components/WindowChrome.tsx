import { AbsoluteFill, Img, staticFile, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { colors, radius, font } from "../lib/tokens";
import { timing } from "../lib/tokens";

export const WindowChrome: React.FC<{ handle: string; avatarUrl: string }> = ({ handle, avatarUrl }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const chromeOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });
  const chromeY = spring({ frame, fps, config: { damping: 200 }, from: 20, to: 0 });

  return (
    <AbsoluteFill style={{ opacity: chromeOpacity, transform: `translateY(${chromeY}px)` }}>
      {/* Traffic-light window bar */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 44,
        background: colors.paperWarm,
        borderBottom: `1px solid rgba(255,255,255,0.06)`,
        display: "flex", alignItems: "center", padding: "0 20px", gap: 10,
      }}>
        <div style={{ width: 12, height: 12, borderRadius: 999, background: "#ff5f57" }} />
        <div style={{ width: 12, height: 12, borderRadius: 999, background: "#febc2e" }} />
        <div style={{ width: 12, height: 12, borderRadius: 999, background: "#28c840" }} />
        <div style={{ marginLeft: 20, color: colors.inkSoft, fontFamily: font.sans, fontSize: 13, letterSpacing: 0.3 }}>
          Liquid Clips
        </div>
      </div>

      {/* Left sidebar */}
      <div style={{
        position: "absolute", top: 44, left: 0, bottom: 0, width: 260,
        background: colors.paperWarm,
        borderRight: `1px solid rgba(255,255,255,0.06)`,
        padding: 24,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
          <Img src={staticFile("brand/glyph.png")} style={{ width: 32, height: 32 }} />
          <Img src={staticFile("brand/wordmark.png")} style={{ height: 22, objectFit: "contain" }} />
        </div>

        {/* Account row */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "12px 14px",
          background: colors.paperElev, borderRadius: radius.control,
        }}>
          <img src={avatarUrl} style={{ width: 36, height: 36, borderRadius: 999, objectFit: "cover" }} />
          <div>
            <div style={{ color: colors.ink, fontFamily: font.sans, fontSize: 14, fontWeight: 600 }}>{handle}</div>
            <div style={{ color: colors.inkSoft, fontFamily: font.sans, fontSize: 11 }}>Free · signed in</div>
          </div>
        </div>

        {/* Nav placeholder items */}
        {["Workspace", "Browse", "Editor", "Earn", "Settings"].map((label, i) => (
          <div key={label} style={{
            marginTop: 8, padding: "10px 14px",
            color: i === 0 ? colors.ink : colors.inkSoft,
            fontFamily: font.sans, fontSize: 14,
            background: i === 0 ? colors.fuchsiaSoft : "transparent",
            borderRadius: radius.control,
          }}>{label}</div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
