// Minimal Input wrapper.

import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={[
          "w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-text-tertiary",
          "transition-colors duration-150 focus:border-fuchsia focus:outline-none focus-visible:shadow-[var(--glow-sm)]",
          className,
        ].join(" ")}
        {...rest}
      />
    );
  },
);
