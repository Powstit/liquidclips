// Earnings leaderboard — sprint #14a.
//
// Top 100 affiliates by lifetime earnings, refreshed every 6h server-side.
// The first 3 get a podium row with their TierAvatar; ranks 4-100 are a
// dense scrollable list. If the caller is outside the top 100 a floating
// "Your rank" card pins to the bottom so they always see their position.
//
// Cockpit pass (Round 1 Earn): plates dropped. Loading / error / empty /
// podium / list rail all wear bracket-only frames over the cockpit
// perspective. ONE fuchsia accent throughout — silver/gold/bronze tinting
// is gone; rank rhythm reads from sizing + bracket intensity instead.

import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCw, Trophy } from "lucide-react";
import { leaderboardGet, type LeaderboardEntry, type LeaderboardResponse } from "../../lib/backend";
import { humanError } from "../../lib/sidecar";
import { TierAvatar, tierForEarnings } from "../TierAvatar";

export function Leaderboard() {
  const [state, setState] = useState<{
    loading: boolean;
    data: LeaderboardResponse | null;
    error: string | null;
  }>({ loading: true, data: null, error: null });

  const load = useCallback(async (): Promise<void> => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await leaderboardGet();
      setState({ loading: false, data, error: data ? null : "Leaderboard unavailable" });
    } catch (e) {
      // PREVENTS — raw error objects like "[object Object]" or
      // "TypeError: failed to fetch" leaking into the UI. humanError
      // maps known failure shapes to recoverable copy.
      setState({ loading: false, data: null, error: humanError(e) });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await leaderboardGet();
        if (!cancelled) setState({ loading: false, data, error: data ? null : "Leaderboard unavailable" });
      } catch (e) {
        if (!cancelled) setState({ loading: false, data: null, error: humanError(e) });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (state.loading) {
    return (
      <div className="earn-frame relative px-8 py-10 text-center">
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
        <p className="font-mono text-[12px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          Pulling the board<span className="blink">_</span>
        </p>
      </div>
    );
  }

  if (state.error || !state.data) {
    return (
      <div className="earn-frame relative px-8 py-10 text-center" data-tone="danger">
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
        <p className="font-mono text-[12px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          {state.error ?? "Leaderboard unavailable"}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-secondary hover:border-fuchsia hover:text-fuchsia-deep"
        >
          <RotateCw size={11} strokeWidth={2} />
          Retry
        </button>
      </div>
    );
  }

  const { entries, caller_rank, caller_entry, refreshed_at, total_ranked } = state.data;

  if (entries.length === 0) {
    return <EmptyBoard />;
  }

  const [first, second, third, ...rest] = entries;

  return (
    <div className="flex flex-col gap-4">
      <Header refreshedAt={refreshed_at} totalRanked={total_ranked} callerRank={caller_rank} />

      <Podium first={first} second={second} third={third} />

      {rest.length > 0 && (
        <div className="earn-frame relative">
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
          <div className="px-5 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-fuchsia">
              rank 4 — {entries[entries.length - 1].rank}
            </p>
          </div>
          <ul className="max-h-[420px] overflow-y-auto">
            {rest.map((e) => (
              <Row key={e.rank} entry={e} />
            ))}
          </ul>
        </div>
      )}

      {caller_entry && caller_rank !== null && (
        <CallerCard entry={caller_entry} totalRanked={total_ranked} />
      )}
    </div>
  );
}

function Header({
  refreshedAt,
  totalRanked,
  callerRank,
}: {
  refreshedAt: string | null;
  totalRanked: number;
  callerRank: number | null;
}) {
  const ago = useMemo(() => relativeAgo(refreshedAt), [refreshedAt]);
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-fuchsia">
          <Trophy size={11} />
          earnings leaderboard
        </div>
        {/* Task #69 — "affiliates" → "allies" in user-facing heading copy.
            Backend tables + analytics keys still say affiliate; only the
            display string flips. See docs/RPO_VISUAL_LANGUAGE.md. */}
        <h1 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Top allies by lifetime payout.
        </h1>
        <p className="font-sans text-[13px] text-text-secondary">
          {totalRanked} clipper{totalRanked === 1 ? "" : "s"} on the board
          {callerRank !== null && (
            <> · you're at <span className="font-medium text-ink">#{callerRank}</span></>
          )}
          .
        </p>
      </div>
      {ago && (
        <p className="shrink-0 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          updated {ago}
        </p>
      )}
    </div>
  );
}

function Podium({
  first,
  second,
  third,
}: {
  first: LeaderboardEntry | undefined;
  second: LeaderboardEntry | undefined;
  third: LeaderboardEntry | undefined;
}) {
  if (!first) return null;
  return (
    <div className="grid grid-cols-3 gap-2.5">
      <PodiumCard entry={second} place={2} />
      <PodiumCard entry={first}  place={1} tall />
      <PodiumCard entry={third}  place={3} />
    </div>
  );
}

function PodiumCard({
  entry,
  place,
  tall,
}: {
  entry: LeaderboardEntry | undefined;
  place: 1 | 2 | 3;
  tall?: boolean;
}) {
  if (!entry) {
    return (
      <div className={`earn-frame relative flex flex-col items-center justify-end ${tall ? "min-h-[200px]" : "min-h-[160px]"}`}>
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
        <p className="pb-4 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          open slot
        </p>
      </div>
    );
  }
  const earnings = Number(entry.lifetime_earnings_usd);
  const tier = tierForEarnings(earnings);
  return (
    <div
      className={`earn-frame library-card relative flex flex-col items-center gap-2 p-4 ${
        tall ? "pt-7" : "pt-5"
      }`}
      data-hot={place === 1 ? "true" : "false"}
    >
      {/* Top-3 gets the brighter library-card corners; the #1 slot pulls
          the `data-hot` intensity bump. Same dashed fuchsia language, no
          gold/silver/bronze tinting — rank reads from height + brackets. */}
      <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
      <span className="absolute left-3 top-3 font-display text-[18px] font-bold text-fuchsia">
        {ordinal(place)}
      </span>
      <TierAvatar tier={tier} size={tall ? 64 : 52} />
      <p className="font-sans text-[14px] font-semibold text-ink">{entry.display_handle}</p>
      <p className="font-display text-[20px] font-bold tracking-[-0.02em] text-ink">
        ${formatMoney(earnings)}
      </p>
      <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
        {entry.paid_referrals} paid referral{entry.paid_referrals === 1 ? "" : "s"}
      </p>
      {entry.is_caller && (
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-fuchsia">
          you
        </span>
      )}
    </div>
  );
}

function Row({ entry }: { entry: LeaderboardEntry }) {
  const earnings = Number(entry.lifetime_earnings_usd);
  return (
    <li
      className={`flex items-center justify-between gap-3 border-b border-line/40 px-5 py-2.5 last:border-b-0 ${
        entry.is_caller ? "bg-fuchsia-soft/40" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="w-9 font-mono text-[12px] text-text-tertiary">
          #{entry.rank}
        </span>
        <span className="font-sans text-[14px] font-medium text-ink">
          {entry.display_handle}
          {entry.is_caller && (
            <span className="ml-2 inline-flex items-center font-mono text-[9px] uppercase tracking-[0.18em] text-fuchsia">
              · you
            </span>
          )}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <span className="font-mono text-[11px] text-text-tertiary">
          {entry.paid_referrals} ref
        </span>
        <span className="font-display text-[15px] font-semibold text-ink">
          ${formatMoney(earnings)}
        </span>
      </div>
    </li>
  );
}

function CallerCard({
  entry,
  totalRanked,
}: {
  entry: LeaderboardEntry;
  totalRanked: number;
}) {
  return (
    <div className="earn-frame sticky bottom-2 z-10 relative p-4 backdrop-blur-md">
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-fuchsia text-[13px] font-bold text-paper">
            #{entry.rank}
          </span>
          <div>
            <p className="font-sans text-[14px] font-semibold text-ink">Your rank</p>
            <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
              of {totalRanked} clippers · {entry.paid_referrals} paid referral{entry.paid_referrals === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <p className="font-display text-[20px] font-bold tracking-[-0.02em] text-ink">
          ${formatMoney(Number(entry.lifetime_earnings_usd))}
        </p>
      </div>
    </div>
  );
}

function EmptyBoard() {
  return (
    <div className="earn-frame relative mx-auto my-10 flex w-full max-w-[480px] flex-col items-start gap-3 px-8 py-10">
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia">
        board waiting
      </span>
      <Trophy size={28} className="text-fuchsia" />
      <h2 className="font-display text-[20px] font-semibold tracking-[-0.015em] text-ink">
        Be the first name on the board.
      </h2>
      <p className="font-sans text-[14px] text-text-secondary">
        Share your referral link from the Invite panel. Your earnings show up
        here within 6 hours of your first paid signup.
      </p>
    </div>
  );
}

// ── helpers ────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toFixed(2);
}

function relativeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const diffMin = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (diffMin < 2) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const hr = Math.round(diffMin / 60);
  if (hr < 24) return `${hr} hr ago`;
  const d = Math.round(hr / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
