import { useEffect, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
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

const SUPPORT_EMAIL = "support@jnremployee.com";

export function Splash({ failed = false }: { failed?: boolean }) {
  const [i, setI] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (failed) return;
    const t = setInterval(() => setI((n) => (n + 1) % TICKS.length), 700);
    return () => clearInterval(t);
  }, [failed]);

  async function onRestart() {
    try {
      await relaunch();
    } catch {
      /* if relaunch is blocked we let the user quit manually */
    }
  }

  async function onCopyDiagnostic() {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "n/a";
    const dump =
      `Junior sidecar failed to start\n` +
      `Time: ${new Date().toISOString()}\n` +
      `User agent: ${ua}\n` +
      `Logs folder: ~/Junior/projects/<slug>/.progress.json (per run)\n` +
      `Common cause: Python sidecar missing dependencies or model files. ` +
      `If you installed the .app fresh, try reopening once more — first launch ` +
      `extracts bundled resources and can take a few seconds.`;
    try {
      await writeText(dump);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* silent */
    }
  }

  function onEmail() {
    const subject = encodeURIComponent("Junior — sidecar failed to start");
    void openExternal(`mailto:${SUPPORT_EMAIL}?subject=${subject}`).catch(() => undefined);
  }

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

      {failed && (
        <div className="flex max-w-[520px] flex-col items-center gap-4 px-6 text-center">
          <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
            The Python sidecar didn't come up. First-launch unpacking can take a
            few seconds — give it one restart before opening a ticket.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => void onRestart()}
              className="rounded-full bg-ink px-5 py-2 font-sans text-[13px] font-medium text-paper hover:bg-fuchsia"
            >
              Restart Junior
            </button>
            <button
              onClick={() => void onCopyDiagnostic()}
              className="rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] font-medium text-ink hover:border-fuchsia"
            >
              {copied ? "Copied ✓" : "Copy diagnostic"}
            </button>
            <button
              onClick={onEmail}
              className="rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] font-medium text-ink hover:border-fuchsia"
            >
              Email support →
            </button>
          </div>
        </div>
      )}

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
