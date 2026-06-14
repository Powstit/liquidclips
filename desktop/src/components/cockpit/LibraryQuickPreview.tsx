// ship-lens v0.7.14: K-α — LibraryQuickPreview
// SURFACE: Library Quick Preview
// CONTRACT: useLibraryProject.ts (Claude C2)
// A lightweight modal that shows a quick project summary without opening
// the full workspace. Click library tile → modal opens → Open routes to
// ResultsGrid.

import { useCallback, useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { X, FolderOpen, Calendar, Layers, Plus } from "lucide-react";
import { humanError, sidecar, type ProjectLibrarySummary } from "../../lib/sidecar";
import { addMembership } from "../../lib/projectMemberships";

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
  // v0.7.72 — Add to Project picker state. Lazy-loads the project list the
  // first time the user opens the picker so a no-op modal close costs nothing.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pickerToast, setPickerToast] = useState<string | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [allProjects, setAllProjects] = useState<ProjectLibrarySummary[] | null>(null);

  useEffect(() => {
    if (project.cover_thumb_path) {
      setPosterUrl(convertFileSrc(project.cover_thumb_path));
    } else {
      setPosterUrl(null);
    }
  }, [project.cover_thumb_path]);

  const openPicker = useCallback(async () => {
    setPickerOpen(true);
    setPickerError(null);
    if (allProjects !== null) return;
    setPickerLoading(true);
    try {
      const { projects } = await sidecar.listProjects(200, false);
      setAllProjects(projects);
    } catch (e) {
      setPickerError(humanError(e));
    } finally {
      setPickerLoading(false);
    }
  }, [allProjects]);

  const attachTo = useCallback(
    async (target: ProjectLibrarySummary) => {
      setPickerError(null);
      try {
        await addMembership({
          project_slug: target.slug,
          asset_type: project.imported ? "render" : "clip",
          asset_path: project.cover_thumb_path || project.root,
          source_project_slug: project.slug,
        });
        setPickerToast(`Added to ${target.whop_bounty_title || target.source_filename || target.slug}`);
        setPickerOpen(false);
      } catch (e) {
        setPickerError(humanError(e));
      }
    },
    [project],
  );

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

        {pickerToast && (
          <p
            role="status"
            className="rounded-lg border border-fuchsia/30 bg-fuchsia-soft/20 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep"
          >
            {pickerToast}
          </p>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-full border border-line bg-transparent px-4 py-2 font-sans text-[12px] font-medium text-text-secondary transition-colors hover:border-fuchsia hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
            Close
          </button>
          {/* v0.7.72 — Add to Project. Opens an inline picker that lists
              every non-archived project; selecting one writes to
              project_memberships.json. */}
          <button
            onClick={() => void openPicker()}
            className="flex items-center gap-1.5 rounded-full border border-line bg-paper px-4 py-2 font-sans text-[12px] font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia-deep"
          >
            <Plus className="h-3.5 w-3.5" />
            Add to Project
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

        {pickerOpen && (
          <div className="flex flex-col gap-2 rounded-2xl border border-line bg-paper-elev/60 p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">
                Pick a project
              </span>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary hover:text-ink"
              >
                cancel
              </button>
            </div>
            {pickerError && (
              <p role="alert" className="font-mono text-[11px] text-[var(--color-danger-bright)]">
                {pickerError}
              </p>
            )}
            {pickerLoading && (
              <p className="font-mono text-[11px] text-text-tertiary">loading projects…</p>
            )}
            {!pickerLoading && allProjects && allProjects.length === 0 && (
              <p className="font-sans text-[12px] text-text-secondary">
                No projects yet — start a bounty from Earn to create one.
              </p>
            )}
            {!pickerLoading && allProjects && allProjects.length > 0 && (
              <div className="flex max-h-[200px] flex-col gap-1 overflow-y-auto">
                {allProjects
                  .filter((p) => p.slug !== project.slug)
                  .map((p) => (
                    <button
                      key={p.slug}
                      type="button"
                      onClick={() => void attachTo(p)}
                      className="flex items-center justify-between gap-2 rounded-lg border border-transparent bg-transparent px-3 py-1.5 text-left transition-colors hover:border-fuchsia hover:bg-fuchsia-soft/20"
                    >
                      <span className="truncate font-sans text-[12px] text-ink">
                        {p.whop_bounty_title || p.source_filename || p.slug}
                      </span>
                      <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary">
                        {p.whop_bounty_id ? "Earn" : p.imported ? "Import" : "Manual"}
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
