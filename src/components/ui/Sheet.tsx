// Minimal Sheet (drawer) wrapper.
// Slides in from the bottom on desktop for Batch 2 drawers.
//
// Ship-lens Batch 1 (Keyboard/Esc sweep · 2026-07-06) · migrated from
// ad-hoc Esc useEffect to useRegisterModal so this Sheet participates
// in the LIFO stack. Stacking a modal on top now dismisses only that
// modal on Esc instead of double-dismissing both surfaces.

import { useId } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useRegisterModal } from "../../design-os/components/ModalPortal";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
  /** Optional stable id for the ModalPortal stack. When omitted, a
   *  React-scoped id keeps concurrent Sheets from collapsing each
   *  other's stack entries (ModalPortal.filter is id-based). */
  id?: string;
}

export function Sheet({ open, onClose, title, children, className = "", id }: SheetProps): JSX.Element | null {
  // Ship-lens Batch 1 P1-009 fix · unique id per instance so stacking
  // two Sheets doesn't nuke the inner one's stack entry when the outer
  // unmounts (ModalPortal:95 filters by id).
  const autoId = useId();
  useRegisterModal({ id: id ?? `sheet-${autoId}`, open, onEscape: onClose });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-end sm:p-4"
      role="dialog"
      aria-modal="true"
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
