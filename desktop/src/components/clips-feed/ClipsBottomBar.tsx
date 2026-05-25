"use client";

import type { Project } from "../../lib/sidecar";

// Completion line under the feed. Per-clip publish/export actions live on each
// clip card above (PublishModal etc.), so this is a calm "you're done" closer —
// no batch buttons until real batch operations ship.

export function ClipsBottomBar({ project }: { project: Project }) {
  const count = project.clips.length;

  return (
    <div className="mt-8 flex items-center justify-center rounded-2xl border border-line bg-paper-warm/40 p-5">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
        Ready · {count} {count === 1 ? "clip" : "clips"} reviewed · publish each from its card above
      </div>
    </div>
  );
}
