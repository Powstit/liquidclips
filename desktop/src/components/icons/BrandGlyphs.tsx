// Brand glyphs — inline SVG replacements for the most-used Lucide icons
// across the desktop surface. Brand-consistency-audit P1 #6 (2026-06-25)
// + bespoke-craft skill: "no Lucide defaults where a brand-kit file exists".
//
// API mirrors Lucide so existing call sites swap with a single import
// rename:
//   - `import { Sparkles } from "lucide-react"` → `import { Sparkles } from "@/components/icons/BrandGlyphs"`
//   - All accept `size` (px, default 16) + `className` (color via currentColor)
//
// Visual language: stroked, 1.6px, square caps + 1.5-unit grid, pixel-arcade
// echo of the Liquid Clips invader glyph. Round corners on Plus / Check; flat
// caps on the bracket-style icons.

import type { SVGProps } from "react";

export interface BrandGlyphProps extends Omit<SVGProps<SVGSVGElement>, "size"> {
  size?: number | string;
}

function Frame({
  size = 16,
  children,
  ...rest
}: BrandGlyphProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function ExternalLink(props: BrandGlyphProps) {
  return (
    <Frame {...props}>
      {/* Box with a vector arrow shooting out the top-right corner */}
      <path d="M5 5 L14 5 L14 8" />
      <path d="M5 5 L5 19 L19 19 L19 10" />
      <path d="M11 13 L19 5" />
      <path d="M14 5 L19 5 L19 10" />
    </Frame>
  );
}

export function Sparkles(props: BrandGlyphProps) {
  return (
    <Frame {...props}>
      {/* Pixel-arcade twin-spark — the invader's idle eye-blink */}
      <path d="M9 3 L9 7 M7 5 L11 5" />
      <path d="M16 11 L16 17 M13 14 L19 14" />
      <path d="M5 14 L5 18 M3 16 L7 16" />
    </Frame>
  );
}

export function Plus(props: BrandGlyphProps) {
  return (
    <Frame {...props}>
      {/* Square plus — same stroke vocabulary as the cockpit bracket */}
      <path d="M12 4 L12 20" />
      <path d="M4 12 L20 12" />
    </Frame>
  );
}

export function AlertTriangle(props: BrandGlyphProps) {
  return (
    <Frame {...props}>
      {/* Bracket triangle + dot — the Liquid Clips "alert chamber" lockup */}
      <path d="M12 3 L21 20 L3 20 Z" />
      <path d="M12 10 L12 14" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </Frame>
  );
}

export function RefreshCw(props: BrandGlyphProps) {
  return (
    <Frame {...props}>
      {/* Open-ring sweep + chevron — reads as "rerun the pipeline" */}
      <path d="M4 12 A 8 8 0 1 1 6.5 17.7" />
      <path d="M3 19 L6.5 17.7 L7.5 21" />
    </Frame>
  );
}

export function Check(props: BrandGlyphProps) {
  return (
    <Frame {...props}>
      {/* Sharp-cap checkmark — brand-locked "done" glyph */}
      <path d="M4 12 L10 18 L20 6" />
    </Frame>
  );
}

export function Lock(props: BrandGlyphProps) {
  return (
    <Frame {...props}>
      <rect x="4" y="11" width="16" height="10" />
      <path d="M8 11 V7 a4 4 0 0 1 8 0 v4" />
      <path d="M12 15 V18" />
    </Frame>
  );
}
