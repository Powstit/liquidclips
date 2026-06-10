// ship-lens v0.7.8 L4: destructive delete now goes through the sidecar tombstone trio (request → finalize / undo) so the user has 5s + an Undo button before `rmtree` lands. Card disappears from the wall optimistically; on undo we splice the row back into local state without a round-trip refresh.
// v0.6.36 — Library tab (cockpit pass).
//
// Data layer (sidecar.listProjects + filter / search / archive / delete RPCs)
// stays unchanged. Only the render surface swaps over to LibraryWall, which
// shares the same fuchsia HUD bracket language as the Workstation tiles.
// Delete confirmation modal reskinned to match the cockpit modal voice.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openPath } from "@tauri-apps/plugin-shell";
import { motion, AnimatePresence } from "motion/react";
import { RotateCcw, Trash2 } from "lucide-react";
import { humanError, sidecar, type Project, type ProjectLibrarySummary } from "../../lib/sidecar";
import { LibraryWall, type LibraryFilter } from "../cockpit/LibraryWall";
import { LibraryQuickPreview } from "../cockpit/LibraryQuickPreview";

/** v0.7.8 L4 — Lifetime of the Undo toast in ms. After this the sidecar's
 *  `finalize_delete_project` runs and the tombstone is rmtree'd for real.
 *  5s is the standard Gmail/Linear undo window — enough time for "wait I
 *  didn't mean that", short enough that the disk doesn't fill up with
 *  zombie projects. */
const UNDO_WINDOW_MS = 5000;

/** v0.7.8 L4 — One pending tombstone at a time. Each delete carries the
 *  project summary (for restore via splice), a timeout id (so manual undo
 *  cancels the auto-finalize), and the original sort-position so an undo
 *  puts the card back where it was, not at the bottom of the wall. */
type PendingTombstone = {
  project: ProjectLibrarySummary;
  /** Original insertion index in the `projects` array at the moment of
   *  delete. Lets us re-splice the card into the same slot on undo. */
  originalIndex: number;
  timeoutId: number;
};

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
  // v0.7.14 K-α — Quick-preview modal. Tile click opens this lightweight
  // summary first; the modal's Open CTA then routes through `openProject`
  // to the full workstation. Lets the user verify "is this the right
  // project?" without paying the full sidecar.getProject + workstation
  // mount cost on every misclick.
  const [previewProject, setPreviewProject] = useState<ProjectLibrarySummary | null>(null);
  // v0.7.8 L4 — Pending tombstones. Only one at a time (delete is a focused
  // user action; queueing multiple toasts would cause the timer/restore
  // logic to get tangled and the user to lose track of which Undo applies
  // to which project). If a second delete arrives mid-window the previous
  // one is finalized immediately (consistent with Gmail's "newer toast
  // commits the older one").
  const [pendingTombstone, setPendingTombstone] = useState<PendingTombstone | null>(null);

  // Container ref — used to scope the Cmd-K shortcut so it focuses THIS
  // tab's search input rather than any other inbox/search field that might
  // be mounted (e.g. when the user pops the NotificationSheet open over
  // Library). The selector matches the placeholder text on LibraryWall's
  // search field.
  const containerRef = useRef<HTMLDivElement>(null);

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

  // v0.7.31 — external triggers (e.g. ThumbnailStudio "Use as cover" writing
  // cover_choice.json) dispatch lc:library-refresh so the wall tile updates
  // without requiring a tab switch.
  useEffect(() => {
    function onRefresh() {
      void loadProjects();
    }
    window.addEventListener("lc:library-refresh", onRefresh);
    return () => window.removeEventListener("lc:library-refresh", onRefresh);
  }, []);

  // Cmd-K / Ctrl-K → focus the library search input. Small QoL — without
  // this, keyboard users have to click into the field every time they swap
  // tabs. Scoped to the LibraryTab container so it doesn't fight other
  // tabs that may share the same shortcut.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        const root = containerRef.current;
        if (!root) return;
        const input = root.querySelector<HTMLInputElement>(
          'input[placeholder^="search clips"]'
        );
        if (input) {
          e.preventDefault();
          input.focus();
          input.select();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

  // v0.7.8 L4 — Finalize a tombstone: sidecar rmtree's the renamed dir.
  // Idempotent on the sidecar side (returns `removed: 0` if nothing
  // matches), so a missed timer or a second click never crashes. Errors
  // are swallowed into the inline banner — the project is already gone
  // from the user's perspective, so we just report the cleanup failure.
  const finalizeTombstone = useCallback(async (slug: string) => {
    try {
      await sidecar.finalizeDeleteProject(slug);
    } catch (e) {
      setError(humanError(e));
    }
  }, []);

  // v0.7.8 L4 — Restore a tombstoned project. Splices the saved summary
  // back into `projects` at its original index so the visual position
  // doesn't shuffle. The sidecar's `undo_delete_project` is no-op-safe if
  // the project already exists (handles the rare "user re-imported the
  // same slug while undo was pending" race).
  async function undoTombstone(t: PendingTombstone) {
    clearTimeout(t.timeoutId);
    setPendingTombstone(null);
    try {
      await sidecar.undoDeleteProject(t.project.slug);
      setProjects((prev) => {
        // Don't re-insert if the project somehow re-appeared via refresh.
        if (prev.some((x) => x.slug === t.project.slug)) return prev;
        const next = prev.slice();
        const at = Math.min(t.originalIndex, next.length);
        next.splice(at, 0, t.project);
        return next;
      });
    } catch (e) {
      setError(humanError(e));
    }
  }

  async function deleteProject(p: ProjectLibrarySummary) {
    setBusySlug(p.slug);
    setError(null);
    try {
      // v0.7.8 L4 — If a tombstone is already pending, finalize it first.
      // Sequencing rule: the newer delete commits the older one (Gmail
      // semantics). This way the user never sees two Undo toasts fight
      // for the same slot and the older project's tombstone gets cleaned
      // up rather than living forever.
      if (pendingTombstone) {
        clearTimeout(pendingTombstone.timeoutId);
        await finalizeTombstone(pendingTombstone.project.slug);
      }
      // Capture the original index BEFORE we drop the row so undo can
      // splice the card back at the same visual position.
      const originalIndex = projects.findIndex((x) => x.slug === p.slug);
      await sidecar.requestDeleteProject(p.slug);
      setProjects((prev) => prev.filter((x) => x.slug !== p.slug));
      setConfirmDelete(null);
      // Schedule the finalize. Stored on state so manual Undo can cancel.
      // setTimeout returns a number in browsers / Tauri webview, not
      // NodeJS.Timeout, so we cast through unknown for portability.
      const timeoutId = window.setTimeout(() => {
        setPendingTombstone((curr) => {
          if (curr && curr.project.slug === p.slug) {
            void finalizeTombstone(p.slug);
            return null;
          }
          return curr;
        });
      }, UNDO_WINDOW_MS);
      setPendingTombstone({
        project: p,
        originalIndex: originalIndex >= 0 ? originalIndex : 0,
        timeoutId,
      });
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusySlug(null);
    }
  }

  // v0.7.8 L4 — Mirror `pendingTombstone` onto a ref so the unmount
  // cleanup below reads the latest value (a closure on state would be
  // stuck at null forever).
  const pendingTombstoneRef = useRef<PendingTombstone | null>(null);
  useEffect(() => {
    pendingTombstoneRef.current = pendingTombstone;
  }, [pendingTombstone]);

  // v0.7.8 L4 — On unmount, finalize any pending tombstone. Otherwise a
  // user navigating away inside the 5s window would leave the tombstone
  // dir lingering on disk indefinitely (next list_projects skips it, so
  // it's invisible junk). Fire-and-forget — sidecar finalize is
  // idempotent and runs in the background.
  useEffect(() => {
    return () => {
      const pending = pendingTombstoneRef.current;
      if (pending) {
        clearTimeout(pending.timeoutId);
        void sidecar.finalizeDeleteProject(pending.project.slug).catch(() => {});
      }
    };
  }, []);

  const archivedCount = projects.filter((p) => p.archived).length;

  return (
    <div ref={containerRef}>
      {error && (
        // Retry surface — LibraryWall renders its own quieter inline error,
        // but it has no recovery action. This banner sits above the wall so
        // a failed loadProjects has an obvious "try again" path; without it
        // the user is stranded on a dead "Something went wrong" line.
        <div
          role="alert"
          className="mx-auto mb-4 flex w-full max-w-[1180px] items-center justify-between gap-3 rounded-2xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-4 py-3 font-sans text-[13px] text-[var(--color-danger)]"
        >
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadProjects()}
              disabled={loading}
              className="rounded-full border border-[var(--color-danger)]/50 bg-transparent px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)]/15 disabled:opacity-50"
            >
              {loading ? "Retrying…" : "Retry"}
            </button>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
              className="rounded-full bg-transparent px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary transition-colors hover:text-ink"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      <LibraryWall
        projects={projects}
        filtered={filtered}
        filter={filter}
        query={query}
        loading={loading}
        error={null}
        openingSlug={openingSlug}
        busySlug={busySlug}
        archivedCount={archivedCount}
        onFilterChange={setFilter}
        onQueryChange={setQuery}
        onRefresh={() => void loadProjects()}
        onOpen={(slug) => {
          // v0.7.14 K-α — Tile click opens the LibraryQuickPreview modal
          // first. The modal's Open CTA then triggers `openProject(slug)`
          // which routes to the full workstation. Use the cached summary
          // from `projects` so the preview is instant — no extra RPC.
          const summary = projects.find((p) => p.slug === slug);
          if (summary) setPreviewProject(summary);
          else void openProject(slug);
        }}
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

      {/* v0.7.8 L4 — Undo toast. Lives bottom-center over the cockpit so
          it's findable but doesn't cover the wall. Auto-dismisses on
          finalize-timer expiry (in the deleteProject handler) — we don't
          need a separate exit animation key because the state flip from
          truthy to null lets AnimatePresence handle the unmount. */}
      <AnimatePresence>
        {pendingTombstone && (
          <UndoToast
            project={pendingTombstone.project}
            onUndo={() => void undoTombstone(pendingTombstone)}
          />
        )}
      </AnimatePresence>

      {/* v0.7.14 K-α — LibraryQuickPreview. Mounted here so a library tile
          click shows a lightweight summary modal (poster + clip count +
          date + status) before paying the full workstation mount cost.
          The modal's Open CTA closes the preview and routes through the
          existing openProject pipeline so the workspace surface is the
          single source of truth for the heavy load. */}
      {previewProject && (
        <LibraryQuickPreview
          project={previewProject}
          onClose={() => setPreviewProject(null)}
          onOpen={() => {
            const slug = previewProject.slug;
            setPreviewProject(null);
            void openProject(slug);
          }}
        />
      )}
    </div>
  );
}

function UndoToast({
  project,
  onUndo,
}: {
  project: ProjectLibrarySummary;
  onUndo: () => void;
}) {
  // v0.7.8 L4 — Compact horizontal toast. Fuchsia accent on the Undo CTA
  // so the destructive-recovery affordance reads against the muted toast
  // body. No close button — the timer is the close button.
  return (
    <motion.div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 18 }}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-paper-elev/95 px-4 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-md">
        <Trash2 className="h-3.5 w-3.5 shrink-0 text-text-tertiary" strokeWidth={2.2} />
        <span className="max-w-[280px] truncate font-sans text-[12px] text-white">
          Deleted{" "}
          <span className="font-medium text-white">{project.source_filename}</span>
        </span>
        <button
          type="button"
          onClick={onUndo}
          className="inline-flex items-center gap-1 rounded-full bg-fuchsia px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white transition-colors hover:bg-fuchsia-bright"
        >
          <RotateCcw className="h-3 w-3" strokeWidth={2.4} />
          Undo
        </button>
      </div>
    </motion.div>
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
  // Esc → cancel (mirrors click-outside-cancel so the modal isn't a
  // keyboard trap). Ignored while a delete is in flight so the user can't
  // close mid-RPC and end up in an indeterminate state.
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onCancel();
      }
    },
    [busy, onCancel],
  );
  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

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
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--color-danger)]/15 text-[var(--color-danger)]">
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
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-danger)] px-4 py-2 font-sans text-[13px] font-medium text-white transition-colors hover:bg-[#B91C1C] disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
            {busy ? "Deleting…" : "Delete project"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
