// Minimal Sheet (drawer) wrapper.
// Slides in from the bottom on desktop for Batch 2 drawers.

import { useEffect } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Sheet({ open, onClose, title, children, className = "" }: SheetProps): JSX.Element | null {
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-end sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={[
          "w-full max-w-2xl translate-y-0 rounded-t-2xl border border-line border-b-0 bg-paper-elev p-5 shadow-[var(--shadow-e2)]",
          "animate-in slide-in-from-bottom-8 duration-200",
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
