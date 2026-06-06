// Primitive: Card.
// Replaces every ad-hoc `rounded-2xl border border-line bg-paper-elev p-...`
// with a tokenised surface. Variants control elevation; nothing else.

import type { HTMLAttributes, ReactNode } from "react";

type Elevation = "flat" | "rest" | "raised";
type Padding = "none" | "sm" | "md" | "lg";
// v0.6.2 — Tone is purely additive: "default" preserves every existing
// callsite's appearance; "hud" layers the .hud-frame chrome (bracket
// corners + soft inner glow) for cards that should read as featured / game
// surfaces (Minecraft hero, money source tiles, platform-connect tiles).
type Tone = "default" | "hud";

type Props = {
  elevation?: Elevation;
  padding?: Padding;
  hoverable?: boolean;
  selected?: boolean;
  tone?: Tone;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">;

const elevations: Record<Elevation, string> = {
  flat: "border-line",
  rest: "border-line shadow-[var(--shadow-e1)]",
  raised: "border-line-strong shadow-[var(--shadow-e2)]",
};

const paddings: Record<Padding, string> = {
  none: "",
  sm: "p-3",
  md: "p-5",
  lg: "p-7",
};

export function Card({
  elevation = "rest",
  padding = "md",
  hoverable,
  selected,
  tone = "default",
  className,
  children,
  ...rest
}: Props) {
  const cls = [
    // `isolate` creates a new stacking context so the card's content can't
    // leak under sibling/ancestor compositing surfaces (modal scrims, etc).
    "isolate rounded-2xl border bg-paper-elev transition-all duration-200",
    elevations[elevation],
    paddings[padding],
    hoverable && "hover:border-fuchsia/40 hover:shadow-[var(--shadow-e2)]",
    selected && "border-fuchsia/60 shadow-[var(--glow-sm)]",
    // Layered chrome — `.hud-frame` paints the four corner brackets +
    // inner glow on top of the existing border so the corner accent reads
    // even when the border colour shifts (hover/selected).
    tone === "hud" && "hud-frame",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    // Inline style is a hard backstop against any rule that could blank
    // `bg-paper-elev` via class-order shenanigans — modals must never bleed.
    <div className={cls} style={{ backgroundColor: "var(--color-paper-elev)" }} {...rest}>
      {children}
    </div>
  );
}
