// v0.7.75 — Projects tab.
//
// First-class organiser for workspaces around a goal. Library remains the
// casual outputs surface; Projects re-frames the same on-disk projects
// through a workspace lens with project-vocabulary filter chips (All / Earn
// / Manual / Imports / Archived), an "Organise your clips around campaigns,
// clients, and earning goals." headline, and an empty state that creates a
// blank project first — never a forced Library detour.

import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutGroup, AnimatePresence } from "motion/react";
import { FilePlus, Plus, RefreshCw, Search, X } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openSmart as openPath } from "../../lib/openSmart";
import { humanError, sidecar, type ProjectLibrarySummary } from "../../lib/sidecar";
import { addMembership } from "../../lib/projectMemberships";
import { HudChip } from "../cockpit/HudChip";
import { ProjectCard } from "./ProjectCard";
import { NewProjectModal } from "./NewProjectModal";
import { ProjectsLockedScreen } from "./ProjectsLockedScreen";

type ProjectsFilter = "all" | "earn" | "manual" | "imports" | "archived";

const PROJECTS_FILTERS: { key: ProjectsFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "earn", label: "Earn" },
  { key: "manual", label: "Manual" },
  { key: "imports", label: "Imports" },
  { key: "archived", label: "Archived" },
];

function applyFilter(p: ProjectLibrarySummary, filter: ProjectsFilter): boolean {
  if (filter === "archived") return p.archived;
  if (p.archived) return false;
  if (filter === "all") return true;
  if (filter === "earn") return !!p.whop_bounty_id;
  if (filter === "imports") return p.imported;
  if (filter === "manual") return !p.whop_bounty_id && !p.imported;
  return true;
}

function countFor(projects: ProjectLibrarySummary[], filter: ProjectsFilter): number {
  return projects.reduce((n, p) => n + (applyFilter(p, filter) ? 1 : 0), 0);
}

export type ProjectsTier = "free" | "solo" | "pro" | "agency" | null;

export function isProjectsUnlocked(tier: ProjectsTier): boolean {
  return tier === "pro" || tier === "agency";
}

// v0.7.73 — Top-level gate. Wraps the unlocked tab body so hooks order
// stays stable across tier changes (React rules-of-hooks: don't early-
// return after calling hooks).
export function ProjectsTab(props: {
  onOpenProjectDetail: (slug: string) => void;
  onGoToEarn: () => void;
  onGoToWorkstation: () => void;
  onGoToLibrary: () => void;
  onUpgrade: () => void;
  userTier: ProjectsTier;
}) {
  const unlocked = isProjectsUnlocked(props.userTier);
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log("[PROJECTS-GATE]", {
      userTier: props.userTier,
      unlocked,
      decision: unlocked ? "Projects manager" : "ProjectsLockedScreen",
    });
  }
  if (!unlocked) {
    return (
      <ProjectsLockedScreen
        onUpgrade={props.onUpgrade}
        onBrowseEarn={props.onGoToEarn}
        onOpenLibrary={props.onGoToLibrary}
      />
    );
  }
  return (
    <ProjectsTabUnlocked
      onOpenProjectDetail={props.onOpenProjectDetail}
      onGoToWorkstation={props.onGoToWorkstation}
    />
  );
}

function ProjectsTabUnlocked({
  onOpenProjectDetail,
  onGoToWorkstation,
}: {
  onOpenProjectDetail: (slug: string) => void;
  onGoToWorkstation: () => void;
}) {
  const [projects, setProjects] = useState<ProjectLibrarySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProjectsFilter>("all");
  // v0.7.73 — New Project modal lives at the tab level so its post-create
  // navigation can call onOpenProjectDetail without round-tripping through
  // App.tsx.
  const [newOpen, setNewOpen] = useState(false);
  // v0.7.75 — Top-level "Add file to Project" target picker.
  const [fileTargetPickerOpen, setFileTargetPickerOpen] = useState(false);
  // v0.7.76 F5 — Top-level "Add from Library" button was removed (the
  // canonical Add-from-Library lives inside ProjectDetail; the top-level
  // button just navigated to a Project, which was misleading). Library
  // picker state below kept only for the file-target picker.

  const loadProjects = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  // Same broadcast Library listens for — keep Projects in sync when a
  // workstation action (cover pick, archive, delete) writes to disk.
  useEffect(() => {
    function onRefresh(): void {
      void loadProjects();
    }
    window.addEventListener("lc:library-refresh", onRefresh);
    return () => window.removeEventListener("lc:library-refresh", onRefresh);
  }, [loadProjects]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects.filter((p) => {
      if (!applyFilter(p, filter)) return false;
      if (!needle) return true;
      const haystack = [
        p.whop_bounty_title,
        p.source_filename,
        p.slug,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [projects, query, filter]);

  const openProject = useCallback(
    (slug: string) => {
      // v0.7.72 — Projects routes through the Project Detail workspace,
      // NOT straight into results. Resume from Detail still goes to results.
      onOpenProjectDetail(slug);
    },
    [onOpenProjectDetail],
  );

  const openFolder = useCallback(async (p: ProjectLibrarySummary) => {
    try {
      await openPath(p.root);
    } catch (e) {
      setError(humanError(e));
    }
  }, []);

  const setArchived = useCallback(
    async (p: ProjectLibrarySummary, next: boolean) => {
      if (busySlug) return;
      setBusySlug(p.slug);
      try {
        await sidecar.setProjectArchived(p.slug, next);
        await loadProjects();
      } catch (e) {
        setError(humanError(e));
      } finally {
        setBusySlug(null);
      }
    },
    [busySlug, loadProjects],
  );

  const deleteProject = useCallback(
    async (p: ProjectLibrarySummary) => {
      if (busySlug) return;
      // v0.7.71 — Projects delete reuses the existing tombstone trio
      // (request → finalize) but skips the 5s undo toast Library has. A
      // confirmation modal here would be overkill for a release that ships
      // without "Manual" projects on-disk yet; Library still owns the rich
      // undo workflow for the casual lane.
      setBusySlug(p.slug);
      try {
        await sidecar.requestDeleteProject(p.slug);
        await sidecar.finalizeDeleteProject(p.slug);
        await loadProjects();
      } catch (e) {
        setError(humanError(e));
      } finally {
        setBusySlug(null);
      }
    },
    [busySlug, loadProjects],
  );

  // v0.7.75 — Top-level "Add file to Project". Picks a target project,
  // opens the OS file picker, writes membership rows, then opens the
  // project detail so the user sees the new files in Project Files.
  const onTopLevelAddFile = useCallback(async () => {
    if (projects.length === 0) {
      setNewOpen(true);
      return;
    }
    if (projects.length === 1) {
      const target = projects[0];
      await runAddFileToProject(target, openProject, setError, () => void loadProjects());
      return;
    }
    setFileTargetPickerOpen(true);
  }, [projects, openProject, loadProjects]);

  const onPickFileTarget = useCallback(
    async (target: ProjectLibrarySummary) => {
      setFileTargetPickerOpen(false);
      await runAddFileToProject(target, openProject, setError, () => void loadProjects());
    },
    [openProject, loadProjects],
  );

  const isEmpty = !loading && !error && projects.length === 0;
  const filteredIsEmpty = !loading && !error && projects.length > 0 && filtered.length === 0;

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-6 pt-2">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-fuchsia">
            projects
          </span>
          <h1 className="font-display text-[28px] font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
            Organise your clips around campaigns, clients, and earning goals.
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setNewOpen(true)} className="btn-primary">
            <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
            New Project
          </button>
          <button
            type="button"
            onClick={() => void onTopLevelAddFile()}
            disabled={loading}
            className="btn-secondary"
          >
            <FilePlus className="h-3.5 w-3.5" strokeWidth={2.2} />
            Add file
          </button>
          {/* v0.7.76 F5 — Top-level "Add from Library" removed. The
              canonical Add-from-Library flow lives INSIDE a Project
              Detail (open or create one first, then attach Library
              clips). The prior top-level button promised one thing and
              did another, which was the "Projects doesn't feel like an
              island" UX bug. */}
          <button
            type="button"
            onClick={() => void loadProjects()}
            disabled={loading}
            title="Refresh projects"
            aria-label="Refresh"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-transparent text-text-secondary transition-colors hover:border-fuchsia hover:text-fuchsia disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} strokeWidth={2} />
          </button>
        </div>
      </header>

      <NewProjectModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(createdSlug) => {
          setNewOpen(false);
          void loadProjects();
          onOpenProjectDetail(createdSlug);
        }}
      />

      {fileTargetPickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-paper/85 p-4 backdrop-blur-md"
          onClick={() => setFileTargetPickerOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Add file to project"
        >
          <div
            className="flex w-full max-w-[480px] flex-col gap-4 rounded-2xl border border-line bg-paper-warm p-5 shadow-e2"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-fuchsia">
                  add file
                </span>
                <h2 className="font-display text-[20px] font-semibold tracking-[-0.02em] text-ink">
                  Which project?
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setFileTargetPickerOpen(false)}
                aria-label="Close"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line bg-transparent text-text-secondary transition-colors hover:border-fuchsia hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </header>
            <div className="flex max-h-[320px] flex-col gap-1 overflow-y-auto">
              {projects.map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  onClick={() => void onPickFileTarget(p)}
                  className="flex items-center justify-between gap-2 rounded-lg border border-transparent bg-transparent px-3 py-2 text-left transition-colors hover:border-fuchsia hover:bg-fuchsia-soft/20"
                >
                  <span className="truncate font-sans text-[13px] text-ink">
                    {p.whop_bounty_title || p.source_filename || p.slug}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary">
                    {p.whop_bounty_id ? "Earn" : p.imported ? "Import" : (p.project_type || "Manual")}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* v0.7.76 F5 — library target picker removed alongside the
          misleading top-level Add-from-Library button. */}

      {error && (
        <div role="alert" className="error-banner">
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button
            type="button"
            onClick={() => void loadProjects()}
            className="btn-secondary"
          >
            Retry
          </button>
        </div>
      )}

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {PROJECTS_FILTERS.map((f) => {
          const count = countFor(projects, f.key);
          const active = filter === f.key;
          return (
            <HudChip key={f.key} active={active} onClick={() => setFilter(f.key)}>
              {f.label}
              <span
                className={`ml-1.5 font-mono text-[10px] ${
                  active ? "text-fuchsia-deep" : "text-text-tertiary"
                }`}
              >
                {count}
              </span>
            </HudChip>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <Search className="h-3.5 w-3.5 text-text-tertiary" strokeWidth={2} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            placeholder="search projects…"
            className="w-[180px] rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none"
          />
        </div>
      </div>

      {/* v0.7.76 F5 — Empty state: ONE primary CTA (Create a Project)
          + one quiet secondary (Import a clip). The earlier "Open Earn"
          button diluted the "Projects is an island" feel — Earn is its
          own tab in the sidebar, the empty state shouldn't fork to it. */}
      {isEmpty && (
        <div className="empty-state">
          <p className="font-display text-[18px] font-semibold text-ink">
            No projects yet.
          </p>
          <p className="mt-1 font-sans text-[13px] text-text-secondary">
            Create a Project to start organising clips, files, and campaigns inside this tab.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setNewOpen(true)}
              className="btn-primary"
            >
              Create a Project
            </button>
            <button
              type="button"
              onClick={onGoToWorkstation}
              className="btn-ghost"
            >
              or import a clip in Workspace
            </button>
          </div>
        </div>
      )}

      {filteredIsEmpty && (
        <div className="empty-state">
          <p className="font-sans text-[13px] text-text-secondary">
            No projects match this filter.
          </p>
        </div>
      )}

      {/* Card wall — ProjectCard differs from LibraryCard: type pill,
          RPM chip, status, Open + Open Folder + Archive + Delete actions. */}
      {!isEmpty && filtered.length > 0 && (
        <LayoutGroup>
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
          >
            <AnimatePresence mode="popLayout">
              {filtered.map((p, i) => (
                <ProjectCard
                  key={p.slug}
                  project={p}
                  index={i}
                  busy={busySlug === p.slug}
                  onOpen={() => openProject(p.slug)}
                  onOpenFolder={() => void openFolder(p)}
                  onArchive={() => void setArchived(p, !p.archived)}
                  onDelete={() => void deleteProject(p)}
                />
              ))}
            </AnimatePresence>
          </div>
        </LayoutGroup>
      )}
    </div>
  );
}

async function runAddFileToProject(
  target: ProjectLibrarySummary,
  openProject: (slug: string) => void,
  setError: (msg: string | null) => void,
  refresh: () => void,
): Promise<void> {
  try {
    const picked = await openDialog({
      multiple: true,
      directory: false,
      title: `Add file to ${target.source_filename || target.slug}`,
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    let added = 0;
    for (const p of paths) {
      if (typeof p !== "string" || !p) continue;
      await addMembership({
        project_slug: target.slug,
        asset_type: "external",
        asset_path: p,
      });
      added += 1;
    }
    if (added > 0) {
      refresh();
      try {
        window.dispatchEvent(
          new CustomEvent("lc:toast", {
            detail: {
              kind: "info",
              message: `Added ${added} file${added === 1 ? "" : "s"} to ${target.source_filename || target.slug}`,
            },
          }),
        );
      } catch {
        /* best-effort */
      }
      openProject(target.slug);
    }
  } catch (e) {
    setError(humanError(e));
  }
}
