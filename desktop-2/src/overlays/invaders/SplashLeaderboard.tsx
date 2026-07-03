// Right-side leaderboard panel for the splash game stage. Glass HUD,
// tabbed (Leaderboard / My Score), two sections (Top Clippers / Top
// Agencies). Mock-only · subtle simulator copy at the bottom so we don't
// imply real view or payout tracking. Reuses existing rank crown SVGs
// from /brand/leaderboard/.
//
// v0.7.67 — added live `score` prop from SplashGame · added auth-aware
// "YOU" callout pinned at panel bottom · pixel-art avatars (PixelLab)
// replace initials for the mock rows · MY SCORE tab shows live engine
// score.

import { useState } from "react";
import { hasJwt } from "../../lib/authStorage";
import { Avatar } from "./Avatar";
// 2026-07-03 · Step 3 batch 3e · replaced MOCK_AGENCIES / MOCK_CLIPPERS
// with a live fetch of `/leaderboard/arcade`. Empty response → honest
// empty state rendered below.
import { useArcadeLeaderboard, avatarPathFor } from "../../lib/useArcadeLeaderboard";
import "./SplashLeaderboard.css";

type Tab = "leaderboard" | "myscore";

export function SplashLeaderboard({
  score = 0,
  /** When the real user model lands, pass the resolved display name
   *  through this prop. BUG-001 · was "Daniel"; switched to the generic
   *  "Guest" fallback to mirror TopHud. */
  userName = "Guest",
  /** Free-form tier label (Free · Solo · Pro · Agency). BUG-001 · was
   *  "Beta"; the product's entry tier is "Free". Mirrors TopHud. */
  userTier = "Free",
}: {
  score?: number;
  userName?: string;
  userTier?: string;
}) {
  const [tab, setTab] = useState<Tab>("leaderboard");
  const loggedIn = hasJwt();
  // Batch 3E · live rows. `snapshot.loading` while the fetch is in
  // flight; empty arrays after failure or when the DB has no scorers.
  const arcade = useArcadeLeaderboard(5);

  return (
    <aside
      className="splash-lb"
      data-testid="splash-leaderboard"
      aria-label="Splash leaderboard · simulator data"
    >
      <div className="splash-lb-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "leaderboard"}
          className={`splash-lb-tab ${tab === "leaderboard" ? "on" : ""}`}
          onClick={() => setTab("leaderboard")}
          data-testid="splash-leaderboard-tab-leaderboard"
        >
          Leaderboard
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "myscore"}
          className={`splash-lb-tab ${tab === "myscore" ? "on" : ""}`}
          onClick={() => setTab("myscore")}
          data-testid="splash-leaderboard-tab-myscore"
        >
          My Score
        </button>
      </div>

      {tab === "leaderboard" ? (
        <div className="splash-lb-body">
          <Section
            title="Top Clippers (arcade)"
            icon="trophy"
            tint="fuchsia"
            rows={arcade.clippers.map((c, i) => ({
              rank: i + 1,
              name: c.handle,
              detail: `${c.score.toLocaleString()} score`,
              score: c.score.toLocaleString(),
              scoreTint: "fuchsia" as const,
              avatarSrc: avatarPathFor(c.avatarIndex),
            }))}
          />
          <Section
            title="Top Agencies (arcade)"
            icon="building"
            tint="cyan"
            rows={arcade.agencies.map((a, i) => ({
              rank: i + 1,
              name: a.handle,
              detail: `${a.score.toLocaleString()} score`,
              score: a.score.toLocaleString(),
              scoreTint: "cyan" as const,
              avatarSrc: avatarPathFor(a.avatarIndex),
            }))}
          />
          {arcade.loading ? (
            <p className="splash-lb-sim">loading leaderboard…</p>
          ) : arcade.clippers.length === 0 && arcade.agencies.length === 0 ? (
            <p className="splash-lb-sim">
              first to 1,000 wins Founder tier · be the first to appear here
            </p>
          ) : (
            <p className="splash-lb-sim">
              live · updated on each launch
            </p>
          )}
        </div>
      ) : (
        <div className="splash-lb-body">
          <div className="splash-lb-myscore">
            <span className="splash-lb-myscore-label">your score this session</span>
            <span className="splash-lb-myscore-num">{score.toLocaleString()}</span>
            <span className="splash-lb-myscore-hint">
              {loggedIn ? "shoot bugs to climb" : "sign in to save your score"}
            </span>
          </div>
        </div>
      )}

      <YouCallout loggedIn={loggedIn} userName={userName} userTier={userTier} score={score} />
    </aside>
  );
}

function YouCallout({
  loggedIn,
  userName,
  userTier,
  score,
}: {
  loggedIn: boolean;
  userName: string;
  userTier: string;
  score: number;
}) {
  if (!loggedIn) {
    return (
      <div className="splash-lb-you" data-testid="splash-lb-you" data-auth-state="anon">
        <div
          className="splash-lb-you-avatar-anon"
          aria-hidden="true"
        >
          ?
        </div>
        <div className="splash-lb-you-text">
          <span className="splash-lb-you-eb">Not signed in</span>
          <span className="splash-lb-you-name splash-lb-you-name-anon">
            Sign in to save your score
          </span>
        </div>
        {/* Gate 6 (2026-06-26) — was a dead button. Wired to fire the
         *  activation flow: clear any stale JWT (signals AuthGate to
         *  re-evaluate) and emit nav:click to "login" so SimulatorRouter
         *  swaps to the LoginOnboarding surface. */}
        <button
          type="button"
          className="splash-lb-you-cta"
          onClick={() => {
            try {
              window.localStorage.removeItem("lc.license.jwt.v1");
            } catch { /* noop */ }
            window.location.hash = "#/home";
            window.setTimeout(() => {
              const w = window as unknown as { __lcBus?: { emit: (e: string, p: unknown) => void } };
              w.__lcBus?.emit?.("nav:click", { route: "login" });
            }, 30);
          }}
        >
          Sign in
        </button>
      </div>
    );
  }
  return (
    <div className="splash-lb-you" data-testid="splash-lb-you" data-auth-state="signed-in">
      <Avatar name={userName} size={32} />
      <div className="splash-lb-you-text">
        <span className="splash-lb-you-eb">You</span>
        <span className="splash-lb-you-name">{userName} · {userTier}</span>
      </div>
      <span className="splash-lb-you-score">{score.toLocaleString()}</span>
    </div>
  );
}

type Row = {
  rank: number;
  name: string;
  detail: string;
  score: string;
  scoreTint: "fuchsia" | "cyan";
  avatarSrc?: string;
};

function Section({
  title,
  icon,
  tint,
  rows,
}: {
  title: string;
  icon: "trophy" | "building";
  tint: "fuchsia" | "cyan";
  rows: Row[];
}) {
  return (
    <div className="splash-lb-section">
      <h3 className={`splash-lb-section-title splash-lb-section-title-${tint}`}>
        <SectionIcon kind={icon} />
        {title}
      </h3>
      <ul className="splash-lb-list">
        {rows.map((r) => (
          <li key={`${title}-${r.rank}`} className="splash-lb-row">
            <RankBadge rank={r.rank} />
            <Avatar name={r.name} size={32} imageSrc={r.avatarSrc} />
            <span className="splash-lb-row-name">
              <span className="splash-lb-row-name-text">{r.name}</span>
              <span className="splash-lb-row-detail">{r.detail}</span>
            </span>
            <span className={`splash-lb-row-score splash-lb-row-score-${r.scoreTint}`}>
              {r.score}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionIcon({ kind }: { kind: "trophy" | "building" }) {
  if (kind === "trophy") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 21h8M12 17v4" />
        <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
        <path d="M5 4H3v3a3 3 0 0 0 3 3M19 4h2v3a3 3 0 0 1-3 3" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 21V8l8-5 8 5v13" />
      <path d="M9 21v-6h6v6" />
      <path d="M9 11h.01M15 11h.01M9 14h.01M15 14h.01" />
    </svg>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="splash-lb-rank" aria-label="1st"><RankCrown tint="#FFD24A" /></span>;
  if (rank === 2) return <span className="splash-lb-rank" aria-label="2nd"><RankCrown tint="#D7DBE2" /></span>;
  if (rank === 3) return <span className="splash-lb-rank" aria-label="3rd"><RankCrown tint="#E89A3F" /></span>;
  return <span className="splash-lb-rank splash-lb-rank-num">{rank}</span>;
}

function RankCrown({ tint }: { tint: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={tint} aria-hidden="true">
      <path d="M3 8l4 4 5-7 5 7 4-4-2 12H5z" />
    </svg>
  );
}
