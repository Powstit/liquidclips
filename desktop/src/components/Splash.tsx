import { useEffect, useState } from "react";
import { Logo } from "./Logo";

// Shown while the sidecar is booting (ping + secretsStatus + whisper warmup).
// Without this the window is blank for 1-3s — looks like the app froze.
// Brand voice: terse, lower-case, monospace. Cycles status labels so the user
// sees something is happening even if individual steps complete instantly.
const TICKS = [
  "waking the engine",
  "checking the toolbox",
  "reading the room",
  "ready in a moment",
];

export function Splash({ failed = false }: { failed?: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (failed) return;
    const t = setInterval(() => setI((n) => (n + 1) % TICKS.length), 700);
    return () => clearInterval(t);
  }, [failed]);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-8 bg-paper">
      <Logo />
      <div className="flex w-[280px] flex-col items-center gap-4">
        <div className="h-[3px] w-full overflow-hidden rounded-full bg-line">
          <div
            className={`h-full ${failed ? "bg-[#DC2626]" : "bg-fuchsia"} animate-[splash-bar_1.4s_ease-in-out_infinite]`}
            style={{ width: failed ? "100%" : "40%" }}
          />
        </div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
          {failed ? "sidecar failed to start" : TICKS[i]}
        </p>
      </div>
      <style>{`
        @keyframes splash-bar {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(120%); }
          100% { transform: translateX(280%); }
        }
      `}</style>
    </div>
  );
}
