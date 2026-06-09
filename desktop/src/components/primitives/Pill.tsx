// Primitive: Pill.
// Small tag / status chip with tokenised tone variants. Use everywhere we
// currently spell out `rounded-full bg-fuchsia-soft px-2 text-fuchsia-deep`
// or similar across status surfaces.

import type { HTMLAttributes, ReactNode } from "react";

type Tone = "neutral" | "fuchsia" | "success" | "warning" | "danger" | "info";
type Size = "sm" | "md";

type Props = {
  tone?: Tone;
  size?: Size;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children">;

// v0.7.32 — brand-locked tone palette. impeccable audit (2026-06-09):
// the prior implementation used hardcoded amber/emerald/sky (Tailwind
// raw) for warning/success/info — outside brand. Retoned to 6 visually
// distinct tones, all within the brand kit's locked palette (fuchsia
// ladder + cyan-cool + danger red):
//
//   • neutral  — paper-elev gray. "Not yet" / draft state.
//   • fuchsia  — fuchsia-soft light pink. Default brand chip. "Pending."
//   • success  — fuchsia/85 SOLID fill. Vibrant, lit. Money / approved / paid.
//   • warning  — fuchsia-deep on dim soft. "Needs attention" restraint.
//   • info     — cyan-cool (brand's secondary signal). "FYI / live."
//   • danger   — danger red (#DC2626). The only sanctioned non-fuchsia
//                accent, used by IG-005 Pipeline-failed chip + destructive
//                actions.
//
// Visual ladder ranks intensity: neutral < fuchsia < info < warning < success < danger.
const tones: Record<Tone, string> = {
  neutral: "bg-paper-elev text-text-secondary border-line",
  fuchsia: "bg-fuchsia-soft text-fuchsia-deep border-fuchsia/30",
  success: "bg-fuchsia/90 text-paper border-fuchsia-bright/50",
  warning: "bg-[var(--color-warn-soft)] text-fuchsia-deep border-fuchsia-deep/40",
  danger: "bg-[var(--color-danger)]/18 text-[var(--color-danger-bright)] border-[var(--color-danger)]/40",
  info: "bg-[var(--color-cyan-cool)]/12 text-[var(--color-cyan-cool)] border-[var(--color-cyan-cool)]/35",
};

const sizes: Record<Size, string> = {
  sm: "px-2 py-0.5 text-[10px] tracking-[var(--tracking-eyebrow)]",
  md: "px-2.5 py-1 text-[11px] tracking-[var(--tracking-eyebrow)]",
};

export function Pill({ tone = "neutral", size = "sm", className, children, ...rest }: Props) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full border font-mono uppercase",
        tones[tone],
        sizes[size],
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
