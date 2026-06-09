// Primitive: Input.
// Standard text input with the brand focus treatment (fuchsia ring via
// --glow-sm). Use this for all single-line text inputs across the app
// instead of hand-crafting border + focus styles each time.

import { forwardRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";

type Size = "sm" | "md";

type Props = {
  size?: Size;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  invalid?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "size">;

const sizes: Record<Size, string> = {
  sm: "h-8 text-[12px]",
  md: "h-10 text-[13px]",
};

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { size = "md", leadingIcon, trailingIcon, invalid, className, ...rest },
  ref,
) {
  const padLeft = leadingIcon ? "pl-9" : "pl-3";
  const padRight = trailingIcon ? "pr-9" : "pr-3";
  const base =
    "w-full rounded-md border bg-paper text-ink outline-none transition-colors placeholder:text-text-tertiary focus:border-fuchsia focus:shadow-[var(--glow-sm)]";
  const border = invalid ? "border-[var(--color-danger)]" : "border-line";
  return (
    <div className="relative flex items-center">
      {leadingIcon && (
        <span className="pointer-events-none absolute left-2.5 flex h-full items-center text-text-tertiary">
          {leadingIcon}
        </span>
      )}
      <input
        ref={ref}
        spellCheck={false}
        autoComplete="off"
        className={[base, sizes[size], padLeft, padRight, border, className].filter(Boolean).join(" ")}
        {...rest}
      />
      {trailingIcon && (
        <span className="pointer-events-none absolute right-2.5 flex h-full items-center text-text-tertiary">
          {trailingIcon}
        </span>
      )}
    </div>
  );
});
