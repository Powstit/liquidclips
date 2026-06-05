// v0.6.36 — Library tab (cockpit pass).
//
// Data layer (sidecar.listProjects + filter / search / archive / delete RPCs)
// stays unchanged. Only the render surface swaps over to LibraryWall, which
// shares the same fuchsia HUD bracket language as the Workstation tiles.
// Delete confirmation modal reskinned to match the cockpit modal voice.

import { useEffect, useMemo, useState } from "react";
import { open as openPath } from "@tauri-apps/plugin-shell";
import { motion, AnimatePresence } from "motion/react";
import { Trash2 } from "lucide-react";
import { humanError, sidecar, type Project, type ProjectLibrarySummary } from "../../lib/sidecar";
import { LibraryWall, type LibraryFilter } from "../cockpit/LibraryWall";

export function LibraryTab({
  onOpenProject,
  onGoToWorkstation,
}: {
  onOpenProject: (project: Project) => void;
  /** v0.6.36 — Empty-state CTA routes back to the cockpit so the user
   *  always has a "go make something" exit from an empty library. */
  onGoToWorkstation?: () => void;
}) {
  const [projects, setProjects] = useState<ProjectLibrarySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingSlug, setOpeningSlug] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [confirmDelete, setConfirmDelete] = useState<ProjectLibrarySummary | null>(null);

  async function loadProjects() {
    setLoading(true);
    setError(null);
    try {
      const { projects } = await sidecar.listProjects(200, true);
      setProjects(projects);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects.filter((project) => {
      // Archived projects only show in the Archived filter — preserves the
      // pre-cockpit semantics so users don't suddenly see archived clips on
      // "All" after the chrome refresh.
      if (filter === "archived") {
        if (!project.archived) return false;
      } else if (project.archived) {
        return false;
      }
      if (filter === "ready" && !project.done) return false;
      if (filter === "reacted" && project.reacted_count < 1) return false;
      if (filter === "imported" && !project.imported) return false;
      if (filter === "rewards" && !project.whop_bounty_id) return false;
      if (!needle) return true;
      return `${project.source_filename} ${project.slug} ${project.whop_bounty_title ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [filter, projects, query]);

  async function openProject(slug: string) {
    setOpeningSlug(slug);
    setError(null);
    try {
      const { project } = await sidecar.getProject(slug);
      onOpenProject(project);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setOpeningSlug(null);
    }
  }

  async function toggleArchived(p: ProjectLibrarySummary) {
    setBusySlug(p.slug);
    setError(null);
    try {
      await sidecar.setProjectArchived(p.slug, !p.archived);
      setProjects((prev) =>
        prev.map((x) =>
          x.slug === p.slug
            ? { ...x, archived: !p.archived, archived_at: !p.archived ? Date.now() / 1000 : null }
            : x,
        ),
      );
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusySlug(null);
    }
  }

  async function deleteProject(p: ProjectLibrarySummary) {
    setBusySlug(p.slug);
    setError(null);
    try {
      await sidecar.deleteProject(p.slug);
      setProjects((prev) => prev.filter((x) => x.slug !== p.slug));
      setConfirmDelete(null);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusySlug(null);
    }
  }

  const archivedCount = projects.filter((p) => p.archived).length;

  return (
    <>
      <LibraryWall
        projects={projects}
        filtered={filtered}
        filter={filter}
        query={query}
        loading={loading}
        error={error}
        openingSlug={openingSlug}
        busySlug={busySlug}
        archivedCount={archivedCount}
        onFilterChange={setFilter}
        onQueryChange={setQuery}
        onRefresh={() => void loadProjects()}
        onOpen={(slug) => void openProject(slug)}
        onOpenFolder={(p) => void openPath(p.root).catch((e) => setError(humanError(e)))}
        onArchive={(p) => void toggleArchived(p)}
        onDelete={(p) => setConfirmDelete(p)}
        onGoToWorkstation={() => onGoToWorkstation?.()}
      />

      <AnimatePresence>
        {confirmDelete && (
          <ConfirmDelete
            project={confirmDelete}
            busy={busySlug === confirmDelete.slug}
            onCancel={() => setConfirmDelete(null)}
            onConfirm={() => void deleteProject(confirmDelete)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function ConfirmDelete({
  project,
  busy,
  onCancel,
  onConfirm,
}: {
  project: ProjectLibrarySummary;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/85 px-6 backdrop-blur-md"
      onClick={onCancel}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      role="dialog"
      aria-modal="true"
      aria-label="Confirm delete"
    >
      <motion.div
        className="relative w-full max-w-[440px] p-7"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
      >
        {/* Bracket corners — fuchsia HUD language, same as everywhere else
            in the cockpit. The red destructive accent is on the button only. */}
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />

        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#DC2626]/15 text-[#DC2626]">
            <Trash2 className="h-4 w-4" strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia">delete</span>
            <h3 className="font-display text-[18px] font-semibold tracking-[-0.015em] text-ink">
              Remove this project?
            </h3>
            <p className="mt-1 break-words font-sans text-[13px] leading-snug text-text-secondary">
              <span className="font-medium text-ink">{project.source_filename}</span> and{" "}
              <span className="font-mono text-[12px]">{project.clips_count}</span> clip
              {project.clips_count === 1 ? "" : "s"} will be removed from disk. This can't be undone.
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full border border-line bg-transparent px-4 py-2 font-sans text-[12px] font-medium text-text-secondary hover:border-fuchsia hover:text-ink disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#DC2626] px-4 py-2 font-sans text-[13px] font-medium text-white transition-colors hover:bg-[#B91C1C] disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
            {busy ? "Deleting…" : "Delete project"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
