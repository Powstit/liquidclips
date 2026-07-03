// Splash HUD overlays for the game stage:
//   · Top strip — CLIPPERS counter + AGENCIES/BRANDS counter + SCORE chip + LIVES hearts
//   · Center tooltip pill — "Hit bugs. Earn points. Level up …"
//   · Bottom-left LEVEL UP card with 8-pip pixel-invader progress bar
//
// Counters come from the live /leaderboard/arcade endpoint (Batch 3E).
// A fresh install with an empty DB renders zeros — honest empty state,
// no fabricated growth numbers.
// v0.7.67 — SCORE chip + LIVES decrement now driven by live engine state.

// 2026-07-03 · Step 3 batch 3e · counters now come from
// /leaderboard/arcade instead of MOCK_COUNTERS. Fresh install / empty
// DB shows 0 with no fabricated delta.
import { useArcadeLeaderboard } from "../../lib/useArcadeLeaderboard";
import { difficultyTierFor } from "../../lib/invaders/engine";
import "./SplashHud.css";

export function SplashHud({
  score = 0,
  lives = 3,
  wave = 1,
}: {
  score?: number;
  lives?: number;
  /** C.6 · when passed, HUD surfaces the named difficulty tier
   *  (RECRUIT/SOLDIER/VETERAN/ELITE/COMMANDER/LEGENDARY) instead of
   *  a raw wave number so runs feel identity-shaped. */
  wave?: number;
}) {
  const tier = difficultyTierFor(wave);
  const arcade = useArcadeLeaderboard(5);
  const clipperTotal = arcade.counters.clippers.total;
  const agencyTotal = arcade.counters.agencies.total;
  const clipperDelta = arcade.counters.clippers.deltaToday;
  const agencyDelta = arcade.counters.agencies.deltaToday;
  return (
    <>
      <div className="splash-hud-top" data-testid="splash-hud-counters">
        <Counter
          label="Clippers"
          value={clipperTotal.toLocaleString()}
          delta={clipperDelta > 0 ? `+${clipperDelta} today` : "live"}
          icon="clipper"
          tint="fuchsia"
        />
        <Counter
          label="Agencies / Brands"
          value={agencyTotal.toLocaleString()}
          delta={agencyDelta > 0 ? `+${agencyDelta} today` : "live"}
          icon="agency"
          tint="cyan"
        />
        <ScoreChip score={score} />
        <Lives count={Math.max(0, Math.min(3, lives))} />
        {/* C.6 · named difficulty tier chip · replaces raw "wave 12" with
            "COMMANDER" for identity-shaped runs. */}
        <div
          className="splash-hud-tier"
          data-testid="splash-hud-tier"
          data-tier={tier.short}
        >
          <span className="splash-hud-tier-label">Rank</span>
          <span className="splash-hud-tier-value">{tier.name}</span>
        </div>
      </div>

      <div className="splash-hud-tip" data-testid="splash-hud-tip">
        <span className="splash-hud-tip-icon" aria-hidden="true">◆</span>
        <span>
          Hit bugs. Earn <strong>points</strong>. Level up your clipping game.
        </span>
      </div>

      <div className="splash-hud-levelup" data-testid="splash-hud-levelup">
        <div className="splash-hud-levelup-text">
          <span className="splash-hud-levelup-eb">Level up</span>
          <span className="splash-hud-levelup-body">
            Score points to unlock rewards and climb the leaderboards.
          </span>
        </div>
        <div className="splash-hud-levelup-pips" role="img" aria-label="5 of 8 levels reached">
          {Array.from({ length: 8 }, (_, i) => (
            <PixelInvader key={i} lit={i < 5} />
          ))}
        </div>
      </div>
    </>
  );
}

function ScoreChip({ score }: { score: number }) {
  return (
    <div className="splash-hud-score" data-testid="splash-hud-score">
      <span className="splash-hud-score-label">Score</span>
      <span className="splash-hud-score-value">{score.toLocaleString()}</span>
    </div>
  );
}

function Counter({
  label,
  value,
  delta,
  icon,
  tint,
}: {
  label: string;
  value: string;
  delta: string;
  icon: "clipper" | "agency";
  tint: "fuchsia" | "cyan";
}) {
  return (
    <div className={`splash-hud-counter splash-hud-counter-${tint}`}>
      <span className={`splash-hud-counter-icon splash-hud-counter-icon-${tint}`} aria-hidden="true">
        <CounterIcon kind={icon} />
      </span>
      <div className="splash-hud-counter-body">
        <span className="splash-hud-counter-label">{label}</span>
        <span className="splash-hud-counter-value">{value}</span>
        <span className="splash-hud-counter-delta">▲ {delta}</span>
      </div>
    </div>
  );
}

function CounterIcon({ kind }: { kind: "clipper" | "agency" }) {
  if (kind === "clipper") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="9" cy="7" r="3" />
        <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
        <circle cx="17" cy="7" r="2.5" />
        <path d="M21 21v-1.5a3 3 0 0 0-3-3" />
      </svg>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 21V8l8-5 8 5v13" />
      <path d="M9 21v-6h6v6" />
      <path d="M9 11h.01M15 11h.01M9 14h.01M15 14h.01" />
    </svg>
  );
}

function Lives({ count }: { count: number }) {
  return (
    <div className="splash-hud-lives" aria-label={`${count} lives remaining`} data-testid="splash-hud-lives" data-lives={count}>
      <span className="splash-hud-lives-label">Lives</span>
      <div className="splash-hud-lives-hearts">
        {Array.from({ length: 3 }, (_, i) => (
          <Heart key={i} lit={i < count} />
        ))}
      </div>
    </div>
  );
}

function Heart({ lit }: { lit: boolean }) {
  const fill = lit ? "#FF1A8C" : "rgba(244,241,234,0.18)";
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={fill} aria-hidden="true">
      <path d="M12 21s-7-4.5-9-9c-1.5-3.5 1-7 4.5-7C9.5 5 11 6.5 12 8c1-1.5 2.5-3 4.5-3 3.5 0 6 3.5 4.5 7-2 4.5-9 9-9 9z" />
    </svg>
  );
}

function PixelInvader({ lit }: { lit: boolean }) {
  const c = lit ? "#FF1A8C" : "rgba(244,241,234,0.18)";
  return (
    <svg width="22" height="22" viewBox="0 0 11 8" fill={c} aria-hidden="true">
      <rect x="5" y="0" width="1" height="1" />
      <rect x="4" y="1" width="3" height="1" />
      <rect x="3" y="2" width="5" height="1" />
      <rect x="2" y="3" width="2" height="1" />
      <rect x="5" y="3" width="1" height="1" />
      <rect x="7" y="3" width="2" height="1" />
      <rect x="1" y="4" width="9" height="1" />
      <rect x="0" y="5" width="2" height="1" />
      <rect x="3" y="5" width="2" height="1" />
      <rect x="6" y="5" width="2" height="1" />
      <rect x="9" y="5" width="2" height="1" />
      <rect x="2" y="6" width="1" height="1" />
      <rect x="8" y="6" width="1" height="1" />
    </svg>
  );
}
