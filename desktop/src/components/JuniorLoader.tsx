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
          className="inline-grid h-[36px] w-[36px] place-items-center rounded-lg bg-fuchsia font-mono text-[18px] font-bold leading-none text-paper"
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
      {typeof percent === "number" && (
        <div className="h-[3px] w-full max-w-[520px] overflow-hidden rounded-full bg-line">
          <div
            className="h-full bg-fuchsia transition-[width] duration-200 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        </div>
      )}
    </div>
  );
}
