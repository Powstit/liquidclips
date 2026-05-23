"use client";

import type { Project } from "../../lib/sidecar";

// Final-action bar under the feed. One primary CTA: publish to all platforms
// (gated to Sprint 5 — Postiz). Secondary CTAs: download zip, schedule.
// Keeps "what does the user actually do after reviewing" obvious.

export function ClipsBottomBar({ project }: { project: Project }) {
  const count = project.clips.length;

  return (
    <div className="mt-8 flex flex-col items-stretch gap-3 rounded-2xl border border-line bg-paper-warm/40 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
        Ready · {count} {count === 1 ? "clip" : "clips"} reviewed
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled
          title="Download all clips as a zip — Sprint 5"
          className="rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] font-medium text-text-tertiary"
        >
          ⬇ Download all
          <span className="ml-2 rounded-full border border-line px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-[0.08em]">S5</span>
        </button>
        <button
          disabled
          title="Auto-distribute across 14 days — Sprint 7"
          className="rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] font-medium text-text-tertiary"
        >
          📅 Schedule
          <span className="ml-2 rounded-full border border-line px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-[0.08em]">S7</span>
        </button>
        <button
          disabled
          title="Publish to YouTube + TikTok + X — Sprint 5"
          className="rounded-full bg-ink/40 px-5 py-2 font-sans text-[13px] font-semibold text-paper/70 shadow"
        >
          🚀 Publish all to all platforms
          <span className="ml-2 rounded-full border border-paper/30 px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-[0.08em]">S5</span>
        </button>
      </div>
    </div>
  );
}
