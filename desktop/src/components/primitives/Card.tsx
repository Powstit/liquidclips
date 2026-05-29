// Primitive: Card.
// Replaces every ad-hoc `rounded-2xl border border-line bg-paper-elev p-...`
// with a tokenised surface. Variants control elevation; nothing else.

import type { HTMLAttributes, ReactNode } from "react";

type Elevation = "flat" | "rest" | "raised";
type Padding = "none" | "sm" | "md" | "lg";

type Props = {
  elevation?: Elevation;
  padding?: Padding;
  hoverable?: boolean;
  selected?: boolean;
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
  className,
  children,
  ...rest
}: Props) {
  const cls = [
    "rounded-2xl border bg-paper-elev transition-all duration-200",
    elevations[elevation],
    paddings[padding],
    hoverable && "hover:border-fuchsia/40 hover:shadow-[var(--shadow-e2)]",
    selected && "border-fuchsia/60 shadow-[var(--glow-sm)]",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
