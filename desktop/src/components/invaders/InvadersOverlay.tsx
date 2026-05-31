import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Card, IconButton } from "../primitives";
import { closeInvaders, useInvadersOpen } from "../../lib/invaders/store";
import { getHighScore, setHighScore } from "../../lib/invaders/highScore";
import { initGame, reset, step, type GameState, type Input } from "../../lib/invaders/engine";
import { InvadersCanvas } from "./InvadersCanvas";

export function InvadersOverlay() {
  const open = useInvadersOpen();
  const [state, setState] = useState<GameState | null>(null);
  const [highScore, setHighScoreState] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<Input>({ left: false, right: false, fire: false });
  const firePrevRef = useRef(false);
  const savedRef = useRef(false);

  // initialise game state + load high score on open
  useEffect(() => {
    if (!open) {
      setState(null);
      setToast(null);
      savedRef.current = false;
      return;
    }
    setState(initGame(480, 320));
    getHighScore().then(setHighScoreState).catch(() => setHighScoreState(0));
  }, [open]);

  // keyboard handling
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeInvaders();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        e.preventDefault();
        inputRef.current.left = true;
      }
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        e.preventDefault();
        inputRef.current.right = true;
      }
      if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        if (!firePrevRef.current) {
          inputRef.current.fire = true;
          firePrevRef.current = true;
        }
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        inputRef.current.left = false;
      }
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        inputRef.current.right = false;
      }
      if (e.key === " " || e.key === "Spacebar") {
        firePrevRef.current = false;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      inputRef.current = { left: false, right: false, fire: false };
      firePrevRef.current = false;
    };
  }, [open]);

  // body scroll lock
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const onStep = useCallback(
    (dtMs: number) => {
      setState((prev) => {
        if (!prev || prev.status !== "playing") return prev;
        const input = { ...inputRef.current };
        inputRef.current.fire = false; // consume edge
        const next = step(prev, dtMs, input);
        // save high score on game over (once)
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
    [highScore],
  );

  function handleReplay() {
    setState((prev) => {
      if (!prev) return prev;
      savedRef.current = false;
      // Clear any keys the user was holding when they hit game-over so
      // the new round doesn't inherit phantom movement.
      inputRef.current = { left: false, right: false, fire: false };
      firePrevRef.current = false;
      return reset(prev);
    });
  }

  // Sprint #18 — auto-collapse the Browse Rewards side panel while the game
  // is open so the user gets the full canvas, not a split screen. Restore
  // on unmount only if WE closed it (track the prior state via a ref so we
  // don't reopen a panel the user explicitly closed before opening the game).
  useEffect(() => {
    if (!open) return;
    let weClosedIt = false;
    let cancelled = false;
    (async () => {
      try {
        const { closeBrowsePanel, isBrowsePanelOpenInRust, openBrowsePanel } = await import("../../lib/browse");
        const wasOpen = await isBrowsePanelOpenInRust();
        if (cancelled) return;
        if (wasOpen) {
          await closeBrowsePanel();
          weClosedIt = true;
        }
        // Restore handler stored on the effect closure
        (window as any).__liquidclips_restore_browse = async () => {
          if (weClosedIt) {
            try { await openBrowsePanel(); } catch { /* noop */ }
          }
        };
      } catch {
        /* browse panel unavailable — game still works */
      }
    })();
    return () => {
      cancelled = true;
      const restore = (window as any).__liquidclips_restore_browse;
      if (typeof restore === "function") {
        void restore();
        delete (window as any).__liquidclips_restore_browse;
      }
    };
  }, [open]);

  if (!open || !state) return null;

  const overlay = (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-paper/30 p-6 backdrop-blur-md"
      onClick={closeInvaders}
    >
      <Card
        elevation="raised"
        padding="none"
        className="flex w-[520px] max-w-full flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-fuchsia-deep">
              PINK INVADERS
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
              score {state.score} · best {Math.max(highScore, state.score)}
            </span>
          </div>
          <IconButton variant="ghost" label="Close" onClick={closeInvaders}>
            <X size={16} />
          </IconButton>
        </header>

        <div className="relative flex items-center justify-center bg-[#0B0B10] p-4">
          <InvadersCanvas state={state} onStep={onStep} width={480} height={320} />
          {state.status === "game-over" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-paper/80">
              <span className="font-mono text-[14px] uppercase tracking-[0.12em] text-ink">
                Game over
              </span>
              <button
                onClick={handleReplay}
                className="rounded-full bg-fuchsia px-4 py-2 font-mono text-[12px] text-white transition-all hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)] active:scale-[0.98]"
              >
                Play again ▶
              </button>
            </div>
          )}
          {toast && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-fuchsia/40 bg-paper-elev px-3 py-1.5 font-mono text-[11px] text-ink shadow-[var(--shadow-e1)]">
              {toast}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
            ← → move · space fire · esc close
          </span>
        </footer>
      </Card>
    </div>
  );

  return createPortal(overlay, document.body);
}
