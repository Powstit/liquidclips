// SignalLine — ambient 24px bottom-edge ticker.
//
// Rotates 3 cockpit signals every 5s with a soft cross-fade, sitting fixed at
// the bottom of the viewport above the app body but below modals. Never
// blocks clicks (pointer-events: none) and quietly renders nothing if all
// three signals are empty (new users don't get spam).
//
// Signals:
//   1. "rank · #N of M"            ← leaderboardGet() (same API AvatarPanel uses)
//   2. "next post · <platform> · in Xh Ym" ← sidecar.localScheduleList()
//   3. "today's leader · @handle · $X"     ← leaderboardGet() entries[0]
//
// Refresh: on mount + every 60s.

import { useEffect, useState } from "react";
import { leaderboardGet, type LeaderboardResponse } from "../../lib/backend";
import { sidecar, type LocalScheduleItem } from "../../lib/sidecar";

const REFRESH_MS = 60_000;
const ROTATE_MS = 5_000;

function fmtUsd(decimalStr: string): string {
  const n = Number(decimalStr);
  if (!Number.isFinite(n)) return decimalStr;
  // Compact display — earnings can be 4-digit; drop cents above $100 so the
  // line stays short.
  if (n >= 100) return `$${Math.round(n).toLocaleString()}`;
  return `$${n.toFixed(2)}`;
}

function fmtCountdown(targetIso: string): string | null {
  const ms = new Date(targetIso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function pickNextScheduled(items: LocalScheduleItem[]): LocalScheduleItem | null {
  const now = Date.now();
  let best: { item: LocalScheduleItem; at: number } | null = null;
  for (const item of items) {
    if (item.status !== "pending") continue;
    const at = new Date(item.scheduled_for).getTime();
    if (!Number.isFinite(at) || at <= now) continue;
    if (!best || at < best.at) best = { item, at };
  }
  return best?.item ?? null;
}

function buildSignals(
  leaderboard: LeaderboardResponse | null,
  schedule: LocalScheduleItem[],
): string[] {
  const out: string[] = [];

  // 1 — caller rank
  if (leaderboard && leaderboard.caller_rank && leaderboard.total_ranked > 0) {
    out.push(`rank · #${leaderboard.caller_rank} of ${leaderboard.total_ranked}`);
  }

  // 2 — next scheduled post
  const next = pickNextScheduled(schedule);
  if (next) {
    const eta = fmtCountdown(next.scheduled_for);
    if (eta) out.push(`next post · ${next.platform} · in ${eta}`);
  }

  // 3 — today's leader (top of board)
  if (leaderboard && leaderboard.entries.length > 0) {
    const top = leaderboard.entries[0];
    out.push(
      `today's leader · @${top.display_handle} · ${fmtUsd(top.lifetime_earnings_usd)}`,
    );
  }

  return out;
}

export default function SignalLine() {
  const [signals, setSignals] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);

  // Mount + every 60s — refresh data. Failures are swallowed so the ticker
  // simply hides if either source is offline.
  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const [board, sched] = await Promise.all([
          leaderboardGet().catch(() => null),
          sidecar
            .localScheduleList()
            .then((r) => r.items)
            .catch(() => [] as LocalScheduleItem[]),
        ]);
        if (cancelled) return;
        setSignals(buildSignals(board, sched));
      } catch {
        if (!cancelled) setSignals([]);
      }
    }

    void refresh();
    const id = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Rotate the visible signal every 5s. Index keys the rendered span so the
  // CSS animation re-runs on each change (cross-fade in, hold, fade out).
  useEffect(() => {
    if (signals.length <= 1) return;
    const id = window.setInterval(() => {
      setIdx((n) => (n + 1) % signals.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [signals.length]);

  // No data → render nothing. The ticker only appears once at least one
  // signal exists, so a brand-new install isn't noisy.
  if (signals.length === 0) return null;

  const current = signals[idx % signals.length];

  return (
    <div className="signal-line" aria-hidden="true">
      {/* Keyed span so the animation restarts on each rotation. */}
      <span key={`${idx}:${current}`} className="signal-line__item">
        {current}
      </span>
    </div>
  );
}
