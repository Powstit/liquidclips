import { useEffect, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Logo } from "./Logo";
import { SplashGame } from "./invaders/SplashGame";
import splashArt from "../assets/brand/splash.jpg";

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

export function Splash({
  failed = false,
  ready = false,
  onContinue,
}: {
  failed?: boolean;
  // True once App.tsx says the sidecar booted and bootChecked is set.
  // SplashGame uses this to enable the Continue button.
  ready?: boolean;
  // Required when the embedded game is shown. Parent flips its
  // splashAcked state so the splash unmounts.
  onContinue?: () => void;
}) {
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
      `Liquid Clips sidecar failed to start\n` +
      `Time: ${new Date().toISOString()}\n` +
      `User agent: ${ua}\n` +
      `Logs folder: ~/LiquidClips/projects/<slug>/.progress.json (per run)\n` +
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
    const subject = encodeURIComponent("Liquid Clips — sidecar failed to start");
    void openExternal(`mailto:${SUPPORT_EMAIL}?subject=${subject}`).catch(() => undefined);
  }

  const splashStyle = `
    @keyframes splash-bar {
      0%   { transform: translateX(-100%); }
      50%  { transform: translateX(120%); }
      100% { transform: translateX(280%); }
    }
    @keyframes splash-mark-in {
      0%   { opacity: 0; transform: scale(0.94); }
      100% { opacity: 1; transform: scale(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      .splash-bar-anim, .splash-mark-anim { animation: none !important; }
    }
  `;

  if (failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-8 bg-paper">
        <Logo />
        <div className="flex w-[280px] flex-col items-center gap-4">
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-line">
            <div
              className="splash-bar-anim h-full bg-[#DC2626] animate-[splash-bar_1.4s_ease-in-out_infinite]"
              style={{ width: "100%" }}
            />
          </div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
            sidecar failed to start
          </p>
        </div>

        <div className="flex max-w-[520px] flex-col items-center gap-4 px-6 text-center">
          <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
            The Python sidecar didn't come up. First-launch unpacking can take a
            few seconds — give it one restart before opening a ticket.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => void onRestart()}
              className="rounded-full bg-fuchsia px-5 py-2 font-sans text-[13px] font-medium text-white hover:bg-fuchsia-bright"
            >
              Restart Liquid Clips
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

        <style>{splashStyle}</style>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full w-full flex-col items-center justify-center gap-8 overflow-hidden bg-paper"
      style={{ backgroundImage: `url(${splashArt})`, backgroundSize: "cover", backgroundPosition: "center" }}
    >
      {/* Soft scrim so the light mark + text stay legible over the art. */}
      <div className="pointer-events-none absolute inset-0 bg-black/25" />

      <div className="splash-mark-anim relative z-10 animate-[splash-mark-in_0.6s_ease-out]">
        <Logo />
      </div>

      {/* Pink Invaders inline during boot. Daniel's call: purposefully hold
          the splash for ≥8s so the user gets one shot at the high-score
          dopamine hit while the sidecar warms up. Continue button enables
          when sidecar is ready AND minimum hold has elapsed; Skip is always
          available for power users. */}
      {onContinue ? (
        <SplashGame ready={ready} onContinue={onContinue} />
      ) : (
        <div className="relative z-10 flex w-[280px] flex-col items-center gap-4">
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-paper/20">
            <div
              className="splash-bar-anim h-full bg-paper animate-[splash-bar_1.4s_ease-in-out_infinite]"
              style={{ width: "40%" }}
            />
          </div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper/80">
            {TICKS[i]}
          </p>
        </div>
      )}

      <style>{splashStyle}</style>
    </div>
  );
}
