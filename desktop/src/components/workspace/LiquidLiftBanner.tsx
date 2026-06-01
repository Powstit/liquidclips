// Sub-brand cue (sprint #14c).
//
// The workspace IS Liquid Lift — the clipping engine inside the broader
// Liquid Clips ecosystem (community + campaigns + doctrine). Brand split
// stays purely visual: no bundle ID change, no domain change, just a
// subtle banner so users feel the sub-brand without confusion.
//
// Mounted near the top of the workspace by App.tsx. Auto-dismisses after
// first dismissal (localStorage flag) so it doesn't nag returning users.

import { useEffect, useState } from "react";
import { X, Zap } from "lucide-react";

const DISMISS_KEY = "liquidlift:banner:dismissed:v1";

export function LiquidLiftBanner() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  if (dismissed) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  return (
    <div className="mx-auto mb-3 flex w-full max-w-3xl items-center gap-3 rounded-2xl border border-fuchsia/40 bg-gradient-to-r from-fuchsia-soft/30 via-paper to-paper px-4 py-2.5 shadow-[var(--glow-sm)]">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-fuchsia text-paper">
        <Zap size={14} strokeWidth={2.5} />
      </span>
      <div className="flex-1 leading-tight">
        <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          you're using
        </p>
        <p className="font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">
          Liquid Lift <span className="text-text-tertiary">— the clipping engine inside Liquid Clips</span>
        </p>
      </div>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="grid h-7 w-7 place-items-center rounded-full text-text-tertiary transition-colors hover:bg-paper-elev hover:text-ink"
      >
        <X size={14} />
      </button>
    </div>
  );
}
