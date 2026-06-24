// Minimal Dialog wrapper.
// Use for simulator modals and link-out placeholders.

import { useEffect } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Dialog({ open, onClose, title, children, className = "" }: DialogProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={[
          "relative w-full max-w-md rounded-2xl border border-line bg-paper-elev p-5 shadow-[var(--shadow-e2)]",
          className,
        ].join(" ")}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          {title ? <h3 className="font-display text-lg font-semibold tracking-tight">{title}</h3> : <div />}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-paper hover:text-ink"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
