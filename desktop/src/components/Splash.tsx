import { useEffect, useRef, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Logo } from "./Logo";
import { SplashGame } from "./invaders/SplashGame";
// 2026-06-03 v0.5.0 — Ready Player One redesign:
// closing-still.png is the bookend frame from the 28s Kade-in-OASIS intro,
// Kade with five fuchsia coins orbiting around him. Using it as the splash
// backdrop means the intro video's final beat morphs seamlessly into the
// static splash, so the cinematic moment never breaks.
import splashArt from "../assets/intro/closing-still.png";
import introVideo from "../assets/intro/intro.mp4";

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

// Splash 3-stage flow (Daniel 2026-06-02):
//   1. intro    — Seedance cinematic 10s video, full-screen, skippable.
//                 First-launch only — flag persisted in localStorage so it
//                 doesn't replay every boot.
//   2. loading  — brand mark + loading bar, 5 seconds minimum.
//                 The "brand moment" — no game yet, just identity.
//   3. game     — SplashGame in paused state ("Press SPACE to play").
//                 Stays until BOTH ready=true AND continue clicked.
type SplashStage = "intro" | "loading" | "game";

// 2026-06-03 v0.5.0 — intro is now the 28s Kade-in-OASIS cinematic.
// Bumped the key so existing v0.4.53 installs replay the new intro once.
const INTRO_SEEN_KEY = "liquidclips:intro-seen:v2";
const INTRO_DURATION_MS = 28_500;     // 28s intro + 0.5s buffer; video onEnded fires sooner if shorter
const LOADING_MIN_HOLD_MS = 5_000;    // brand moment

function firstStage(): SplashStage {
  try {
    return localStorage.getItem(INTRO_SEEN_KEY) === "1" ? "loading" : "intro";
  } catch {
    return "loading";
  }
}

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
  const [stage, setStage] = useState<SplashStage>(() => firstStage());
  const introVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (failed) return;
    const t = setInterval(() => setI((n) => (n + 1) % TICKS.length), 700);
    return () => clearInterval(t);
  }, [failed]);

  // Stage advance: intro → loading → game
  useEffect(() => {
    if (failed) return;
    if (stage === "intro") {
      const t = window.setTimeout(() => advanceFromIntro(), INTRO_DURATION_MS);
      return () => window.clearTimeout(t);
    }
    if (stage === "loading") {
      const t = window.setTimeout(() => setStage("game"), LOADING_MIN_HOLD_MS);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [stage, failed]);

  function advanceFromIntro() {
    try { localStorage.setItem(INTRO_SEEN_KEY, "1"); } catch { /* sandboxed */ }
    setStage("loading");
  }

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
              className="rounded-full border border-line bg-transparent px-4 py-2 font-sans text-[13px] font-medium text-ink hover:border-fuchsia"
            >
              {copied ? "Copied ✓" : "Copy diagnostic"}
            </button>
            <button
              onClick={onEmail}
              className="rounded-full border border-line bg-transparent px-4 py-2 font-sans text-[13px] font-medium text-ink hover:border-fuchsia"
            >
              Email support →
            </button>
          </div>
        </div>

        <style>{splashStyle}</style>
      </div>
    );
  }

  // Stage 1 — cinematic intro (Seedance-generated). First-launch only.
  // Black background, video full-screen, skip button bottom-right.
  if (stage === "intro") {
    return (
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black">
        <video
          ref={introVideoRef}
          src={introVideo}
          autoPlay
          muted
          playsInline
          onEnded={advanceFromIntro}
          className="h-full w-full object-cover"
        />
        <button
          onClick={advanceFromIntro}
          className="absolute bottom-6 right-6 rounded-full border border-paper/40 bg-black/40 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-paper/80 backdrop-blur-sm hover:border-paper hover:text-paper"
        >
          Skip →
        </button>
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

      {/* Stage 2 (loading) = brand moment with loading bar.
          Stage 3 (game) = SplashGame in paused state with Continue button. */}
      {stage === "game" && onContinue ? (
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
