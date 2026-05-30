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
import { InvadersCanvas } from "./InvadersCanvas";

const MIN_HOLD_MS = 8_000;

export function SplashGame({
  ready,
  onContinue,
}: {
  // True once the parent (App.tsx) considers the app ready — i.e. sidecar
  // booted and bootChecked is set. SplashGame keeps the splash open until
  // BOTH ready === true AND the minimum hold time has elapsed.
  ready: boolean;
  onContinue: () => void;
}) {
  const [state, setState] = useState<GameState | null>(null);
  const [highScore, setHighScoreState] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [minHoldDone, setMinHoldDone] = useState(false);
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
  }, [ready, minHoldDone, onContinue]);

  const onStep = useCallback(
    (dtMs: number) => {
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
        }
        return next;
      });
    },
    [highScore, newBest],
  );

  function handleReplay() {
    setState((prev) => {
      if (!prev) return prev;
      savedRef.current = false;
      setNewBest(false);
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
      <div className="flex items-center gap-4 font-mono text-[11px] uppercase tracking-[var(--tracking-eyebrow)] text-paper">
        <span className="tabular-nums">SCORE {score}</span>
        <span className="opacity-60">·</span>
        <span className="tabular-nums">BEST {best}</span>
        {newBest && (
          <span className="rounded-full border border-fuchsia bg-fuchsia px-2 py-0.5 text-[10px] font-medium uppercase tracking-[var(--tracking-eyebrow)] text-white shadow-[var(--glow-md)] animate-pulse">
            new best!
          </span>
        )}
      </div>

      <div className="relative rounded-xl border border-fuchsia/40 bg-[#0B0B10] p-2 shadow-[var(--glow-md)]">
        <InvadersCanvas state={state} onStep={onStep} width={480} height={320} />
        {state.status === "game-over" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-paper/85 backdrop-blur-sm">
            <span className="font-mono text-[12px] uppercase tracking-[var(--tracking-eyebrow)] text-ink">
              {newBest ? "new best · " : ""}game over
            </span>
            <button
              onClick={handleReplay}
              className="rounded-full bg-fuchsia px-4 py-1.5 font-mono text-[11px] text-white transition-all hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)] active:scale-[0.98]"
            >
              Play again ▶
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-paper/60">
        ← → move · space fire
      </div>

      {/* Continue gate. Hidden until the parent says ready AND the minimum
          hold has elapsed. Skip is always visible so power users can bail. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onContinue}
          disabled={!continueLive}
          className={`rounded-full px-5 py-2 font-sans text-[13px] font-medium transition-all ${
            continueLive
              ? "bg-fuchsia text-white shadow-[var(--glow-md)] hover:bg-fuchsia-bright hover:shadow-[var(--glow-lg)] animate-pulse"
              : "border border-paper/30 bg-transparent text-paper/40 cursor-wait"
          }`}
        >
          {continueLive ? (newBest ? "New record! Continue →" : "Continue →") : "loading…"}
        </button>
        <button
          type="button"
          onClick={onContinue}
          className="rounded-full border border-paper/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-paper/70 hover:border-paper hover:text-paper"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
