// Earnings leaderboard — sprint #14a.
//
// Top 100 affiliates by lifetime earnings, refreshed every 6h server-side.
// The first 3 get a podium row with their TierAvatar; ranks 4-100 are a
// dense scrollable list. If the caller is outside the top 100 a floating
// "Your rank" card pins to the bottom so they always see their position.

import { useEffect, useMemo, useState } from "react";
import { Trophy } from "lucide-react";
import { leaderboardGet, type LeaderboardEntry, type LeaderboardResponse } from "../../lib/backend";
import { TierAvatar, tierForEarnings } from "../TierAvatar";

export function Leaderboard() {
  const [state, setState] = useState<{
    loading: boolean;
    data: LeaderboardResponse | null;
    error: string | null;
  }>({ loading: true, data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await leaderboardGet();
        if (!cancelled) setState({ loading: false, data, error: data ? null : "Leaderboard unavailable" });
      } catch (e) {
        if (!cancelled) setState({ loading: false, data: null, error: String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (state.loading) {
    return (
      <div className="rounded-2xl border border-line bg-paper p-8 text-center">
        <p className="font-mono text-[12px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          Pulling the board<span className="blink">_</span>
        </p>
      </div>
    );
  }

  if (state.error || !state.data) {
    return (
      <div className="rounded-2xl border border-line bg-paper p-8 text-center">
        <p className="font-mono text-[12px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          {state.error ?? "Leaderboard unavailable"}
        </p>
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
        <div className="rounded-2xl border border-line bg-paper">
          <div className="border-b border-line/60 px-5 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
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
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          <Trophy size={11} className="text-fuchsia" />
          earnings leaderboard
        </div>
        <h1 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Top affiliates by lifetime payout.
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
      <PodiumCard entry={second} place={2} tone="silver" />
      <PodiumCard entry={first}  place={1} tone="gold" tall />
      <PodiumCard entry={third}  place={3} tone="bronze" />
    </div>
  );
}

function PodiumCard({
  entry,
  place,
  tone,
  tall,
}: {
  entry: LeaderboardEntry | undefined;
  place: 1 | 2 | 3;
  tone: "gold" | "silver" | "bronze";
  tall?: boolean;
}) {
  if (!entry) {
    return (
      <div className={`flex flex-col items-center justify-end rounded-2xl border border-dashed border-line bg-paper ${tall ? "min-h-[200px]" : "min-h-[160px]"}`}>
        <p className="pb-4 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          open slot
        </p>
      </div>
    );
  }
  const earnings = Number(entry.lifetime_earnings_usd);
  const tier = tierForEarnings(earnings);
  const toneClasses = {
    gold:   "border-[#E6B449]/60 bg-gradient-to-b from-[#FFF7E0]/40 to-paper shadow-[0_8px_30px_rgba(230,180,73,0.18)]",
    silver: "border-[#C9CDD3]/60 bg-gradient-to-b from-[#F2F4F7]/50 to-paper",
    bronze: "border-[#C68A57]/55 bg-gradient-to-b from-[#FCEFE0]/40 to-paper",
  }[tone];
  return (
    <div
      className={`relative flex flex-col items-center gap-2 rounded-2xl border p-4 ${toneClasses} ${
        tall ? "pt-7" : "pt-5"
      } ${entry.is_caller ? "ring-2 ring-fuchsia ring-offset-2 ring-offset-paper" : ""}`}
    >
      <span className="absolute left-3 top-3 font-display text-[18px] font-bold text-ink/70">
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
            <span className="ml-2 inline-flex items-center rounded-full bg-fuchsia px-2 py-[1px] font-mono text-[9px] uppercase tracking-[0.1em] text-paper">
              you
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
    <div className="sticky bottom-2 z-10 rounded-2xl border border-fuchsia/60 bg-paper/95 p-4 backdrop-blur-md shadow-[0_12px_40px_rgba(255,26,140,0.12)]">
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
    <div className="rounded-2xl border border-line bg-paper p-10 text-center">
      <Trophy size={32} className="mx-auto text-fuchsia" />
      <h2 className="mt-3 font-display text-[20px] font-semibold tracking-[-0.015em] text-ink">
        Be the first name on the board.
      </h2>
      <p className="mt-2 font-sans text-[14px] text-text-secondary">
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
