// v0.7.18 — Cockpit duplicate tile. Replaces the v0.7.16 AddClipDialog
// (title+duration prompt) with a one-click duplicate of the last rendered
// clip. Uses sidecar.duplicateClip — reuses MP4 paths, no ffmpeg re-encode,
// instant new card with " (copy)" suffix and -v2/-v3 slug.
//
// Integration-lens: this tile is the canonical Add path on the grid. The
// per-clip ClipPreview still handles deep edits (title, trim, layout,
// captions, platforms).

import { useState } from "react";
import { sidecar, humanError, type Project } from "../lib/sidecar";

export function AddClipCard({
  project,
  onProjectChange,
}: {
  project: Project;
  onProjectChange: (p: Project) => void;
}) {
  const [busy, setBusy] = useState(false);

  // Last rendered clip — the one we'll duplicate. Use findLastIndex so the
  // duplicate inherits the most recent clip's settings (most likely the
  // one the clipper is iterating on right now).
  const lastRenderedIdx = (() => {
    for (let i = project.clips.length - 1; i >= 0; i--) {
      if (project.clips[i]?.vertical_path) return i;
    }
    return -1;
  })();
  const noRenderableClip = lastRenderedIdx < 0;

  async function duplicate() {
    if (busy || noRenderableClip) return;
    setBusy(true);
    try {
      const r = await sidecar.duplicateClip(project.slug, lastRenderedIdx);
      onProjectChange(r.project);
      const src = project.clips[lastRenderedIdx];
      const label = src?.title ? `"${src.title.slice(0, 40)}"` : `clip ${lastRenderedIdx + 1}`;
      window.dispatchEvent(
        new CustomEvent("lc:toast", {
          detail: { kind: "success", message: `Duplicated ${label}.` },
        }),
      );
    } catch (e) {
      window.dispatchEvent(
        new CustomEvent("lc:toast", {
          detail: { kind: "error", message: humanError(e) },
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={() => void duplicate()}
      disabled={busy || noRenderableClip}
      title={
        noRenderableClip
          ? "Wait for a clip to finish rendering, then duplicate it."
          : busy
          ? "Duplicating…"
          : "Duplicate the last rendered clip (instant, same source MP4)."
      }
      className="library-card group relative flex aspect-[3/5] flex-col items-center justify-center gap-3 rounded-2xl p-4 transition-all hover:bg-fuchsia-soft/10 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="library-card-corner-tl" aria-hidden />
      <span className="library-card-corner-tr" aria-hidden />
      <span className="library-card-corner-bl" aria-hidden />
      <span className="library-card-corner-br" aria-hidden />
      <div className="grid h-14 w-14 place-items-center rounded-full border border-fuchsia/40 bg-transparent text-fuchsia transition-colors group-hover:border-fuchsia group-hover:bg-fuchsia group-hover:text-white">
        {/* Two-square duplicate glyph */}
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect x="4" y="4" width="14" height="14" rx="2" />
          <rect x="8" y="8" width="14" height="14" rx="2" />
        </svg>
      </div>
      <div className="text-center">
        <div className="font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">
          {busy ? "Duplicating…" : noRenderableClip ? "Duplicate" : "Duplicate last clip"}
        </div>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          {noRenderableClip ? "render one first" : "instant · same source"}
        </p>
      </div>
    </button>
  );
}
