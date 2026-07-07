import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

// Adapted from Liquid Clips 2.0 Starter Kit 01_BRAND_KIT/React_components/Logo.tsx.
// The pixel-alien glyph is served from /brand/assets/glyph.png so it crisp-scales
// at every size. The wordmark is rendered in Inter/display weight for sharpness.
//
// Sizes:
//   sm — h-5 glyph + 14px text. Dense UI (side nav brand chip).
//   md — h-7 glyph + 18px text. Default header chrome.
//   lg — h-12 glyph + 30px text. Splash + first-run + marketing hero.
type LogoSize = "sm" | "md" | "lg" | "xl" | "xxl";

const SCALES: Record<
  LogoSize,
  { glyph: string; text: string; gap: string; tracking: string }
> = {
  sm:  { glyph: "h-5 w-5",   text: "text-[14px]", gap: "gap-1.5", tracking: "tracking-[-0.015em]" },
  md:  { glyph: "h-7 w-7",   text: "text-[18px]", gap: "gap-2",   tracking: "tracking-[-0.02em]"  },
  lg:  { glyph: "h-12 w-12", text: "text-[30px]", gap: "gap-3",   tracking: "tracking-[-0.025em]" },
  xl:  { glyph: "h-16 w-16", text: "text-[40px]", gap: "gap-4",   tracking: "tracking-[-0.03em]"  },
  // xxl = splash brand-moment scale. Used only by IntroSplash so the logo
  // reads as the product identity, not a tiny header glyph.
  xxl: { glyph: "h-28 w-28", text: "text-[64px]", gap: "gap-5",   tracking: "tracking-[-0.035em]" },
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
        src="/brand/assets/glyph.png"
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
