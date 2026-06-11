// ship-lens v0.7.14: K-α — LibraryQuickPreview
// SURFACE: Library Quick Preview
// CONTRACT: useLibraryProject.ts (Claude C2)
// A lightweight modal that shows a quick project summary without opening
// the full workspace. Click library tile → modal opens → Open routes to
// ResultsGrid.

import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { X, FolderOpen, Calendar, Layers } from "lucide-react";
import type { ProjectLibrarySummary } from "../../lib/sidecar";

interface LibraryQuickPreviewProps {
  project: ProjectLibrarySummary;
  onOpen: () => void;
  onClose: () => void;
}

// Claude C2: ProjectLibrarySummary's user-visible fields are `slug` (id),
// `source_filename` (display name), `clips_count`, `created_at` (unix sec),
// `cover_thumb_path`. There is no `name` / `num_clips` / `date_created` /
// `description` / `poster_path` — those were assumed by Kimi; mapped here
// to the real shape so tsc + build are honest.

function formatDate(unixSec: number): string {
  try {
    return new Date(unixSec * 1000).toLocaleDateString();
  } catch {
    return "—";
  }
}

export function LibraryQuickPreview({ project, onOpen, onClose }: LibraryQuickPreviewProps) {
  const [posterUrl, setPosterUrl] = useState<string | null>(null);

  useEffect(() => {
    if (project.cover_thumb_path) {
      setPosterUrl(convertFileSrc(project.cover_thumb_path));
    } else {
      setPosterUrl(null);
    }
  }, [project.cover_thumb_path]);

  return (
    // v0.7.50 — Brand modal pass. Backdrop bg-black/50 (out-of-palette)
    // and inner bg-paper (should be paper-warm per modal spec) both
    // brought to canonical.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/85 backdrop-blur-md p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${project.source_filename}`}
    >
      <div
        className="flex w-full max-w-[420px] flex-col gap-4 rounded-2xl border border-line bg-paper-warm p-5 shadow-e2"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Poster */}
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl bg-paper-deep">
          {posterUrl ? (
            <img
              src={posterUrl}
              alt={project.source_filename}
              className="h-full w-full object-cover"
              draggable={false}
              onError={() => setPosterUrl(null)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-text-tertiary">
              <span className="font-mono text-[11px] uppercase tracking-[0.12em]">
                No poster
              </span>
            </div>
          )}
        </div>

        {/* Meta */}
        <div className="flex flex-col gap-2">
          <h3 className="font-display text-[17px] font-semibold text-ink">
            {project.source_filename}
          </h3>
          <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            <span className="flex items-center gap-1">
              <Layers className="h-3.5 w-3.5" />
              {project.clips_count} clip{project.clips_count !== 1 ? "s" : ""}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {formatDate(project.created_at)}
            </span>
          </div>
          <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
            {project.imported ? `Imported pack · ${project.clips_count} clip${project.clips_count !== 1 ? "s" : ""}` : project.done ? "Ready to ship." : "In progress."}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-full border border-line bg-transparent px-4 py-2 font-sans text-[12px] font-medium text-text-secondary transition-colors hover:border-fuchsia hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
            Close
          </button>
          <button
            onClick={() => {
              onClose();
              onOpen();
            }}
            className="flex items-center gap-1.5 rounded-full bg-fuchsia px-4 py-2 font-sans text-[12px] font-semibold text-white transition-colors hover:bg-fuchsia-deep"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Open →
          </button>
        </div>
      </div>
    </div>
  );
}
