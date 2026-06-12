// ───── IRON GATE IG-003 (v0.7.4) — see desktop/docs/IRON_GATES.md ─────
// Cinematic intro mount. Pairs with src/lib/intro.ts (one-shot + persist)
// and src/assets/intro/*.mp4. Don't remove the WebKit autoplay fallback,
// don't add auto-dismiss-after-Ns (we tried; killed the kicker frame),
// don't drop the localStorage dismiss. New intro variants go behind a flag.
//
// ship-lens v0.7.8: E8 — intro <video autoPlay> can be blocked by macOS WebKit autoplay rules; pre-fix the user saw 28.5s of black before the splash advanced. Now we detect the play() rejection, render a centered "Tap to play" overlay, and resume on click.
import { useEffect, useRef, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { openSmart as openExternal } from "../lib/openSmart";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Logo } from "./Logo";
import { MadeWithLiquidClips } from "./brand/MadeWithLiquidClips";
import { SplashGame } from "./invaders/SplashGame";
import { hasSeenIntro, markIntroSeen } from "../lib/intro";
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

// v0.7.54 — canonical Liquid Clips support inbox (mirrors marketing site).
const SUPPORT_EMAIL = "hello@liquidclips.app";

// Splash 3-stage flow (Daniel 2026-06-02):
//   1. intro    — Seedance cinematic 10s video, full-screen, skippable.
//                 First-launch only — flag persisted in localStorage so it
//                 doesn't replay every boot.
//   2. loading  — brand mark + loading bar, 5 seconds minimum.
//                 The "brand moment" — no game yet, just identity.
//   3. game     — SplashGame in paused state ("Press SPACE to play").
//                 Stays until BOTH ready=true AND continue clicked.
type SplashStage = "intro" | "loading" | "game";

const INTRO_DURATION_MS = 28_500;     // 28s intro + 0.5s buffer; video onEnded fires sooner if shorter
const LOADING_MIN_HOLD_MS = 5_000;    // brand moment

function firstStage(): SplashStage {
  return hasSeenIntro() ? "loading" : "intro";
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
  // v0.7.8 fix E8 — when macOS WebKit blocks the video's initial play() the
  // element stays at frame zero (black). We catch the rejection and flip
  // this to true so the user gets a clear "Tap to play" affordance. Click
  // calls play() inside the user-gesture context, which always succeeds.
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

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

  // v0.7.8 fix E8 — kick the play() promise once the <video> mounts. WebKit's
  // autoplay rules can deny `autoPlay` even with `muted` + `playsInline` in a
  // Tauri webview if the user hasn't yet interacted with the window (e.g.
  // first launch from Finder double-click). We catch the rejection and
  // surface a tap-to-play overlay instead of leaving 28.5s of black.
  useEffect(() => {
    if (stage !== "intro") return;
    const v = introVideoRef.current;
    if (!v) return;
    // The element starts with autoPlay enabled, so the browser already tried.
    // We piggyback on the resulting promise — if WebKit silently dropped it,
    // calling play() again from here gives us a real rejection to read.
    const p = v.play();
    if (p && typeof p.then === "function") {
      p.then(() => {
        // Worked — make sure the overlay isn't lingering from a prior mount.
        setAutoplayBlocked(false);
      }).catch(() => {
        // Rejected — almost certainly the autoplay-blocked path on WebKit.
        // The overlay handles the recovery (user click → play()).
        setAutoplayBlocked(true);
      });
    }
  }, [stage]);

  function tapToPlay() {
    const v = introVideoRef.current;
    if (!v) return;
    // Inside the click handler the user gesture is fresh, so play() resolves.
    const p = v.play();
    if (p && typeof p.then === "function") {
      p.then(() => setAutoplayBlocked(false)).catch(() => {
        // Still failed (rare — e.g. media decode error). Advance past the
        // intro so the user isn't trapped on a black screen forever.
        advanceFromIntro();
      });
    } else {
      setAutoplayBlocked(false);
    }
  }

  function advanceFromIntro() {
    markIntroSeen();
    setStage("loading");
  }

  function skipSplash() {
    if (stage === "intro") {
      advanceFromIntro();
      return;
    }
    if (stage === "loading" && !ready) {
      setStage("game");
      return;
    }
    onContinue?.();
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
              className="splash-bar-anim h-full bg-[var(--color-danger)] animate-[splash-bar_1.4s_ease-in-out_infinite]"
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
  // Black background, video full-screen, persistent skip button top-right.
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
          type="button"
          onClick={skipSplash}
          aria-label="Skip splash"
          className="absolute right-6 top-6 z-20 grid h-11 w-11 place-items-center rounded-full border border-fuchsia bg-paper/45 font-mono text-[14px] font-semibold text-paper shadow-[var(--glow-sm)] backdrop-blur-sm transition-all hover:bg-fuchsia hover:text-white focus:outline-none focus:ring-2 focus:ring-fuchsia focus:ring-offset-2 focus:ring-offset-black"
        >
          →
        </button>
        {/* v0.7.8 fix E8 — tap-to-play overlay. Only renders when the
            initial play() promise was rejected (autoplay-blocked). The
            backdrop sits above the video but below the skip button so
            users can still bypass the intro entirely if they prefer. */}
        {autoplayBlocked && (
          <button
            type="button"
            onClick={tapToPlay}
            aria-label="Tap to play intro"
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-paper/55 backdrop-blur-sm transition-colors hover:bg-paper/65 focus:outline-none focus:ring-2 focus:ring-fuchsia"
          >
            <span className="grid h-20 w-20 place-items-center rounded-full border border-fuchsia bg-paper/60 text-fuchsia shadow-[var(--glow-sm)]">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <polygon points="6 4 20 12 6 20 6 4" />
              </svg>
            </span>
            <span className="font-display text-[20px] font-semibold tracking-[-0.01em] text-paper">
              Tap to play
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper/70">
              your browser blocked autoplay
            </span>
          </button>
        )}
        <style>{splashStyle}</style>
      </div>
    );
  }

  return (
    <div
      className={`relative flex h-full w-full flex-col items-center justify-center gap-8 overflow-hidden ${
        stage === "game" ? "bg-ink" : "bg-paper"
      }`}
      style={
        stage === "game"
          ? { backgroundColor: "#0b0b10" }
          : { backgroundImage: `url(${splashArt})`, backgroundSize: "cover", backgroundPosition: "center" }
      }
    >
      {/* Stage-aware scrim — light translucent for loading (lets the splash
          art breathe through), dense near-black for gameplay so the fuchsia
          invaders pop instead of getting washed out by the paper-coloured art
          behind them. Daniel's "reduce background transparency during
          gameplay" finding — 25% black was nowhere near enough on the bright
          backdrop; 90% reads as a near-solid dark game arena. */}
      <div
        className={`pointer-events-none absolute inset-0 ${
          stage === "game" ? "bg-paper/90" : "bg-paper/25"
        }`}
      />

      <button
        type="button"
        onClick={skipSplash}
        aria-label="Skip splash"
        className="absolute right-6 top-6 z-20 grid h-11 w-11 place-items-center rounded-full border border-fuchsia bg-paper/45 font-mono text-[14px] font-semibold text-ink shadow-[var(--glow-sm)] backdrop-blur-sm transition-all hover:bg-fuchsia hover:text-white focus:outline-none focus:ring-2 focus:ring-fuchsia focus:ring-offset-2 focus:ring-offset-black"
      >
        →
      </button>

      <div className="splash-mark-anim relative z-10 animate-[splash-mark-in_0.6s_ease-out]">
        <Logo />
      </div>

      {/* Stage 2 (loading) = brand moment with loading bar.
          Stage 3 (game) = SplashGame in paused state with Continue button. */}
      {stage === "game" && onContinue ? (
        <SplashGame ready={ready} onContinue={onContinue} />
      ) : (
        <div className="relative z-10 flex w-[280px] flex-col items-center gap-4">
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-ink/20">
            <div
              className="splash-bar-anim h-full bg-fuchsia animate-[splash-bar_1.4s_ease-in-out_infinite]"
              style={{ width: "40%" }}
            />
          </div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper">
            {TICKS[i]}
          </p>
        </div>
      )}

      {/* v0.7.55 — "Made with Liquid Clips" attribution. Mounted on
          loading stage only so the gameplay arena stays clean. */}
      {stage === "loading" && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 z-10 -translate-x-1/2">
          <MadeWithLiquidClips className="h-10 w-[220px] opacity-90" loading="eager" />
        </div>
      )}

      <style>{splashStyle}</style>
    </div>
  );
}
