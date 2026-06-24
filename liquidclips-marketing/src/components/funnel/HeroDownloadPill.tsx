"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { detectPlatform, osDisplayName, type DetectedOS } from "@/lib/detectPlatform";

/**
 * Hero · Download free pill.
 *
 * Sits ABOVE the HeroPaste input so visitors see DOWNLOAD before PASTE.
 * Routes to /download (the canonical platform-picker page that owns the
 * GitHub Releases asset resolution via DownloadCTA). We deliberately do
 * NOT direct-link the asset here — DownloadCTA already handles
 * SSR-safe rendering, post-click fallback, and Apple-Silicon vs Intel
 * disambiguation. This pill exists to RAISE the download CTA above the
 * fold, not to replace the asset router.
 *
 * SSR / no-JS state: label is "Download free" (no OS suffix).
 * Client hydrated state: "Download free · Mac" (or Windows / Linux).
 *
 * Reduced-motion safe — no animation in this component (the brand pill
 * gradient + hover/focus transitions are pure CSS and inherit the
 * @media (prefers-reduced-motion) gate from funnel.css).
 */
export function HeroDownloadPill() {
  const [os, setOs] = useState<DetectedOS>("unknown");

  useEffect(() => {
    setOs(detectPlatform());
  }, []);

  const suffix = osDisplayName(os);
  const label = suffix ? `Download free · ${suffix}` : "Download free";

  return (
    <div className="lc-w1-download-pill-wrap">
      <Link
        href="/download"
        className="lc-w1-download-pill"
        data-os={os}
        aria-label={`${label} — opens the download page`}
      >
        <span className="lc-w1-download-pill-label">{label}</span>
        <span className="lc-w1-download-pill-glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14">
            <path
              d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="square"
              strokeLinejoin="miter"
            />
          </svg>
        </span>
      </Link>
      <p className="lc-w1-download-pill-sub">100 free clips · no card · 130MB</p>
    </div>
  );
}
