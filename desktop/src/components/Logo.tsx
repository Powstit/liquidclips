import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import glyphUrl from "../assets/brand/glyph.png";

// v0.6.2 — Linear/Whop pattern: separable glyph + system-font wordmark.
// The pixel-alien is the persistent brand mark; the "Liquid/Clips" text is
// rendered by React so it crisp-scales from 12px to 80px without becoming
// the blurry outline-PNG we had in v0.6.1. Three sizes cover every surface
// in the app.
//
// Sizes:
//   sm  — h-5 glyph + 14px text. Dense UI (header chips, footers).
//   md  — h-7 glyph + 18px text. Default. Header + most chrome.
//   lg  — h-12 glyph + 30px text. Splash + first-run + marketing hero.
type LogoSize = "sm" | "md" | "lg";

const SCALES: Record<
  LogoSize,
  { glyph: string; text: string; gap: string; tracking: string }
> = {
  sm: { glyph: "h-5 w-5", text: "text-[14px]", gap: "gap-1.5", tracking: "tracking-[-0.015em]" },
  md: { glyph: "h-7 w-7", text: "text-[18px]", gap: "gap-2", tracking: "tracking-[-0.02em]" },
  lg: { glyph: "h-12 w-12", text: "text-[30px]", gap: "gap-3", tracking: "tracking-[-0.025em]" },
};

export function Logo({
  size = "md",
  showVersion = true,
}: {
  size?: LogoSize;
  /** Only the header version of the mark surfaces the version pill. */
  showVersion?: boolean;
}) {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!showVersion) return;
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, [showVersion]);

  const s = SCALES[size];

  return (
    <div className={`inline-flex items-center ${s.gap}`}>
      <img
        src={glyphUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={`block ${s.glyph} select-none`}
        style={{ imageRendering: "pixelated" }}
      />
      <span
        className={`font-display ${s.text} font-semibold ${s.tracking} text-ink`}
        aria-label="Liquid Clips"
      >
        liquid
        <span className="text-fuchsia">/</span>
        clips
      </span>
      {showVersion && version && (
        <span className="rounded-full border border-line/60 bg-paper/5 px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
          v{version}
        </span>
      )}
    </div>
  );
}
