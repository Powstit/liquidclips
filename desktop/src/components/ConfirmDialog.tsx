import { useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { AlertTriangle, Trash2 } from "lucide-react";

// Branded confirm primitive — kills the native `confirm()` calls that block
// the Tauri webview thread + break the cockpit voice. Mirrors the visual
// language of LibraryTab's delete modal (bracket corners, fuchsia eyebrow,
// red destructive accent) so destructive confirmations read as one family.
//
// Use this when:
//   • Removing a clip (ClipCard ⋮ menu)
//   • Removing a clip from full editor (ClipPreview footer)
//   • Any future destructive action that needs an "are you sure"
//
// Don't use for non-destructive yes/no — those should be inline affordances
// or undo toasts, not modal interrupts.

export type ConfirmTone = "destructive" | "neutral";

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "destructive",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  /** When true, both buttons disable + the confirm label flips to a busy
   *  string. Set this while the action's promise is in flight so the user
   *  can't double-fire and the modal can't close mid-RPC. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Esc cancels (ignored while busy so we don't strand the user in an
  // indeterminate state mid-RPC). Click-outside cancels for the same reason.
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onCancel();
      }
      // Enter on the confirm button — keyboard users ship destructive
      // actions without reaching for the mouse.
      if (e.key === "Enter" && !busy && document.activeElement === confirmRef.current) {
        e.preventDefault();
        onConfirm();
      }
    },
    [open, busy, onCancel, onConfirm],
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, handleKey]);

  // Auto-focus the cancel button when the modal opens — destructive
  // confirms should default to "no" not "yes" so a stray Enter doesn't ship
  // the action. Cancel is the safe default; confirm requires a deliberate tab.
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      cancelRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const isDestructive = tone === "destructive";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-paper/85 px-6 backdrop-blur-md"
          onClick={() => !busy && onCancel()}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="lc-confirm-title"
        >
          <motion.div
            className="relative w-full max-w-[440px] p-7"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
          >
            {/* Fuchsia HUD bracket corners — matches LibraryTab + the rest of
                the cockpit modals so destructive confirms feel like one family. */}
            <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
            <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
            <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
            <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />

            <div className="flex items-start gap-3">
              <div
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
                  isDestructive
                    ? "bg-[var(--color-danger)]/15 text-[var(--color-danger)]"
                    : "bg-fuchsia/15 text-fuchsia"
                }`}
              >
                {isDestructive ? (
                  <Trash2 className="h-4 w-4" strokeWidth={2.2} />
                ) : (
                  <AlertTriangle className="h-4 w-4" strokeWidth={2.2} />
                )}
              </div>
              <div className="min-w-0">
                <span
                  className={`font-mono text-[10px] uppercase tracking-[0.18em] ${
                    isDestructive ? "text-fuchsia" : "text-fuchsia"
                  }`}
                >
                  confirm
                </span>
                <h3
                  id="lc-confirm-title"
                  className="font-display text-[18px] font-semibold tracking-[-0.015em] text-ink"
                >
                  {title}
                </h3>
                <div className="mt-1 break-words font-sans text-[13px] leading-snug text-text-secondary">
                  {body}
                </div>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="rounded-full border border-line bg-transparent px-4 py-2 font-sans text-[12px] font-medium text-text-secondary hover:border-fuchsia hover:text-ink disabled:opacity-50"
              >
                {cancelLabel}
              </button>
              <button
                ref={confirmRef}
                type="button"
                onClick={onConfirm}
                disabled={busy}
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 font-sans text-[13px] font-medium text-white transition-colors disabled:opacity-60 ${
                  isDestructive
                    ? "bg-[var(--color-danger)] hover:bg-[#B91C1C]"
                    : "bg-fuchsia hover:bg-fuchsia-bright"
                }`}
              >
                {isDestructive && <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />}
                {busy ? `${confirmLabel.replace(/\s*…\s*$/, "")}…` : confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
