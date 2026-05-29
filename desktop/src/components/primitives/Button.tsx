// Primitive: Button.
// Reads only from the design tokens in src/index.css. No inline hex / shadow
// strings. Use this everywhere we currently spell out
// `bg-fuchsia hover:bg-fuchsia-bright shadow-[0_10px_30px_...]` by hand.

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

type Props = {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-full font-sans font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus-visible:shadow-[var(--glow-sm)]";

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[12px]",
  md: "h-10 px-5 text-[13px]",
};

const variants: Record<Variant, string> = {
  primary:
    "bg-fuchsia text-white hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)] active:scale-[0.98]",
  secondary:
    "border border-line bg-paper-elev text-ink hover:border-fuchsia hover:text-fuchsia",
  ghost:
    "border border-transparent text-text-secondary hover:text-ink hover:bg-paper-elev",
  danger:
    "border border-[#DC2626]/50 bg-paper-elev text-[#F87171] hover:border-[#DC2626] hover:text-[#F87171]",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", size = "md", loading, leadingIcon, trailingIcon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={[base, sizes[size], variants[variant], className].filter(Boolean).join(" ")}
      {...rest}
    >
      {loading ? <span className="font-mono">…</span> : leadingIcon}
      {children}
      {!loading && trailingIcon}
    </button>
  );
});
