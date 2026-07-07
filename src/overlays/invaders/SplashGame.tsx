// SplashGame — embedded Invaders for the app boot splash.
//
// Reuses the same canvas engine as InvadersOverlay but without the modal
// chrome. Renders inline inside Splash.tsx so the user gets a dopamine hit
// during the sidecar boot. A "Continue →" CTA reveals itself once the
// parent says sidecar is ready AND a minimum hold time has elapsed (so
// fast boots still leave room for one round of play).
//
// New high-score notice fires in real time during gameplay — that's the
// dopamine moment Daniel asked for. "I just beat my best in the loader."

import { useCallback, useEffect, useRef, useState } from "react";
import { getHighScore, setHighScore } from "../../lib/invaders/highScore";
import { initGame, reset, step, type GameState, type Input } from "../../lib/invaders/engine";
import { submitArcadeScore } from "../../lib/chat";
import { InvadersCanvas } from "./InvadersCanvas";
import { BossWave } from "./BossWave";

const MIN_HOLD_MS = 8_000;

export function SplashGame({
  ready,
  onContinue,
  onStateChange,
}: {
  // True once the parent (App.tsx) considers the app ready — i.e. sidecar
  // booted and bootChecked is set. SplashGame keeps the splash open until
  // BOTH ready === true AND the minimum hold time has elapsed.
  ready: boolean;
  onContinue: () => void;
  /** v0.7.67 — emit live score/lives/wave to parent so HUD chrome
   *  (SplashHud · SplashLeaderboard · BossWave) can mirror the engine
   *  state without re-implementing it. */
  onStateChange?: (s: { score: number; lives: number; wave: number }) => void;
}) {
  const [state, setState] = useState<GameState | null>(null);
  const [highScore, setHighScoreState] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [minHoldDone, setMinHoldDone] = useState(false);
  // 2026-06-24 · level-up + achievement triggers (final-demo §5 + §6)
  const [levelUpFrom, setLevelUpFrom] = useState<number | null>(null);
  const [achievement, setAchievement] = useState<{ eb: string; title: string; sub: string } | null>(null);
  const lastWaveRef = useRef(1);
  const milestonesHitRef = useRef<Set<number>>(new Set());
  // Daniel's call (2026-06-01): game starts PAUSED — invaders sit still,
  // ship sits still, "Press SPACE to play" overlay shows. First spacebar
  // press starts the game (Chrome dino pattern). Subsequent spacebar
  // presses act as the fire input as usual.
  const [started, setStarted] = useState(false);
  const inputRef = useRef<Input>({ left: false, right: false, fire: false });
  const firePrevRef = useRef(false);
  const savedRef = useRef(false);

  // Init game + load high score once on mount.
  useEffect(() => {
    setState(initGame(480, 320));
    getHighScore().then(setHighScoreState).catch(() => setHighScoreState(0));
    const t = window.setTimeout(() => setMinHoldDone(true), MIN_HOLD_MS);
    return () => window.clearTimeout(t);
  }, []);

  // Keyboard — same edge-triggered fire pattern as InvadersOverlay.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        e.preventDefault();
        inputRef.current.left = true;
      } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        e.preventDefault();
        inputRef.current.right = true;
      } else if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        // First spacebar starts the game (Chrome dino pattern). After that,
        // spacebar fires as normal.
        if (!started) {
          setStarted(true);
          return;
        }
        if (!firePrevRef.current) {
          inputRef.current.fire = true;
          firePrevRef.current = true;
        }
      } else if (e.key === "Enter" && ready && minHoldDone) {
        // Enter dismisses the splash once the Continue button is live.
        onContinue();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        inputRef.current.left = false;
      } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        inputRef.current.right = false;
      } else if (e.key === " " || e.key === "Spacebar") {
        firePrevRef.current = false;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [ready, minHoldDone, onContinue, started]);

  const onStep = useCallback(
    (dtMs: number) => {
      // Paused state — game frozen until user presses SPACE for the first
      // time. Render the initial scene unchanged.
      if (!started) return;
      setState((prev) => {
        if (!prev || prev.status !== "playing") return prev;
        const input = { ...inputRef.current };
        inputRef.current.fire = false;
        const next = step(prev, dtMs, input);
        // Realtime high-score detection — fires as the user PASSES the prior
        // best, not when the game ends. That's the moment of dopamine.
        if (highScore > 0 && next.score > highScore && !newBest) {
          setNewBest(true);
        }
        if (next.status === "game-over" && !savedRef.current) {
          savedRef.current = true;
          if (next.score > highScore) {
            setHighScoreState(next.score);
            void setHighScore(next.score);
          }
          // C · gameplay upgrade #1 · splash surface ratchets score to
          // server too. Previously only InvadersOverlay called this, so
          // splash plays never entered the leaderboard — which meant the
          // $1,000 prize copy on ArcadePanel was fed a leaderboard nobody
          // was actually competing on. submitArcadeScore is best-effort
          // and JWT-gated; silently no-ops for anon splash sessions.
          void submitArcadeScore(next.score);
        }
        // v0.7.67 — broadcast live state to parent HUD chrome.
        // C.6 · wave propagates to SplashHud so it can render the named
        // difficulty tier (RECRUIT → LEGENDARY) instead of a raw number.
        onStateChange?.({ score: next.score, lives: next.lives, wave: next.wave });

        // 2026-06-24 · level-up card on wave change.
        if (next.wave !== lastWaveRef.current && next.status === "playing") {
          setLevelUpFrom(prev.score);
          window.setTimeout(() => setLevelUpFrom(null), 2_400);
          lastWaveRef.current = next.wave;
        }

        // 2026-06-24 · achievement triggers on score thresholds.
        const MILESTONES: Array<{ score: number; eb: string; title: string; sub: string }> = [
          { score: 5_000,  eb: "First milestone",     title: "5,000 points",  sub: "You broke through · keep clipping" },
          { score: 10_000, eb: "Achievement unlocked", title: "10,000 points", sub: "Lieutenant rank · next badge at 25,000" },
          { score: 25_000, eb: "Achievement unlocked", title: "25,000 points", sub: "Commander rank · top 5% of clippers" },
          { score: 50_000, eb: "Achievement unlocked", title: "50,000 points", sub: "General rank · save your score" },
        ];
        for (const m of MILESTONES) {
          if (next.score >= m.score && !milestonesHitRef.current.has(m.score)) {
            milestonesHitRef.current.add(m.score);
            setAchievement({ eb: m.eb, title: m.title, sub: m.sub });
            window.setTimeout(() => setAchievement(null), 3_400);
            break;
          }
        }

        return next;
      });
    },
    [highScore, newBest, started, onStateChange],
  );

  function handleReplay() {
    setState((prev) => {
      if (!prev) return prev;
      savedRef.current = false;
      setNewBest(false);
      // 2026-06-24 · reset milestone tracking on replay so achievements
      // can fire again in the new game.
      milestonesHitRef.current = new Set();
      lastWaveRef.current = 1;
      setLevelUpFrom(null);
      setAchievement(null);
      inputRef.current = { left: false, right: false, fire: false };
      firePrevRef.current = false;
      return reset(prev);
    });
  }

  if (!state) return null;

  const continueLive = ready && minHoldDone;
  const score = state.score;
  const best = Math.max(highScore, score);

  return (
    <div className="relative z-10 flex flex-col items-center gap-4">
      {/* Score / best / new-best banner */}
      <div className="flex items-center gap-4 font-mono text-[11px] uppercase tracking-[var(--tracking-eyebrow)] text-ink">
        <span className="tabular-nums">SCORE {score}</span>
        <span className="opacity-60">·</span>
        <span className="tabular-nums">BEST {best}</span>
        {newBest && (
          <span className="rounded-full border border-fuchsia bg-fuchsia px-2 py-0.5 text-[10px] font-sans font-medium uppercase tracking-[var(--tracking-eyebrow)] text-white shadow-[var(--glow-md)] animate-pulse">
            new best!
          </span>
        )}
      </div>

      <div className="relative rounded-xl p-2">
        {/* Boss-wave overlay — visual flair every 3rd wave. Pure JSX
            absolute-positioned above the canvas; engine collision still
            happens with the pixel-grid invaders below. */}
        <BossWave wave={state.wave} />
        <InvadersCanvas state={state} onStep={onStep} width={480} height={320} paused={!started} />

        {/* Paused-state overlay — Chrome dinosaur pattern. Game waits here
            until the user presses SPACE for the first time. The animate-pulse
            on the keycap makes the prompt feel alive without being noisy. */}
        {!started && state.status === "playing" && (
          <div className="absolute inset-2 flex flex-col items-center justify-center gap-3 rounded-xl">
            <span className="font-sans text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-ink/70">
              ready
            </span>
            <div className="flex items-center gap-2 font-sans text-[12px] uppercase tracking-[var(--tracking-eyebrow)] text-ink">
              press
              <kbd className="inline-grid h-7 min-w-[64px] place-items-center rounded-md border border-ink/40 bg-ink/10 px-3 font-mono text-[11px] font-medium text-ink animate-pulse">
                space
              </kbd>
              to play
            </div>
          </div>
        )}

        {state.status === "game-over" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-paper/85 backdrop-blur-sm">
            <span className="font-display text-[14px] uppercase tracking-[var(--tracking-eyebrow)] text-ink">
              {newBest ? "new best · " : ""}game over
            </span>
            <button
              onClick={handleReplay}
              className="rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[12px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)] active:scale-[0.98]"
            >
              Play again ▶
            </button>
          </div>
        )}

        {/* 2026-06-24 · level-up card · between waves · auto-dismiss 2.4s */}
        {levelUpFrom !== null && state.status === "playing" && (
          <div
            className="absolute inset-x-4 top-4 z-20 rounded-xl border border-fuchsia bg-paper/95 px-4 py-3 backdrop-blur-md shadow-[0_0_30px_rgba(255,26,140,0.30)]"
            data-testid="splash-level-up"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-fuchsia">
                  Wave clear
                </span>
                <span className="font-display text-[13px] font-semibold text-ink">
                  Wave {state.wave} inbound · speed +12%
                </span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[12px] tabular-nums">
                {/* P0 contrast fix 2026-07-04 · was text-ink/60 (near-black
                    on near-black paper bg) · 1:1 contrast, literally invisible.
                    Swapped to text-ink/60 (cream on paper) for readable AA. */}
                <span className="text-ink/60">{levelUpFrom.toLocaleString()}</span>
                <span className="text-fuchsia">→</span>
                <span className="font-semibold text-fuchsia">{state.score.toLocaleString()}</span>
              </div>
            </div>
          </div>
        )}

        {/* 2026-06-24 · achievement badge · fires on score threshold cross */}
        {achievement && (
          <div
            className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-amber-400/60 bg-paper/95 px-6 py-5 text-center shadow-[0_0_40px_rgba(255,209,90,0.30)] backdrop-blur-md"
            data-testid="splash-achievement"
            style={{ borderColor: "rgba(255,209,90,0.55)" }}
          >
            <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full" style={{ background: "radial-gradient(circle at 30% 30%, #FFE48F, #FFD15A 70%, #B8830A)", boxShadow: "0 0 24px rgba(255,209,90,0.45)" }}>
              <span style={{ fontSize: 22 }}>🏆</span>
            </div>
            <div className="font-mono text-[9px] uppercase tracking-[var(--tracking-eyebrow)]" style={{ color: "#FFD15A" }}>
              {achievement.eb}
            </div>
            <div className="mt-1 font-display text-[14px] font-bold text-ink">
              {achievement.title}
            </div>
            <div className="mt-1 max-w-[220px] font-sans text-[11px] text-ink/70">
              {achievement.sub}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-ink/60">
        ← → move · space fire
      </div>

      {/* Continue gate. Hidden until the parent says ready AND the minimum
          hold has elapsed. The global Splash skip control now lives top-right
          across every splash phase, so this area only exposes the ready CTA. */}
      <button
        type="button"
        onClick={onContinue}
        disabled={!continueLive}
        data-testid="intro-splash-continue"
        className={`rounded-full px-6 py-2.5 font-sans text-[14px] font-semibold transition-all ${
          continueLive
            ? "bg-fuchsia text-white shadow-[var(--glow-md)] hover:bg-fuchsia-bright hover:shadow-[var(--glow-lg)] animate-pulse"
            : "border border-white/40 bg-black/40 text-white/60 backdrop-blur-sm cursor-wait"
        }`}
      >
        {continueLive ? (newBest ? "New record! Continue →" : "Continue →") : "loading…"}
      </button>
    </div>
  );
}
