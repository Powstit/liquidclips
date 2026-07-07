// Minimal Badge wrapper.
// No external deps; styled with existing CSS tokens.

import type { ReactNode } from "react";

type Tone = "default" | "brand" | "soon" | "ok" | "warn" | "live";

interface BadgeProps {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}

const tones: Record<Tone, string> = {
  default: "border-line bg-paper text-text-secondary",
  brand: "border-fuchsia/30 bg-fuchsia/10 text-fuchsia",
  soon: "border-cyan/30 bg-cyan/10 text-cyan",
  ok: "border-emerald/30 bg-emerald/10 text-emerald",
  warn: "border-amber/30 bg-amber/10 text-amber",
  live: "border-rose/30 bg-rose/10 text-rose",
};

export function Badge({ children, tone = "default", className = "" }: BadgeProps): JSX.Element {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        tones[tone],
        className,
      ].join(" ")}
    >
      {children}
    </span>
  );
}
