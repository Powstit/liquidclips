import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Volume2, VolumeX } from "lucide-react";
import { Card, IconButton } from "../../components/primitives";
import { closeInvaders, useInvadersOpen } from "../../lib/invaders/store";
import { SafeImg } from "../../components/safe";
import { getHighScore, setHighScore } from "../../lib/invaders/highScore";
import {
  submitArcadeScore,
  shareArcadeScore,
  fetchArcadeLeaderboard,
  type ArcadeLeaderboardEntry,
} from "../../lib/chat";
import {
  isMuted,
  toggleMuted,
  primeAudio,
  sfxLaser,
  sfxHit,
  sfxDeath,
  sfxShieldThud,
  sfxWaveUp,
} from "../../lib/invaders/audio";
import {
  initGame,
  reset,
  step,
  type EngineEvent,
  type GameState,
  type Input,
} from "../../lib/invaders/engine";
import { InvadersCanvas } from "./InvadersCanvas";

// v2.2.11 · 500-subscriber tournament milestone copy. Locked in the
// HUD so the prize stakes are visible while the user plays.
const TOURNAMENT_COPY =
  "At 500 subscribers, the highest network score wins the grand prize.";

// Sidecar art · the purpose-built Kade shooter pose + the gpt-image-1
// fuchsia flame marquee generated for this surface.
const KADE_SHOOTER_SRC = "/brand/kade/kade-shooter.webp";
const MARQUEE_FLAME_SRC = "/brand/invaders/marquee-flame.png";

interface GameOverPanelProps {
  score: number;
  rankLabel: string;
  shared: boolean;
  onShare: () => void;
  onReplay: () => void;
}

function GameOverPanel({
  score,
  rankLabel,
  shared,
  onShare,
  onReplay,
}: GameOverPanelProps): JSX.Element {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-paper/85 px-6 text-center">
      <span className="font-display text-[16px] uppercase tracking-[0.12em] text-ink">
        Game over
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
        {rankLabel}
      </span>
      <div className="font-display text-[28px] font-bold text-fuchsia-deep">
        {score.toLocaleString()} pts
      </div>
      <p className="max-w-[340px] font-sans text-[11px] leading-snug text-text-secondary">
        {TOURNAMENT_COPY}
      </p>
      <div className="mt-1 flex gap-2">
        <button
          onClick={onShare}
          disabled={shared}
          className="rounded-full border border-fuchsia/40 bg-paper-elev px-3 py-2 font-sans text-[12px] font-medium text-ink transition-all hover:border-fuchsia hover:shadow-[var(--shadow-e1)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {shared ? "Shared ✓" : "Share to lounge"}
        </button>
        <button
          onClick={onReplay}
          className="rounded-full bg-fuchsia px-4 py-2 font-sans text-[12px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)] active:scale-[0.98]"
        >
          Play again ▶
        </button>
      </div>
    </div>
  );
}

export function InvadersOverlay() {
  const open = useInvadersOpen();
  const [state, setState] = useState<GameState | null>(null);
  const [highScore, setHighScoreState] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const [rankLabel, setRankLabel] = useState("Calculating placement…");
  const [shared, setShared] = useState(false);
  const inputRef = useRef<Input>({ left: false, right: false, fire: false });
  const firePrevRef = useRef(false);
  const savedRef = useRef(false);

  // v2.2.11 · audio bridge. Engine emits semantic events; this hook
  // routes them to the synth module so engine.ts stays DOM-free.
  const emit = useCallback((event: EngineEvent) => {
    switch (event) {
      case "fire":
        sfxLaser();
        break;
      case "invader-kill":
        sfxHit();
        break;
      case "player-hit":
        sfxShieldThud();
        break;
      case "player-death":
        sfxDeath();
        break;
      case "wave-up":
        sfxWaveUp();
        break;
    }
  }, []);

  // initialise game state + load high score on open
  useEffect(() => {
    if (!open) {
      setState(null);
      setToast(null);
      setShared(false);
      setRankLabel("Calculating placement…");
      savedRef.current = false;
      return;
    }
    setState(initGame(480, 320));
    setMutedState(isMuted());
    primeAudio();
    getHighScore().then(setHighScoreState).catch(() => setHighScoreState(0));
    // Pre-fetch leaderboard so the rank label renders without a flash
    // on game-over. Best-effort: silence on network error.
    void fetchArcadeLeaderboard(10)
      .then((entries) => setRankLabel(formatRank(entries, 0)))
      .catch(() => setRankLabel("Network offline · play to rank"));
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
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        setMutedState(toggleMuted());
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
        const next = step(prev, dtMs, input, emit);
        // save high score on game over (once)
        if (next.status === "game-over" && !savedRef.current) {
          savedRef.current = true;
          if (next.score > highScore) {
            setHighScoreState(next.score);
            void setHighScore(next.score);
            setToast("New personal best!");
            window.setTimeout(() => setToast(null), 2200);
          }
          // v2.2.11 · server ratchet + refresh leaderboard so the
          // rank label paints with the freshly-updated standing.
          void submitArcadeScore(next.score).then(() => {
            void fetchArcadeLeaderboard(10).then((entries) =>
              setRankLabel(formatRank(entries, next.score)),
            );
          });
        }
        return next;
      });
    },
    [highScore, emit],
  );

  function handleReplay() {
    setState((prev) => {
      if (!prev) return prev;
      savedRef.current = false;
      setShared(false);
      // Clear any keys the user was holding when they hit game-over so
      // the new round doesn't inherit phantom movement.
      inputRef.current = { left: false, right: false, fire: false };
      firePrevRef.current = false;
      return reset(prev);
    });
  }

  async function handleShare() {
    if (!state) return;
    const score = Math.max(state.score, highScore);
    const ok = await shareArcadeScore(score);
    if (ok) {
      setShared(true);
      setToast("Posted to #global-lounge");
      window.setTimeout(() => setToast(null), 2200);
    } else {
      setToast("Couldn't reach the lounge · try again");
      window.setTimeout(() => setToast(null), 2200);
    }
  }

  if (!open || !state) return null;

  const overlay = (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-paper/30 p-6 backdrop-blur-md"
      onClick={closeInvaders}
    >
      <Card
        elevation="raised"
        padding="none"
        className="flex w-[700px] max-w-full flex-row overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* v2.2.11 · vertical Kade brand sidecar. Fixed width so the
         *  canvas column scales gracefully across workstation widths
         *  without shifting layout. Marquee flame is the gpt-image-1
         *  asset generated for this surface; Kade-shooter is the
         *  purpose-built brand pose. */}
        <aside
          className="hidden w-[160px] shrink-0 flex-col items-center justify-between gap-3 border-r border-line bg-[#0B0B10] px-3 py-4 sm:flex"
          data-testid="lc-arcade-sidecar"
        >
          <SafeImg
            src={MARQUEE_FLAME_SRC}
            fallback="hide"
            alt=""
            aria-hidden
            className="h-[150px] w-auto object-contain opacity-90"
            draggable={false}
          />
          <SafeImg
            src={KADE_SHOOTER_SRC}
            fallback="hide"
            alt="Kade"
            className="h-[140px] w-auto object-contain drop-shadow-[0_8px_24px_rgba(255,26,140,0.45)]"
            draggable={false}
          />
          <p className="text-balance text-center font-sans text-[10px] leading-tight text-fuchsia-bright">
            500-sub prize milestone · climb the network leaderboard
          </p>
        </aside>

        <div className="flex flex-1 flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
            <div className="flex flex-col gap-0.5">
              <span className="font-display text-[12px] font-semibold uppercase tracking-[var(--tracking-eyebrow)] text-fuchsia-deep">
                PINK INVADERS
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
                score {state.score} · best {Math.max(highScore, state.score).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <IconButton
                variant="ghost"
                label={muted ? "Unmute" : "Mute"}
                onClick={() => setMutedState(toggleMuted())}
              >
                {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </IconButton>
              <IconButton variant="ghost" label="Close" onClick={closeInvaders}>
                <X size={16} />
              </IconButton>
            </div>
          </header>

          <div className="relative flex items-center justify-center bg-[#0B0B10] p-4">
            <InvadersCanvas state={state} onStep={onStep} width={480} height={320} />
            {state.status === "game-over" && (
              <GameOverPanel
                score={state.score}
                rankLabel={rankLabel}
                shared={shared}
                onShare={() => void handleShare()}
                onReplay={handleReplay}
              />
            )}
            {toast && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-fuchsia/40 bg-paper-elev px-3 py-1.5 font-sans text-[11px] text-ink shadow-[var(--shadow-e1)]">
                {toast}
              </div>
            )}
          </div>

          <footer className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
              ← → move · space fire · m mute · esc close
            </span>
          </footer>
        </div>
      </Card>
    </div>
  );

  return createPortal(overlay, document.body);
}

/** Format the rank label from the leaderboard + viewer's current score.
 *  Returns one of:
 *    - "You're #N on the network · keep going"
 *    - "Outside top 10 · top spot is X pts"
 *    - "No scores yet · be the first"
 *
 *  Heuristic ranking (no per-user lookup yet): count entries whose
 *  high score is strictly greater than the viewer's score, plus 1.
 *  When viewerScore = 0 (pre-play snapshot at open time), shows the
 *  current top entry as the target instead of a "you're #11" miss.
 */
function formatRank(
  entries: ArcadeLeaderboardEntry[],
  viewerScore: number,
): string {
  if (entries.length === 0) {
    return "No scores yet · be the first";
  }
  if (viewerScore <= 0) {
    return `Top score is ${entries[0].arcade_high_score.toLocaleString()} pts · play to claim a spot`;
  }
  const ahead = entries.filter(
    (e) => e.arcade_high_score > viewerScore,
  ).length;
  const rank = ahead + 1;
  if (rank > 10) {
    return `Outside top 10 · top spot is ${entries[0].arcade_high_score.toLocaleString()} pts`;
  }
  return `You're #${rank} on the network · keep going`;
}
