"use client";

import type { Project } from "../../lib/sidecar";

// Completion line under the feed. Per-clip publish/export actions live on each
// clip card above (PublishModal etc.), so this is a calm "you're done" closer —
// no batch buttons until real batch operations ship.

export function ClipsBottomBar({ project }: { project: Project }) {
  const count = project.clips.length;

  return (
    <div className="relative mt-8 flex items-center justify-center rounded-2xl bg-transparent p-5">
      <span className="cockpit-tile-corner-tl" aria-hidden />
      <span className="cockpit-tile-corner-tr" aria-hidden />
      <span className="cockpit-tile-corner-bl" aria-hidden />
      <span className="cockpit-tile-corner-br" aria-hidden />
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
        Ready · {count} {count === 1 ? "clip" : "clips"} reviewed · publish each from its card above
      </div>
    </div>
  );
}
