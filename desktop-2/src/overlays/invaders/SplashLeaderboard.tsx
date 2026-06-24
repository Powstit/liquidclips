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
import { MOCK_AGENCIES, MOCK_CLIPPERS } from "./mockLeaderboard";
import "./SplashLeaderboard.css";

type Tab = "leaderboard" | "myscore";

export function SplashLeaderboard({
  score = 0,
  /** When the real user model lands, pass the resolved display name
   *  through this prop. Today defaults to "Daniel" to mirror TopHud. */
  userName = "Daniel",
  /** Free-form tier label (Beta · Pro · Agency etc). Mirrors TopHud. */
  userTier = "Beta",
}: {
  score?: number;
  userName?: string;
  userTier?: string;
}) {
  const [tab, setTab] = useState<Tab>("leaderboard");
  const loggedIn = hasJwt();

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
            title="Top Clippers (by views)"
            icon="trophy"
            tint="fuchsia"
            rows={MOCK_CLIPPERS.map((c, i) => ({
              rank: i + 1,
              name: c.name,
              detail: `${c.views} views`,
              score: c.score.toLocaleString(),
              scoreTint: "fuchsia" as const,
              avatarSrc: c.avatarSrc,
            }))}
          />
          <Section
            title="Top Agencies (by payouts)"
            icon="building"
            tint="cyan"
            rows={MOCK_AGENCIES.map((a, i) => ({
              rank: i + 1,
              name: a.name,
              detail: `${a.paid} paid`,
              score: a.score.toLocaleString(),
              scoreTint: "cyan" as const,
              avatarSrc: a.avatarSrc,
            }))}
          />
          <p className="splash-lb-sim">
            simulator data · not real views or payouts
          </p>
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
        <button type="button" className="splash-lb-you-cta">Sign in</button>
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
