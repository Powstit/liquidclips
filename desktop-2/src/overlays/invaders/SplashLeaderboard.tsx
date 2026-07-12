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

import { useMemo, useState } from "react";
import { useAuth } from "../../lib/useAuth";
import { useMe } from "../../design-os/state/useMe";
import { useTierCaps } from "../../design-os/state/useTierCaps";
import { Avatar } from "./Avatar";
// 2026-07-03 · Step 3 batch 3e · replaced MOCK_AGENCIES / MOCK_CLIPPERS
// with a live fetch of `/leaderboard/arcade`. Empty response → honest
// empty state rendered below.
import { useArcadeLeaderboard, avatarPathFor } from "../../lib/useArcadeLeaderboard";
import "./SplashLeaderboard.css";

type Tab = "leaderboard" | "myscore";

export function SplashLeaderboard({
  score = 0,
}: {
  score?: number;
}) {
  const [tab, setTab] = useState<Tab>("leaderboard");
  // P0-3 (RC1 · 2026-07-11) — was `hasJwt()` at render time · a
  // successful sign-in during the intro splash left the "Sign in to save
  // your score" callout up until the game remounted. `useAuth()` is
  // reactive and flips with every other identity surface on the same
  // tick.
  const { hasJwt: loggedIn } = useAuth();
  // Wave 1 · Cluster 1 · identity ladder (2026-07-12) — SplashLeaderboard
  // now consumes the SAME ladder TopHud does. Priority:
  //   1. ``@handle``            — user picked their handle
  //   2. ``LC-XXXXXX``          — lazy-minted sign-in id
  //   3. ``Signing in…``        — hasJwt && me still hydrating
  //   4. null (rendered as anon call-to-action row via ``loggedIn=false``
  //      earlier)
  //
  // The pill ``data-identity-copy`` mirrors TopHud so QA + ship-lens can
  // assert both surfaces render the same literal string on the same tick.
  const me = useMe();
  const tierCaps = useTierCaps();
  const identity = useMemo(() => {
    const handle = me.snapshot?.handle ?? null;
    const lcId = me.snapshot?.lcId ?? null;
    const hydrated =
      me.source === "real-http" || me.source === "session-cache";
    let userName: string;
    let identityKind: "handle" | "lc-id" | "pending" | "none";
    if (handle) {
      userName = `@${handle}`;
      identityKind = "handle";
    } else if (lcId) {
      userName = lcId;
      identityKind = "lc-id";
    } else if (loggedIn && !hydrated) {
      // A JWT-holding user mid-hydration reads ``Signing in…`` — never
      // ``Guest`` (which would be a lie during BUG-002's window).
      userName = "Signing in…";
      identityKind = "pending";
    } else {
      // No JWT at all — the ``!loggedIn`` branch of YouCallout renders
      // the anon CTA row, so this value only appears if the callout is
      // rendered while signed-in but with no identity data. Honest
      // empty string keeps ``data-identity-copy`` a stable attribute.
      userName = "";
      identityKind = "none";
    }
    let userTier: string;
    if (tierCaps.platformRole === "admin") userTier = "Admin";
    else if (tierCaps.tier === "clipper") userTier = "Free";
    else userTier = tierCaps.tier.charAt(0).toUpperCase() + tierCaps.tier.slice(1);
    return { userName, userTier, identityKind };
  }, [me.snapshot?.handle, me.snapshot?.lcId, me.source, loggedIn, tierCaps.tier, tierCaps.platformRole]);
  const { userName, userTier, identityKind } = identity;
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

      <YouCallout
        loggedIn={loggedIn}
        userName={userName}
        userTier={userTier}
        identityKind={identityKind}
        score={score}
      />
    </aside>
  );
}

function YouCallout({
  loggedIn,
  userName,
  userTier,
  identityKind,
  score,
}: {
  loggedIn: boolean;
  userName: string;
  userTier: string;
  identityKind: "handle" | "lc-id" | "pending" | "none";
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
  // Wave 1 · BUG-002 / BUG-011 (2026-07-12) — ``data-identity-copy``
  // exposes the exact literal string ship-lens + QA need to verify.
  // ``userName`` may be empty (identity ladder returned "none" mid-
  // hydration for a non-JWT edge case); in that case fall through to
  // ``LC · You`` so the row still renders honest content instead of a
  // dangling separator.
  const nameCopy = userName || "You";
  const identityCopy = `${nameCopy} · ${userTier}`;
  return (
    <div
      className="splash-lb-you"
      data-testid="splash-lb-you"
      data-auth-state="signed-in"
      data-identity-kind={identityKind}
    >
      <Avatar name={nameCopy} size={32} />
      <div className="splash-lb-you-text">
        <span className="splash-lb-you-eb">You</span>
        <span
          className="splash-lb-you-name"
          data-identity-copy={identityCopy}
        >
          {identityCopy}
        </span>
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
