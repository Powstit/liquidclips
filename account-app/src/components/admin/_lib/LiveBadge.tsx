"use client";

// LiveBadge — per-tab data-source pill rendered at the top of every HQ tab.
// Renders LIVE / PARTIAL / NO DATA / MOCK / IDLE based on per-fetcher outcomes
// reported through useDataSource(). See _lib/useDataSource.ts.

import type { DataSourceState } from "./useDataSource";

const META: Record<
  DataSourceState,
  { label: string; emoji: string; color: string; bg: string; border: string }
> = {
  IDLE: {
    label: "IDLE",
    emoji: "·",
    color: "var(--lc-fg-faint)",
    bg: "color-mix(in srgb, var(--lc-bg-warm) 70%, transparent)",
    border: "var(--lc-stroke)",
  },
  LIVE: {
    label: "LIVE",
    emoji: "●",
    color: "var(--lc-ok)",
    bg: "rgba(77, 198, 168, 0.10)",
    border: "rgba(77, 198, 168, 0.42)",
  },
  PARTIAL: {
    label: "PARTIAL",
    emoji: "◐",
    color: "var(--lc-warn)",
    bg: "rgba(217, 155, 45, 0.10)",
    border: "rgba(217, 155, 45, 0.42)",
  },
  "NO DATA": {
    label: "NO DATA",
    emoji: "○",
    color: "var(--lc-accent-mid)",
    bg: "var(--lc-accent-soft)",
    border: "rgba(255, 102, 184, 0.40)",
  },
  MOCK: {
    label: "MOCK",
    emoji: "⚠",
    color: "var(--lc-warn)",
    bg: "rgba(217, 155, 45, 0.15)",
    border: "rgba(217, 155, 45, 0.55)",
  },
};

export function LiveBadge({ state }: { state: DataSourceState }) {
  const m = META[state];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em]"
      style={{ color: m.color, background: m.bg, borderColor: m.border }}
      title={`Data source: ${m.label}`}
    >
      <span aria-hidden>{m.emoji}</span>
      {m.label}
    </span>
  );
}
