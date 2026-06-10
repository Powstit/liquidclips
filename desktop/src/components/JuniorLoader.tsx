import { useEffect, useRef, useState } from "react";
import { InvadersTrigger } from "./invaders/InvadersTrigger";
import { LiquidInvaderLoader } from "./LiquidInvaderLoader";

// Brand-voice typing loader. Per spec §3.9 — first-person past tense for done,
// plain-verb for in-progress, no exclamation, specifics over vibes. Used
// during the URL fetch (between paste and pipeline start) and any other
// "no visible work happening but lots is happening" moment.

export function JuniorLoader({
  message,
  detail,
  percent,
  downloadedBytes,
  onCancel,
  onRetry,
}: {
  message: string;
  detail?: string;
  percent?: number;
  // R2 — stall detection. Raw bytes from the download progress event so we
  // can tell "still making progress" from "stuck at the same byte count".
  downloadedBytes?: number;
  // P1 #5 — surface a Cancel button on the download stage too (lift already
  // had one). When provided, renders a small Cancel pill next to the trigger
  // so a 4-hour throttled download is actually escapable from the UI.
  onCancel?: () => void;
  // R2 — retry affordance when the download stalls. Wired to the same
  // runPipelineFromUrl path that the ingest-failed retry uses.
  onRetry?: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [stalled, setStalled] = useState(false);
  const bytesRef = useRef(downloadedBytes);
  const changeTimeRef = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    let i = 0;
    setTyped("");
    const step = () => {
      if (cancelled) return;
      i += 1;
      setTyped(message.slice(0, i));
      if (i < message.length) {
        setTimeout(step, 28);
      }
    };
    setTimeout(step, 60);
    return () => {
      cancelled = true;
    };
  }, [message]);

  // R2 — stall detection. Track bytes over a rolling 60-second window.
  // When bytes change, reset the stall timer. When they stay flat for 60s,
  // flip stalled → true. The interval ticks every second; refs keep the
  // closure fresh without re-triggering the effect on every byte update.
  useEffect(() => {
    if (downloadedBytes !== bytesRef.current) {
      bytesRef.current = downloadedBytes;
      changeTimeRef.current = Date.now();
      setStalled(false);
    }
  }, [downloadedBytes]);

  useEffect(() => {
    if (downloadedBytes === undefined) return;
    const id = window.setInterval(() => {
      if (bytesRef.current === undefined) return;
      if (Date.now() - changeTimeRef.current > 60000) {
        setStalled(true);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [downloadedBytes !== undefined]);

  return (
    <div className="flex w-full max-w-[680px] flex-col items-start gap-6">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        liquid clips
      </div>
      <div className="flex items-center gap-3">
        {/* Liquid Invader — pink fuchsia liquid fills the pixel bug bottom-up
            in a 1.8s loop. Brand signature for "we heard you, hang on" moments.
            Replaces the static "/" badge so the loading state has a live pulse
            the user can latch onto from the first frame. */}
        <LiquidInvaderLoader size={36} />
        <p className="font-mono text-[16px] leading-none text-ink">
          {typed}
          <span className="blink ml-[2px] text-fuchsia">_</span>
        </p>
      </div>
      {detail && (
        <p className="max-w-[520px] whitespace-pre-line font-mono text-[12px] leading-relaxed text-text-tertiary">
          {detail}
        </p>
      )}
      {stalled ? (
        // R2 — stall affordance. Replaces the progress bar when bytes haven't
        // moved for 60 consecutive seconds.
        <div className="flex w-full max-w-[520px] flex-col gap-3 rounded-xl border border-fuchsia-deep/40 bg-fuchsia-deep/5 px-4 py-3">
          <p className="font-sans text-[13px] font-medium text-fuchsia-deep">
            Download seems stuck — try again, or cancel.
          </p>
          <div className="flex items-center gap-2">
            {onRetry && (
              <button
                onClick={onRetry}
                className="rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[12px] font-medium text-white hover:bg-fuchsia-bright"
              >
                Retry
              </button>
            )}
            {onCancel && (
              <button
                onClick={onCancel}
                className="rounded-full border border-line bg-transparent px-4 py-1.5 font-sans text-[12px] font-medium text-text-secondary hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : typeof percent === "number" ? (
        <div className="flex w-full max-w-[520px] flex-col gap-1.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper-elev/60">
            <div
              className="h-full rounded-full transition-[width] duration-200 ease-out"
              style={{
                width: `${Math.min(100, Math.max(0, percent))}%`,
                background: "var(--grad-fuchsia)",
                boxShadow: "var(--glow-sm)",
              }}
            />
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-fuchsia-deep">
            {Math.round(Math.min(100, Math.max(0, percent)))}%
          </span>
        </div>
      ) : (
        // Indeterminate state — show the shimmer so the user sees motion
        // even when the sidecar can't emit a measurable percent.
        <div className="h-1.5 w-full max-w-[520px] overflow-hidden rounded-full bg-paper-elev/60">
          <div className="working-stage-shimmer h-full w-1/3 rounded-full" />
        </div>
      )}
      {!stalled && (
        <div className="flex items-center gap-3">
          <InvadersTrigger />
          {onCancel && (
            <button
              onClick={onCancel}
              className="rounded-full border border-line bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-secondary hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
            >
              cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
