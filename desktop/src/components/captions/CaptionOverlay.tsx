import { useMemo } from "react";
import type { CaptionLine } from "../../lib/captions";
import {
  CAPTION_STYLES,
  applyPalette,
  strokeShadow,
  type CaptionPalette,
  type CaptionStyleKey,
} from "../../lib/caption-styles";

// Time-synced caption overlay rendered over the playing video.
//
// Used in TWO places:
//   1. Live overlay over the real <video> in ClipPreview — wired to the
//      video's currentTime via a polling rAF loop or `timeupdate` events.
//   2. Static preview inside CaptionStyleCard at a fixed timestamp.
//
// The overlay matches the eventual ASS bake visually: same font, color,
// outline, drop shadow, words-per-line packing, margin from the bottom.
//
// Important: this renders captions AS POSITIONED DOM over a video element.
// The video sits underneath at its native rect; this layer is `pointer-events:
// none` and absolute-positioned to the same rect.

export function CaptionOverlay({
  currentTime,
  lines,
  style,
  videoHeight = 1920,
  containerHeight,
  palette,
}: {
  currentTime: number;
  lines: CaptionLine[];
  style: CaptionStyleKey;
  /** Canvas height the style fontPx is sized for (default 1920 — 9:16 1080×1920). */
  videoHeight?: number;
  /** Rendered height of the container in CSS px — drives the font-size scale. */
  containerHeight?: number;
  /** User-picked custom colours (Custom style). Merged over the spec so the
   *  live preview reflects the swatches before Apply re-bakes the MP4. */
  palette?: CaptionPalette;
}) {
  const spec = applyPalette(CAPTION_STYLES[style], palette);

  // Find the active line for the current playhead. Uses `<=` on start and
  // strict `<` on end so a line ending at 3.456 doesn't overlap with the
  // next line starting at exactly 3.456.
  const active = useMemo(() => {
    for (const ln of lines) {
      if (currentTime >= ln.start && currentTime < ln.end) return ln;
    }
    return null;
  }, [currentTime, lines]);

  if (!active) return null;

  const scale = containerHeight ? containerHeight / videoHeight : 1;
  const fontPx = Math.max(12, spec.fontPx * scale);
  const outlinePx = Math.max(1, spec.outlinePx * scale);
  const bottomPx = (spec.marginVPercent / 100) * (containerHeight ?? videoHeight);

  // Build per-word renderable spans so karaoke fill can highlight one word.
  const words = active.words && active.words.length > 0
    ? active.words
    : [{ start: active.start, end: active.end, text: active.text }];

  const containerStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: bottomPx,
    display: "flex",
    justifyContent: "center",
    pointerEvents: "none",
    textAlign: "center",
    padding: "0 4%",
  };

  const innerStyle: React.CSSProperties = {
    display: "inline-block",
    fontFamily: spec.fontFamily,
    fontSize: `${fontPx}px`,
    fontWeight: spec.fontWeight,
    lineHeight: 1.08,
    letterSpacing: "-0.005em",
    color: spec.secondary,
    textShadow: [
      strokeShadow(spec.outline, outlinePx),
      spec.shadow ?? "",
    ].filter(Boolean).join(", "),
    padding: spec.boxBg ? `${fontPx * 0.18}px ${fontPx * 0.32}px` : 0,
    background: spec.boxBg,
    borderRadius: spec.boxBg ? `${fontPx * 0.12}px` : 0,
    whiteSpace: "pre-wrap",
    maxWidth: "100%",
  };

  return (
    <div style={containerStyle} aria-hidden="true">
      <div style={innerStyle}>
        {words.map((w, i) => {
          const sungThrough = currentTime >= w.end;
          const currentlySung = currentTime >= w.start && currentTime < w.end;
          const color = spec.karaoke && (sungThrough || currentlySung)
            ? spec.primary
            : spec.secondary;
          return (
            <span
              key={i}
              style={{
                color,
                transition: spec.karaoke ? "color 80ms linear" : undefined,
              }}
            >
              {w.text}
              {i < words.length - 1 ? " " : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}
