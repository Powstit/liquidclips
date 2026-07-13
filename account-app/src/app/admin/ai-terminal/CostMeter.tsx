"use client";

import { useEffect, useState } from "react";

// CostMeter reads two counters from sessionStorage:
//   `lc-ai-terminal-cost-cents`     — running session $ spend (cents)
//   `lc-ai-terminal-request-count`  — request count this session
//
// The Terminal updates these after every successful /api/admin/ai/run.
// We render passively: read, format, display. No write logic lives here.
//
// The "today" figure is best-effort — sessionStorage doesn't survive
// across days/devices, so we treat session ≈ today and label it as
// "this session" to stay truthful.

const SESSION_BUDGET_DOLLARS = 10; // soft visual budget; not enforced

export function CostMeter({ bumpSignal }: { bumpSignal: number }) {
  const [cents, setCents] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const rawC = window.sessionStorage.getItem("lc-ai-terminal-cost-cents");
    const rawN = window.sessionStorage.getItem("lc-ai-terminal-request-count");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates state from window / storage on mount — canonical external-source subscription
    setCents(rawC ? Number(rawC) || 0 : 0);
    setCount(rawN ? Number(rawN) || 0 : 0);
  }, [bumpSignal]);

  const dollars = cents / 100;
  const pct = Math.min(100, (dollars / SESSION_BUDGET_DOLLARS) * 100);

  return (
    <div className="flex items-center gap-3 text-xs text-text-secondary">
      <div className="flex items-center gap-2">
        <span className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-paper-elev">
          <span
            className="block h-full rounded-full bg-fuchsia transition-all"
            style={{ width: `${pct}%` }}
          />
        </span>
        <span className="tabular-nums">${dollars.toFixed(2)}</span>
      </div>
      <span className="text-text-tertiary">
        this session · {count} request{count === 1 ? "" : "s"}
      </span>
    </div>
  );
}

// Imperative helpers used by Terminal to mutate the counters. Centralised
// here so the storage keys exist in one place only.
export function recordCost(costUsd: number): void {
  if (typeof window === "undefined") return;
  const prevC = Number(window.sessionStorage.getItem("lc-ai-terminal-cost-cents") ?? "0") || 0;
  const prevN = Number(window.sessionStorage.getItem("lc-ai-terminal-request-count") ?? "0") || 0;
  const addCents = Math.round(costUsd * 100);
  window.sessionStorage.setItem(
    "lc-ai-terminal-cost-cents",
    String(prevC + addCents),
  );
  window.sessionStorage.setItem("lc-ai-terminal-request-count", String(prevN + 1));
}
