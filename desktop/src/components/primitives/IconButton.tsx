// Primitive: IconButton.
// Square icon-only button for toolbars / chrome bars / inline actions.
// Same tokenised hover/focus treatment as Button without text padding.

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "ghost" | "outline" | "primary";
type Size = "sm" | "md";

type Props = {
  variant?: Variant;
  size?: Size;
  label: string;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

const sizes: Record<Size, string> = {
  sm: "h-7 w-7 text-[12px]",
  md: "h-9 w-9 text-[14px]",
};

const variants: Record<Variant, string> = {
  ghost: "text-text-secondary hover:bg-paper-elev hover:text-ink",
  outline:
    "border border-line bg-paper text-text-secondary hover:border-fuchsia hover:text-fuchsia",
  primary: "bg-fuchsia text-white hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)]",
};

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { variant = "outline", size = "sm", label, className, children, ...rest },
  ref,
) {
  const base =
    "inline-flex items-center justify-center rounded-md transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-35 focus:outline-none focus-visible:shadow-[var(--glow-sm)]";
  return (
    <button
      ref={ref}
      title={label}
      aria-label={label}
      className={[base, sizes[size], variants[variant], className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
});
