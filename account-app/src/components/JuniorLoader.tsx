"use client";

import { useEffect, useState } from "react";

// Liquid Clips whispers. Per spec §3.9 + §3.10 — past tense for done, plain verb for
// in-progress, no exclamation marks, no emoji, specifics over vibes. This is
// the loader you see between page transitions; it should never feel like a
// generic spinner.
//
// Each line types itself out at ~30ms/character, holds for ~600ms, fades.
// Total ceiling ~1.4s so it never out-stays its welcome on a fast route.

export function JuniorLoader({ message }: { message?: string }) {
  const line = message ?? "Reading your project";
  const [typed, setTyped] = useState("");

  useEffect(() => {
    let cancelled = false;
    let i = 0;
    const step = () => {
      if (cancelled) return;
      i += 1;
      setTyped(line.slice(0, i));
      if (i < line.length) {
        setTimeout(step, 28);
      }
    };
    setTimeout(step, 60);
    return () => {
      cancelled = true;
    };
  }, [line]);

  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center px-6">
      <div className="flex flex-col items-start gap-4">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
          junior
        </div>
        <div className="flex items-center gap-3">
          <span
            className="inline-grid h-[28px] w-[28px] place-items-center rounded-md bg-fuchsia font-mono text-[14px] font-bold leading-none text-paper"
            aria-hidden
          >
            /
          </span>
          <p className="font-mono text-[15px] leading-none text-ink sm:text-[16px]">
            {typed}
            <span className="blink ml-[2px] text-fuchsia">_</span>
          </p>
        </div>
      </div>
    </div>
  );
}
