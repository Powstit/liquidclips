/**
 * AgencyOverlay · alpha-channel logo overlay composition.
 *
 * 2026-07-05 · CM lane build on top of HQ's Remotion preview engine.
 *
 * Renders ONLY the agency logo (and optional handle text) with the
 * chosen motion preset, on a fully transparent background. The output
 * is a VP9 WebM with alpha channel · ffmpeg composites this over the
 * user's real clip MP4 at export time.
 *
 * Contrast with the Preview composition (HQ's cold-email use case):
 *   - Preview          · full-frame 1920x1080 · marketing MP4
 *   - AgencyOverlay    · transparent frame · overlay only · no chrome
 *
 * Shared: same Remotion runtime · same brand tokens.
 */

import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import type { AgencyOverlayProps, OverlayPosition } from "./lib/agencyTypes";

interface Corner {
  top?: number | string;
  bottom?: number | string;
  left?: number | string;
  right?: number | string;
  transform?: string;
}

const PADDING = 48;
const LOGO_SIZE = 180;

function positionStyle(position: OverlayPosition): Corner {
  switch (position) {
    case "top-left":       return { top: PADDING, left: PADDING };
    case "top-right":      return { top: PADDING, right: PADDING };
    case "bottom-left":    return { bottom: PADDING, left: PADDING };
    case "bottom-right":   return { bottom: PADDING, right: PADDING };
    case "center-top":     return { top: PADDING, left: "50%", transform: "translateX(-50%)" };
    case "center-bottom":  return { bottom: PADDING, left: "50%", transform: "translateX(-50%)" };
    default:
      // Ship-lens P1-CW-010 defensive default · unknown position value
      // (e.g. a schema drift between backend + composition version)
      // falls back to bottom-right instead of returning undefined and
      // crashing the composition-time render on a null destructure.
      return { bottom: PADDING, right: PADDING };
  }
}

export function AgencyOverlay({
  logoUrl,
  position,
  motion,
  text,
  durationInFrames,
}: AgencyOverlayProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  /* ── Motion presets · pure functions of frame + fps ────────────── */

  let opacity = 1;
  let scale = 1;
  let translateY = 0;
  let translateX = 0;

  if (motion === "fade-in-out") {
    const fadeIn  = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" });
    const fadeOut = interpolate(frame, [durationInFrames - 18, durationInFrames], [1, 0], { extrapolateLeft: "clamp" });
    opacity = Math.min(fadeIn, fadeOut);
  } else if (motion === "corner-pulse") {
    const pulseHz = 0.33;
    scale = 1 + 0.06 * Math.sin((frame / fps) * pulseHz * Math.PI * 2);
    // Small fade-in on the first 12 frames so it doesn't pop in.
    opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  } else if (motion === "slide-in-left") {
    // Slide in from -20% x over 20 frames, hold, slide out over last 20.
    const slideIn  = interpolate(frame, [0, 20], [-20, 0], { extrapolateRight: "clamp" });
    const slideOut = interpolate(frame, [durationInFrames - 20, durationInFrames], [0, -20], { extrapolateLeft: "clamp" });
    translateX = slideIn + slideOut - 0; // one is 0 while the other moves
    opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  } else if (motion === "lower-third") {
    // Slide up from below the corner, hold, slide down.
    const slideUp   = interpolate(frame, [0, 20], [80, 0], { extrapolateRight: "clamp" });
    const slideDown = interpolate(frame, [durationInFrames - 20, durationInFrames], [0, 80], { extrapolateLeft: "clamp" });
    translateY = slideUp + slideDown;
    opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  }
  // motion === "static" · defaults hold (opacity=1, scale=1, no translate)

  const posStyle = positionStyle(position);
  const transform = [
    posStyle.transform ?? "",
    `translate(${translateX}%, ${translateY}%)`,
    `scale(${scale})`,
  ].filter(Boolean).join(" ");

  const showLowerThirdText = motion === "lower-third" && text;

  return (
    // AbsoluteFill with transparent background · the alpha compositor
    // outputs the fully transparent area as alpha=0 so ffmpeg overlay
    // stacks the underlying clip through it.
    <AbsoluteFill style={{ backgroundColor: "rgba(0,0,0,0)" }}>
      <div
        style={{
          position: "absolute",
          ...posStyle,
          transform,
          opacity,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Img
          src={logoUrl}
          style={{
            width: LOGO_SIZE,
            height: LOGO_SIZE,
            objectFit: "contain",
            filter: "drop-shadow(0 4px 24px rgba(0, 0, 0, 0.35))",
          }}
        />
        {showLowerThirdText && (
          <div
            style={{
              fontFamily: "Geist Mono, ui-monospace, Menlo, monospace",
              fontSize: 24,
              fontWeight: 700,
              color: "#F5EFE7",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              textShadow: "0 2px 12px rgba(0, 0, 0, 0.65)",
              padding: "6px 14px",
              background: "rgba(11, 11, 16, 0.72)",
              borderRadius: 6,
            }}
          >
            {text}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}
