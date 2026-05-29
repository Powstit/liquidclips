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

const tones: Record<Tone, string> = {
  neutral: "bg-paper-elev text-text-secondary border-line",
  fuchsia: "bg-fuchsia-soft text-fuchsia-deep border-fuchsia/30",
  success: "bg-[#10B981]/15 text-[#34D399] border-[#10B981]/30",
  warning: "bg-[#EAB308]/15 text-[#FACC15] border-[#EAB308]/30",
  danger: "bg-[#DC2626]/15 text-[#F87171] border-[#DC2626]/30",
  info: "bg-[#3B82F6]/15 text-[#60A5FA] border-[#3B82F6]/30",
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
