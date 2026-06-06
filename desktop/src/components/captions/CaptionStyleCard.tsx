import { useEffect, useState } from "react";
import type { CaptionLine } from "../../lib/captions";
import { CAPTION_STYLES, type CaptionStyleKey } from "../../lib/caption-styles";
import { CaptionOverlay } from "./CaptionOverlay";

// One style thumbnail in the picker. Plays the same 1.6-second loop of
// sample text rendered in each style so the user picks visually.
//
// Active = fuchsia outer ring. Hover = scale 1.02 + glow.

const SAMPLE_LINE: CaptionLine = {
  start: 0,
  end: 1.6,
  text: "this changed everything",
  words: [
    { start: 0.00, end: 0.30, text: "this" },
    { start: 0.30, end: 0.85, text: "changed" },
    { start: 0.85, end: 1.60, text: "everything" },
  ],
};

export function CaptionStyleCard({
  styleKey,
  active,
  onClick,
}: {
  styleKey: CaptionStyleKey;
  active: boolean;
  onClick: () => void;
}) {
  const spec = CAPTION_STYLES[styleKey];
  const [t, setT] = useState(0);

  // Pause the rAF loop while the document is hidden so the drawer doesn't
  // burn CPU/battery when the window is in the background or behind a
  // different app. Resumes seamlessly on visibility return.
  useEffect(() => {
    let raf = 0;
    let start = performance.now();
    let running = !document.hidden;

    const loop = (now: number) => {
      const elapsed = ((now - start) / 1000) % 1.6;
      setT(elapsed);
      if (running) raf = requestAnimationFrame(loop);
    };

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        if (raf) cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        // Re-base the clock so the animation doesn't jump after resume.
        start = performance.now() - t * 1000;
        raf = requestAnimationFrame(loop);
      }
    };

    if (running) raf = requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // `t` is intentionally NOT a dep — it'd recreate the loop every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="caption-style-card"
      data-active={active}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16 / 9",
        background: "var(--color-paper-elev, #1c1c25)",
        border: active
          ? "2px solid var(--color-fuchsia, #ff1a8c)"
          : "1px solid var(--color-line, rgba(255,255,255,0.07))",
        borderRadius: 10,
        overflow: "hidden",
        cursor: "pointer",
        padding: 0,
        boxShadow: active
          ? "0 0 0 1px var(--color-fuchsia, #ff1a8c), 0 12px 32px rgba(255,26,140,0.28)"
          : undefined,
        transition: "transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease",
      }}
    >
      <div style={{ position: "absolute", inset: 0 }}>
        <CaptionOverlay
          currentTime={t}
          lines={[SAMPLE_LINE]}
          style={styleKey}
          videoHeight={400}
          containerHeight={120}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "6px 10px",
          fontFamily: "var(--font-mono, JetBrains Mono), monospace",
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: active ? "var(--color-fuchsia, #ff1a8c)" : "var(--color-text-tertiary, #8a857e)",
          background: "linear-gradient(transparent, rgba(0,0,0,0.55))",
        }}
      >
        {spec.label}
      </div>
    </button>
  );
}
