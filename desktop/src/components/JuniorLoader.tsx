import { useEffect, useState } from "react";

// Brand-voice typing loader. Per spec §3.9 — first-person past tense for done,
// plain-verb for in-progress, no exclamation, specifics over vibes. Used
// during the URL fetch (between paste and pipeline start) and any other
// "no visible work happening but lots is happening" moment.

export function JuniorLoader({
  message,
  detail,
  percent,
}: {
  message: string;
  detail?: string;
  percent?: number;
}) {
  const [typed, setTyped] = useState("");

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

  return (
    <div className="flex w-full max-w-[680px] flex-col items-start gap-6">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        junior
      </div>
      <div className="flex items-center gap-3">
        <span
          className="inline-grid h-[36px] w-[36px] place-items-center rounded-lg bg-fuchsia font-mono text-[18px] font-bold leading-none text-white"
          aria-hidden
        >
          /
        </span>
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
      {typeof percent === "number" ? (
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
    </div>
  );
}
