// Primitive: HudBadge.
// Ready-Player-One-style pill used for level / alert / idle / locked HUD
// chips across the app. Thin neon outline + optional inner glow for the
// active variants, monospace uppercase text. Sole accent is fuchsia (brand
// rule), idle / locked fall back to the existing slate / muted line tokens
// so we don't sneak in a new colour.
//
// Reuses only existing tokens from src/index.css:
//   --color-fuchsia, --color-fuchsia-deep, --color-fuchsia-soft,
//   --color-line, --color-line-strong, --color-text-secondary,
//   --color-text-tertiary, --tracking-eyebrow

import type { HTMLAttributes, ReactNode } from "react";

export type HudBadgeVariant = "level" | "alert" | "idle" | "locked";

type HudBadgeProps = {
  variant?: HudBadgeVariant;
  children: ReactNode;
  className?: string;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children" | "className">;

// Variant → (border, text, glow) class fragments. Glow is only painted on
// `level` and `alert` so passive chips stay quiet on a dense surface.
const VARIANT_CLASSES: Record<HudBadgeVariant, string> = {
  level:
    "border-fuchsia/60 text-fuchsia-deep shadow-[inset_0_0_8px_rgba(255,26,140,0.25),0_0_12px_rgba(255,26,140,0.18)]",
  alert:
    "border-fuchsia text-fuchsia shadow-[inset_0_0_10px_rgba(255,26,140,0.35),0_0_14px_rgba(255,26,140,0.28)]",
  idle: "border-line-strong text-text-secondary",
  locked: "border-line text-text-tertiary opacity-70",
};

export function HudBadge({
  variant = "idle",
  children,
  className,
  ...rest
}: HudBadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full border bg-transparent px-2.5 py-0.5",
        "font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] leading-none",
        VARIANT_CLASSES[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </span>
  );
}
