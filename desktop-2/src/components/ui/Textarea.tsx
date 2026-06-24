// Minimal Textarea wrapper.

import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className = "", ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={[
          "w-full resize-none rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-text-tertiary",
          "transition-colors duration-150 focus:border-fuchsia focus:outline-none focus-visible:shadow-[var(--glow-sm)]",
          className,
        ].join(" ")}
        {...rest}
      />
    );
  },
);
