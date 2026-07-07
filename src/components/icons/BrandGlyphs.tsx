// Brand glyphs — inline SVG replacements for the most-used Lucide icons
// across desktop-2. Brand-consistency-audit P1 #7 (2026-06-25)
// + bespoke-craft skill: "no Lucide defaults where a brand-kit file exists".
//
// Mirrors desktop/src/components/icons/BrandGlyphs.tsx surface so a future
// shared library can be hoisted without re-writing call sites. desktop-2 has
// 18 Lucide imports today; the top picks below cover the highest-traffic
// glyphs (Scissors, Lock, ArrowRight, Compass, Briefcase, ArrowUpRight,
// Sparkles, Plus).
//
// Visual language: stroked, 1.6px, square caps + 1.5-unit grid, pixel-arcade
// echo of the Liquid Clips invader glyph.

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

export function Scissors(props: BrandGlyphProps) {
  return (
    <Frame {...props}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 L8.5 15.5" />
      <path d="M14 14 L20 20" />
      <path d="M8.5 8.5 L11 11" />
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

export function ArrowRight(props: BrandGlyphProps) {
  return (
    <Frame {...props}>
      <path d="M4 12 H20" />
      <path d="M14 6 L20 12 L14 18" />
    </Frame>
  );
}

export function ArrowUpRight(props: BrandGlyphProps) {
  return (
    <Frame {...props}>
      <path d="M6 18 L18 6" />
      <path d="M8 6 H18 V16" />
    </Frame>
  );
}

export function Compass(props: BrandGlyphProps) {
  return (
    <Frame {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5 L13 13 L8.5 15.5 L11 11 Z" />
    </Frame>
  );
}

export function Briefcase(props: BrandGlyphProps) {
  return (
    <Frame {...props}>
      <rect x="3" y="7" width="18" height="13" rx="1" />
      <path d="M9 7 V5 a1 1 0 0 1 1 -1 h4 a1 1 0 0 1 1 1 V7" />
      <path d="M3 13 H21" />
    </Frame>
  );
}

export function Sparkles(props: BrandGlyphProps) {
  return (
    <Frame {...props}>
      <path d="M9 3 L9 7 M7 5 L11 5" />
      <path d="M16 11 L16 17 M13 14 L19 14" />
      <path d="M5 14 L5 18 M3 16 L7 16" />
    </Frame>
  );
}

export function Plus(props: BrandGlyphProps) {
  return (
    <Frame {...props}>
      <path d="M12 4 L12 20" />
      <path d="M4 12 L20 12" />
    </Frame>
  );
}
