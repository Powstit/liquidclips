import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openPath } from "@tauri-apps/plugin-shell";
import {
  Archive,
  ArchiveRestore,
  Film,
  FolderOpen,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  WandSparkles,
} from "lucide-react";
import { PageHeader } from "../primitives";
import { humanError, sidecar, type Project, type ProjectLibrarySummary } from "../../lib/sidecar";

type FilterKey = "all" | "ready" | "reacted" | "imported" | "rewards" | "archived";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ready", label: "Ready" },
  { key: "reacted", label: "Reactions" },
  { key: "imported", label: "Uploads" },
  { key: "rewards", label: "Rewards" },
  { key: "archived", label: "Archived" },
];

export function LibraryTab({
  onOpenProject,
}: {
  onOpenProject: (project: Project) => void;
}) {
  const [projects, setProjects] = useState<ProjectLibrarySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingSlug, setOpeningSlug] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
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
      // Archived projects only show in the Archived filter.
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
      // Optimistic update — refresh in background.
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

  const visibleProjects = projects.filter((p) => !p.archived);
  const archivedCount = projects.filter((p) => p.archived).length;

  return (
    <div className="deck deck-workspace flex w-full max-w-[1080px] flex-col gap-6 pt-2">
      <PageHeader
        glyph={Archive}
        eyebrow="clip library"
        title="Previous edits"
        subtitle="Every local project saved by Liquid Clips. Reopen a clip pack, inspect the folder, archive, or delete."
        trailing={
          <button
            type="button"
            onClick={() => void loadProjects()}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-elev px-3.5 py-2 font-sans text-[12px] font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia"
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} strokeWidth={2} />
            Refresh
          </button>
        }
      />

      <section className="hud-frame rounded-2xl border border-line bg-paper-warm/35 px-5 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-paper-elev px-3 py-2 transition-colors focus-within:border-fuchsia">
            <Search className="h-4 w-4 shrink-0 text-text-tertiary" strokeWidth={2} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects, rewards, filenames"
              className="min-w-0 flex-1 bg-transparent font-sans text-[13px] text-ink outline-none placeholder:text-text-tertiary"
            />
          </label>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={`rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
                  filter === item.key
                    ? "border-fuchsia bg-fuchsia text-white"
                    : "border-line bg-paper text-text-secondary hover:border-fuchsia hover:text-fuchsia"
                }`}
              >
                {item.label}
                {item.key === "archived" && archivedCount > 0 && (
                  <span className="ml-1.5 opacity-70">{archivedCount}</span>
                )}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          <span>{visibleProjects.length} saved</span>
          <span>·</span>
          <span>{visibleProjects.filter((p) => p.done).length} ready</span>
          <span>·</span>
          <span>{visibleProjects.filter((p) => p.reacted_count > 0).length} with reactions</span>
          {archivedCount > 0 && (
            <>
              <span>·</span>
              <span>{archivedCount} archived</span>
            </>
          )}
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 font-sans text-[13px] text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-line bg-paper/60 p-6 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          Reading local clip history<span className="blink">_</span>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState hasProjects={projects.length > 0} filter={filter} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((project) => (
            <ProjectTile
              key={project.slug}
              project={project}
              opening={openingSlug === project.slug}
              busy={busySlug === project.slug}
              onOpen={() => void openProject(project.slug)}
              onOpenFolder={() => void openPath(project.root).catch((e) => setError(humanError(e)))}
              onArchive={() => void toggleArchived(project)}
              onDelete={() => setConfirmDelete(project)}
            />
          ))}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDelete
          project={confirmDelete}
          busy={busySlug === confirmDelete.slug}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void deleteProject(confirmDelete)}
        />
      )}
    </div>
  );
}

function ProjectTile({
  project,
  opening,
  busy,
  onOpen,
  onOpenFolder,
  onArchive,
  onDelete,
}: {
  project: ProjectLibrarySummary;
  opening: boolean;
  busy: boolean;
  onOpen: () => void;
  onOpenFolder: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const editedAt = formatDate(project.updated_at || project.created_at);
  const thumbSrc = project.cover_thumb_path ? convertFileSrc(project.cover_thumb_path) : null;
  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-paper-elev/70 transition-colors hover:bg-paper-elev ${
        project.archived ? "border-line/60 opacity-80 hover:border-fuchsia/40" : "border-line hover:border-fuchsia/60"
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={opening || busy}
        className="relative block aspect-[9/16] w-full overflow-hidden bg-ink text-left disabled:cursor-wait"
        title={opening ? "Opening…" : `Open ${project.source_filename}`}
      >
        {thumbSrc ? (
          <img src={thumbSrc} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-paper-warm/40 text-text-tertiary">
            {project.imported ? <Upload className="h-7 w-7" strokeWidth={1.8} /> : <Film className="h-7 w-7" strokeWidth={1.8} />}
          </div>
        )}
        {/* Bottom gradient + meta */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/95 via-ink/50 to-transparent p-3">
          <h3 className="line-clamp-2 font-display text-[13px] font-semibold leading-tight tracking-[-0.01em] text-white">
            {project.source_filename}
          </h3>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-white/70">
            {project.clips_count} clips · {editedAt}
          </p>
        </div>
        {/* Top-left status */}
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-ink/80 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-white/85 backdrop-blur-sm">
          {project.done ? "Ready" : "In progress"}
        </span>
        {/* Top-right state badges */}
        <span className="absolute right-2 top-2 inline-flex flex-col items-end gap-1">
          {project.archived && (
            <span className="inline-flex items-center gap-1 rounded-full bg-ink/80 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-white/85 backdrop-blur-sm">
              <Archive className="h-2.5 w-2.5" strokeWidth={2.4} />
              Archived
            </span>
          )}
          {project.reacted_count > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-fuchsia/85 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-white">
              <WandSparkles className="h-2.5 w-2.5" strokeWidth={2.4} />
              {project.reacted_count}
            </span>
          )}
        </span>
      </button>

      {/* Action row */}
      <div className="flex items-center justify-between gap-1 border-t border-line bg-paper-warm/30 px-2 py-2">
        <button
          type="button"
          onClick={onOpenFolder}
          title={project.root}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-text-secondary hover:bg-fuchsia-soft/30 hover:text-fuchsia"
          aria-label="Open folder"
        >
          <FolderOpen className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={onArchive}
          disabled={busy}
          title={project.archived ? "Restore" : "Archive"}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-text-secondary hover:bg-fuchsia-soft/30 hover:text-fuchsia disabled:opacity-50"
          aria-label={project.archived ? "Restore" : "Archive"}
        >
          {project.archived ? <ArchiveRestore className="h-3.5 w-3.5" strokeWidth={2} /> : <Archive className="h-3.5 w-3.5" strokeWidth={2} />}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          title="Delete project + files on disk"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-text-secondary hover:bg-[#DC2626]/15 hover:text-[#DC2626] disabled:opacity-50"
          aria-label="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    </article>
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[420px] rounded-2xl border border-[#DC2626]/40 bg-paper p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#DC2626]/15 text-[#DC2626]">
            <Trash2 className="h-4 w-4" strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <h3 className="font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">
              Delete this project?
            </h3>
            <p className="mt-1 break-words font-sans text-[13px] leading-snug text-text-secondary">
              <span className="font-medium text-ink">{project.source_filename}</span> and{" "}
              <span className="font-mono text-[12px]">{project.clips_count}</span> clip
              {project.clips_count === 1 ? "" : "s"} will be removed from disk. This can't be undone.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full border border-line bg-paper px-4 py-2 font-sans text-[12px] font-medium text-text-secondary hover:border-fuchsia hover:text-ink disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#DC2626] px-4 py-2 font-sans text-[13px] font-medium text-white hover:bg-[#B91C1C] disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
            {busy ? "Deleting…" : "Delete project"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ hasProjects, filter }: { hasProjects: boolean; filter: FilterKey }) {
  const labels: Record<FilterKey, { eyebrow: string; body: string }> = {
    all: { eyebrow: "library empty", body: "Generate or import clips once and they will appear here automatically." },
    ready: { eyebrow: "nothing ready", body: "No completed projects yet. Finish a run to see Ready clips here." },
    reacted: { eyebrow: "no reactions yet", body: "Add a reaction layout to a clip to see it land here." },
    imported: { eyebrow: "no uploads", body: "Imported clip packs appear here once you bring in MP4/MOV files." },
    rewards: { eyebrow: "no reward projects", body: "Start work on a Whop bounty and the project will surface here." },
    archived: { eyebrow: "archive is empty", body: "Archived projects stay on disk but stay out of your default view." },
  };
  const msg = hasProjects ? labels[filter] : labels.all;
  return (
    <div className="rounded-2xl border border-line bg-paper/60 p-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
        {msg.eyebrow}
      </div>
      <p className="mt-2 max-w-[520px] font-sans text-[14px] leading-relaxed text-text-secondary">
        {msg.body}
      </p>
    </div>
  );
}

function formatDate(value: number) {
  if (!value) return "Unknown date";
  const ms = value > 10_000_000_000 ? value : value * 1000;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}
