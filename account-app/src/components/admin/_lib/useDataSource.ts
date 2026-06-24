"use client";

// useDataSource — per-tab live-vs-mock data-source tracker.
//
// Each tab body wires this hook, calls `report(key, status)` once per fetcher
// it runs, and renders a <LiveBadge state={state} /> pill at the top. The
// state aggregates per-fetcher outcomes so Daniel can see at a glance whether
// a tab is showing real backend data, a partial fallback, or nothing at all.
//
// Status meaning:
//   LIVE     — every reported fetcher returned OK.
//   PARTIAL  — at least one OK + at least one fail/skip.
//   NO DATA  — every reported fetcher errored.
//   MOCK     — any fetcher hit a hardcoded fallback (should never happen
//              after the 2026-06-24 demo-data sweep).
//   IDLE     — no fetcher has reported yet (initial mount).

import { useCallback, useMemo, useState } from "react";

export type FetcherStatus = "ok" | "fail" | "skip" | "mock";

export type DataSourceState = "IDLE" | "LIVE" | "PARTIAL" | "NO DATA" | "MOCK";

export type DataSource = {
  state: DataSourceState;
  outcomes: Record<string, FetcherStatus>;
  report: (key: string, status: FetcherStatus) => void;
  reset: () => void;
};

export function useDataSource(): DataSource {
  const [outcomes, setOutcomes] = useState<Record<string, FetcherStatus>>({});

  const report = useCallback((key: string, status: FetcherStatus) => {
    setOutcomes((prev) => {
      if (prev[key] === status) return prev;
      return { ...prev, [key]: status };
    });
  }, []);

  const reset = useCallback(() => setOutcomes({}), []);

  const state: DataSourceState = useMemo(() => {
    const values = Object.values(outcomes);
    if (values.length === 0) return "IDLE";
    if (values.some((v) => v === "mock")) return "MOCK";
    const okCount = values.filter((v) => v === "ok").length;
    const badCount = values.filter((v) => v === "fail" || v === "skip").length;
    if (okCount > 0 && badCount === 0) return "LIVE";
    if (okCount > 0 && badCount > 0) return "PARTIAL";
    return "NO DATA";
  }, [outcomes]);

  return { state, outcomes, report, reset };
}
