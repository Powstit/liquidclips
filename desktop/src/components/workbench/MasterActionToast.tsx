// Master-action result toast.
//
// Slides in from the top after fanOut returns. Two presentations:
//   1. clean success ("Applied to 12 of 12 windows") — auto-dismisses in 5s
//   2. partial / total failure — sticky until the user dismisses or retries
//
// The retry button re-runs fanOut over ONLY the failed window ids; the
// caller passes a `retry` callback so this component stays dumb about
// which action it was. Selection in the store persists, so a user who
// hit "Apply caption style" on 24 windows and lost 6 to bad RPCs can
// click Retry without re-selecting.
//
// USER JOURNEY · MasterActionToast
//   ENABLES — user sees the outcome of a master action without staring
//             at a silent toolbar; partial failures are recoverable in
//             one click instead of re-doing the whole selection.
//   PREVENTS — silent partial failures (the prior path swallowed
//              rejections inside Promise.allSettled); permanent stuck
//              toast (auto-dismiss on full success).
//   BREAKS — none — additive top-of-canvas surface.
//   STRANDS — none: error toasts have an explicit Dismiss button, the
//             Retry button is disabled while a retry is in flight, and
//             the unmount path clears any pending auto-dismiss timer.

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, X } from "lucide-react";
import type { MasterActionResult } from "./types";

type Props = {
  /** The latest result. Pass `null` to hide. The toast keys off the
   *  result identity, so passing a new object reopens it. */
  result: MasterActionResult | null;
  /** Total selection size at the time the action fired — used so the
   *  toast can show "Applied to K of N" even when K === N. */
  total: number;
  /** Short label of the action just performed, e.g. "Apply caption style".
   *  Plain English; the toast capitalises the first letter. */
  actionLabel: string;
  /** Called when the user clicks Retry. Should return a fresh result
   *  by re-running fanOut on the failed ids. The toast updates itself
   *  when this resolves so the user sees retry outcomes in-line. */
  onRetry?: (failedIds: string[]) => Promise<MasterActionResult>;
  /** Called when the user dismisses, or when the auto-dismiss timer
   *  fires on a clean success. */
  onDismiss: () => void;
};

export function MasterActionToast({
  result,
  total,
  actionLabel,
  onRetry,
  onDismiss,
}: Props) {
  // Local mirror of `result` so Retry can update the toast in place
  // without forcing the parent to re-pump the prop.
  const [view, setView] = useState<MasterActionResult | null>(result);
  const [retrying, setRetrying] = useState(false);
  const dismissTimer = useRef<number | null>(null);

  // Reset local mirror whenever the parent passes a new result.
  useEffect(() => {
    setView(result);
  }, [result]);

  // Auto-dismiss on clean success, sticky on failure. The timer is
  // tracked in a ref so unmount or a new result can clear it before it
  // fires — prevents the toast from "popping shut" mid-retry.
  useEffect(() => {
    if (dismissTimer.current !== null) {
      window.clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    if (!view) return;
    if (view.failed.length === 0) {
      dismissTimer.current = window.setTimeout(() => {
        dismissTimer.current = null;
        onDismiss();
      }, 5000);
    }
    return () => {
      if (dismissTimer.current !== null) {
        window.clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
    };
  }, [view, onDismiss]);

  if (!view) return null;

  const okCount = view.ok.length;
  const failedCount = view.failed.length;
  const hasFailures = failedCount > 0;
  const hadAnySuccess = okCount > 0;

  async function handleRetry() {
    if (!onRetry || retrying || !view) return;
    setRetrying(true);
    try {
      const next = await onRetry(view.failed.map((f) => f.id));
      setView(next);
    } catch (e) {
      // Replace the result with an error-only view so the user gets
      // visible feedback instead of a silently-stuck retry button.
      setView({
        ok: [],
        failed: view.failed.map((f) => ({
          ...f,
          reason: e instanceof Error ? e.message.slice(0, 140) : "retry failed",
        })),
      });
    } finally {
      setRetrying(false);
    }
  }

  // First failure's reason makes a useful single-line summary; the rest
  // get a "+N more" tail so the toast never grows to half the screen.
  const firstReason = view.failed[0]?.reason ?? "";
  const extraFailures = Math.max(0, failedCount - 1);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center px-4"
    >
      <div
        className={
          hasFailures
            ? "pointer-events-auto flex max-w-2xl items-start gap-3 rounded-2xl border border-[#DC2626]/40 bg-paper-warm/95 px-4 py-3 shadow-[0_18px_44px_rgba(11,11,16,0.35)] backdrop-blur"
            : "pointer-events-auto flex max-w-2xl items-start gap-3 rounded-2xl border border-fuchsia/40 bg-paper-warm/95 px-4 py-3 shadow-[0_18px_44px_rgba(11,11,16,0.35)] backdrop-blur"
        }
      >
        <div className="mt-0.5 shrink-0">
          {hasFailures ? (
            <AlertCircle className="h-4 w-4 text-[#DC2626]" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-fuchsia" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
            {actionLabel}
          </p>
          <p className="mt-0.5 font-sans text-[13px] text-ink">
            {hadAnySuccess ? (
              <>
                Applied to <span className="font-semibold">{okCount}</span> of{" "}
                <span className="font-semibold">{total}</span>
                {hasFailures ? "." : ""}
              </>
            ) : (
              <>
                <span className="font-semibold">{failedCount}</span> of{" "}
                <span className="font-semibold">{total}</span> failed.
              </>
            )}
            {hasFailures ? (
              <>
                {" "}
                <span className="text-[#DC2626]">
                  {failedCount} failed
                  {extraFailures > 0
                    ? ` — ${firstReason} (+${extraFailures} more)`
                    : firstReason
                      ? ` — ${firstReason}`
                      : "."}
                </span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {hasFailures && onRetry ? (
            <button
              type="button"
              onClick={() => void handleRetry()}
              disabled={retrying}
              className="inline-flex items-center gap-1 rounded-full border border-fuchsia/40 bg-paper px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia hover:bg-fuchsia/10 disabled:opacity-50"
            >
              {retrying ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> retrying
                </>
              ) : (
                <>
                  <RefreshCw className="h-3 w-3" /> Retry failed
                </>
              )}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="rounded-full p-1 text-text-tertiary hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
