/**
 * PoweredByWhop · reusable brand attribution component.
 *
 * Sourced from the powered-by-whop skill at
 * ~/.claude/skills/powered-by-whop/. Drop into any Liquid Clips surface
 * where Whop is acting as auth / payment / identity rail.
 *
 * Prop shape:
 *   label · attribution text ("Powered by Whop" default)
 *   size  · height tier (xs=12 sm=16 md=20 lg=28 px)
 *   theme · "dark" (white lockup for dark bg) / "light" (inverted)
 *
 * Asset expected at /brand/whop-lockup-white.svg (copied from the skill
 * assets into desktop-2/public/brand/ during install).
 */

import type { ReactElement } from "react";

type PoweredByWhopSize = "xs" | "sm" | "md" | "lg";
type PoweredByWhopTheme = "dark" | "light";

interface PoweredByWhopProps {
  label?: string;
  size?: PoweredByWhopSize;
  theme?: PoweredByWhopTheme;
  testId?: string;
  style?: React.CSSProperties;
  className?: string;
}

const SIZE_MAP: Record<PoweredByWhopSize, { label: number; height: number; gap: number }> = {
  xs: { label: 10, height: 12, gap: 4 },
  sm: { label: 11, height: 16, gap: 6 },
  md: { label: 12, height: 20, gap: 8 },
  lg: { label: 14, height: 28, gap: 10 },
};

const WHOP_LOCKUP_SVG_PATH = "/brand/whop-lockup-white.svg";

export function PoweredByWhop({
  label = "Powered by Whop",
  size = "sm",
  theme = "dark",
  testId,
  style,
  className,
}: PoweredByWhopProps): ReactElement {
  const dims = SIZE_MAP[size];
  const invertFilter = theme === "light" ? "invert(1) brightness(0.15)" : "none";
  const labelColor = theme === "light" ? "#111" : "rgba(244, 241, 234, 0.62)";

  return (
    <div
      data-testid={testId ?? "powered-by-whop"}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: dims.gap,
        fontFamily: `"Geist Mono", ui-monospace, "SF Mono", monospace`,
        fontSize: dims.label,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: labelColor,
        userSelect: "none",
        ...style,
      }}
    >
      <span>{label}</span>
      <img
        src={WHOP_LOCKUP_SVG_PATH}
        alt="Whop"
        style={{
          height: dims.height,
          width: "auto",
          filter: invertFilter,
          display: "block",
        }}
      />
    </div>
  );
}
