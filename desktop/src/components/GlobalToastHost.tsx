import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// ──────────────────────────────────────────────────────────────────────
// GlobalToastHost
//
// Single, app-wide toast surface. Any code in the app can surface a
// non-blocking notice by dispatching a window `CustomEvent`:
//
//   window.dispatchEvent(new CustomEvent("lc:toast", {
//     detail: { kind: "success" | "error" | "info", message: "…" },
//   }));
//
// Several other agents need this emitter pattern — the drag-drop
// "unsupported file" error, openExternal failures, "copied to clipboard"
// confirmations, scheduled-post reminders, etc. They dispatch; this
// component renders. No imports needed at the call site, which keeps it
// easy to add toasts from anywhere (event handlers, lib catch blocks,
// even one-off scripts).
//
// Mount once at the top of App.tsx so EVERY
// `window.dispatchEvent(new CustomEvent('lc:toast', ...))` from anywhere
// in the app is visible to the user.
// ──────────────────────────────────────────────────────────────────────

type ToastKind = "success" | "error" | "info";

type ToastInput = {
  kind?: ToastKind;
  message: string;
  /** Optional override (ms). Defaults: 5000 for success/info, 8000 for error. */
  durationMs?: number;
};

type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
  durationMs: number;
};

let toastSeq = 1;

function nextId(): number {
  toastSeq += 1;
  return toastSeq;
}

function isToastInput(value: unknown): value is ToastInput {
  if (!value || typeof value !== "object") return false;
  const v = value as { message?: unknown };
  return typeof v.message === "string" && v.message.length > 0;
}

function normalizeKind(kind: unknown): ToastKind {
  return kind === "success" || kind === "error" || kind === "info" ? kind : "info";
}

export function GlobalToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Portal target is the document body — keeps the toasts above every
  // scrolling deck/modal stacking context without depending on App.tsx
  // layout. Lazy-init so SSR/headless test environments don't choke.
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    setPortalEl(document.body);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Listen on the global toast bus. Filtering at the event level so any
  // malformed payload (missing message, wrong type) is dropped silently
  // — never crashes the host.
  useEffect(() => {
    function onToast(ev: Event) {
      const detail = (ev as CustomEvent<unknown>).detail;
      if (!isToastInput(detail)) return;
      const kind = normalizeKind((detail as { kind?: unknown }).kind);
      const explicit =
        typeof (detail as { durationMs?: unknown }).durationMs === "number"
          ? (detail as { durationMs: number }).durationMs
          : null;
      const durationMs = explicit ?? (kind === "error" ? 8000 : 5000);
      const toast: Toast = {
        id: nextId(),
        kind,
        message: detail.message,
        durationMs,
      };
      setToasts((prev) => [...prev, toast]);
    }
    window.addEventListener("lc:toast", onToast as EventListener);
    return () => window.removeEventListener("lc:toast", onToast as EventListener);
  }, []);

  // Each toast gets its own auto-dismiss timer. We attach the timers by
  // toast id so re-renders never reset a live countdown.
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      window.setTimeout(() => dismiss(t.id), t.durationMs),
    );
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [toasts, dismiss]);

  if (!portalEl || toasts.length === 0) return null;

  const stack = (
    <div
      // Stack pinned to bottom-right, above almost everything. z slightly
      // below the SidecarCrashOverlay (z-[300]) so a panic screen never
      // gets covered by a stale toast.
      className="pointer-events-none fixed bottom-4 right-4 z-[250] flex w-[min(360px,92vw)] flex-col gap-2"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .lc-toast-card {
            animation: lc-toast-in 240ms cubic-bezier(.34, 1.56, .64, 1);
          }
        }
        @keyframes lc-toast-in {
          from { opacity: 0; transform: translateY(8px) translateX(6px); }
          to   { opacity: 1; transform: translateY(0) translateX(0); }
        }
      `}</style>
    </div>
  );

  return createPortal(stack, portalEl);
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  // Per-kind accent. Stays inside the brand palette — fuchsia for the
  // happy path, a muted red for errors, fuchsia-deep for info. The card
  // structure (dark bg + bracketed corners + mono body) is identical
  // across kinds so the language reads as a single component.
  const eyebrow =
    toast.kind === "success"
      ? "ok"
      : toast.kind === "error"
      ? "error"
      : "note";
  const eyebrowColor =
    toast.kind === "error" ? "text-[#DC2626]" : "text-fuchsia-deep";

  return (
    <div
      className="lc-toast-card pointer-events-auto relative rounded-2xl bg-paper-elev/95 p-3 pr-9 shadow-[0_12px_40px_rgba(255,26,140,0.22)] backdrop-blur-md"
    >
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />

      <div
        className={`font-mono text-[10px] uppercase tracking-[0.14em] ${eyebrowColor}`}
      >
        {eyebrow}
      </div>
      <div className="mt-1 font-mono text-[12px] leading-snug text-ink">
        {toast.message}
      </div>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full border border-line bg-transparent text-text-tertiary transition-colors hover:border-fuchsia hover:text-fuchsia-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia/60"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}
