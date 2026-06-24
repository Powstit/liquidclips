// v0.7.75 — Project Detail / workspace view.
//
// First-class workspace for a Project. Mounted at `view = { kind: "project",
// slug }`. Reads the full Project via `sidecar.getProject` and the attached
// assets via `useMemberships(slug)`. Renders:
//
//   1. Header — title (prefers whop_bounty_title), type pill, status badges,
//      Resume / Add file / Add from Library / Open Folder / Submit-if-bounty
//   2. Bounty context — only when whop_bounty_id is set; RPM, currency,
//      accepted platforms, "Open Whop brief" external link
//   3. Project Files — unified grid of project clips + attached assets with
//      thumbnails, metadata, and Reveal / Move / Remove actions
//   4. Drop zone — visible "Drop files here" target for Finder files
//   5. Tools hint — "Connect channels in Schedule → Channels" (no new auth)
//
// Keep it simple. Heavy editing happens in the existing results view via
// Resume; this surface is the campaign-context wrapper.

import { useCallback, useEffect, useMemo, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowLeft,
  ExternalLink,
  FileImage,
  FilePlus,
  FileVideo,
  File as FileIcon,
  FolderOpen,
  Layers,
  Play,
  Send,
} from "lucide-react";
import { openSmart } from "../../lib/openSmart";
import { humanError, sidecar, type Clip, type Project, type ProjectLibrarySummary } from "../../lib/sidecar";
import { Pill } from "../primitives";
import {
  addMembership,
  moveMembership,
  removeMembership,
  useMemberships,
  type ProjectMembership,
} from "../../lib/projectMemberships";
import { setDropTarget } from "../../lib/dropContext";
import { ProjectsLockedScreen } from "./ProjectsLockedScreen";
import { isProjectsUnlocked, type ProjectsTier } from "./ProjectsTab";
import { AddFromLibraryModal } from "./AddFromLibraryModal";
import { MoveToProjectModal } from "./MoveToProjectModal";

type ProjectType = "Earn" | "Manual" | "Import";

function classifyProject(project: Project): ProjectType {
  if (project.whop_bounty_id) return "Earn";
  if (project.clips.some((c) => c.imported)) return "Import";
  return "Manual";
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function formatDateTime(ms: number): string {
  if (!ms) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return "—";
  }
}

function clipDisplayPath(clip: Clip): string {
  return clip.vertical_path || clip.cut_path || clip.square_path || clip.portrait_path || "";
}

function clipThumbPath(clip: Clip): string | null {
  if (clip.thumbnails && clip.thumbnails.length > 0) {
    return clip.thumbnails[0].path;
  }
  return null;
}

function isImagePath(path: string): boolean {
  return /\.(jpg|jpeg|png|webp|gif|bmp|tiff?)$/i.test(path);
}

export function ProjectDetail(props: {
  slug: string;
  onBack: () => void;
  onResume: (project: Project) => void;
  userTier: ProjectsTier;
  onGoToEarn: () => void;
  onGoToLibrary: () => void;
  onUpgrade: () => void;
}) {
  // v0.7.73 — Tier gate. Mirrors ProjectsTab. Even direct deep-links
  // (e.g. user is mid-flow then plan downgrades) hit the locked screen.
  if (!isProjectsUnlocked(props.userTier)) {
    return (
      <ProjectsLockedScreen
        onUpgrade={props.onUpgrade}
        onBrowseEarn={props.onGoToEarn}
        onOpenLibrary={props.onGoToLibrary}
      />
    );
  }
  return <ProjectDetailUnlocked {...props} />;
}

function ProjectDetailUnlocked({
  slug,
  onBack,
  onResume,
}: {
  slug: string;
  onBack: () => void;
  onResume: (project: Project) => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // v0.7.77 Sprint 1 — Add from Library is its own full-viewport modal.
  const [addFromLibraryOpen, setAddFromLibraryOpen] = useState(false);
  // v0.7.77 Sprint 3 — Move-to-Project is its own modal. The membership
  // row to be moved is held here while the modal is open; null otherwise.
  // The modal owns destination-list fetching + selection state itself.
  const [moveRow, setMoveRow] = useState<ProjectMembership | null>(null);
  // v0.7.77 Sprint 2 V1 — track which drag source is hovering so the
  // drop zone can swap copy ("Tauri Finder drop — files become external
  // references." vs "Drop to attach to «Project»."). null = calm state.
  const [dragHover, setDragHover] = useState<"tauri" | "html5" | null>(null);
  const { memberships } = useMemberships(slug);

  // v0.7.73 — Register this Project as the active drop target whenever
  // Detail is mounted. The global Tauri file-drop listener in App.tsx
  // checks dropContext on every drop event and routes to addMembership
  // when a slug is registered.
  useEffect(() => {
    setDropTarget(slug);
    return () => setDropTarget(null);
  }, [slug]);

  // v0.7.76 F2 — Subscribe to Tauri's NATIVE drag events while this
  // Project is the active drop target so the visible dashed "Drop files
  // here" zone lights up on Finder drag-over. The HTML5 dragHover above
  // only flips on `application/x-liquidclips-asset` (Library card drag);
  // Finder drops go through `tauri://drag-drop` and previously had zero
  // pre-drop visual feedback. The drop itself already routes correctly
  // via `dropContext` → `addMembership` in App.tsx — this change is
  // visual only, no behaviour delta.
  useEffect(() => {
    const unEnter = listen("tauri://drag-enter", () => setDragHover("tauri"));
    const unLeave = listen("tauri://drag-leave", () => setDragHover(null));
    const unDrop = listen("tauri://drag-drop", () => setDragHover(null));
    return () => {
      void unEnter.then((un) => un());
      void unLeave.then((un) => un());
      void unDrop.then((un) => un());
    };
  }, []);

  // Toast auto-clear so the success message doesn't linger forever.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await sidecar.getProject(slug);
      setProject(r.project);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const type: ProjectType | null = useMemo(
    () => (project ? classifyProject(project) : null),
    [project],
  );

  const openFolder = useCallback(async () => {
    if (!project) return;
    setOpening(true);
    try {
      await openSmart(project.root);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setOpening(false);
    }
  }, [project]);

  const openBrief = useCallback(async () => {
    if (!project?.whop_bounty_url) return;
    try {
      await openExternal(project.whop_bounty_url);
    } catch (e) {
      setError(humanError(e));
    }
  }, [project]);

  const onRemoveMembership = useCallback(async (m: ProjectMembership) => {
    try {
      await removeMembership(m.project_slug, m.asset_path);
      // v0.7.77 Sprint 2 V7 — name the file + remind user the original
      // stays on disk. Removal is metadata-only.
      setToast(`Removed ${basename(m.asset_path)} — original still on disk.`);
    } catch (e) {
      setError(humanError(e));
    }
  }, []);

  // Add file — Tauri file dialog → membership rows (external asset_type).
  // Files are NOT copied (Hybrid Option C); ProjectDetail's "Reveal in
  // Finder" surfaces the real local path so the user can navigate to it.
  const onAddFile = useCallback(async () => {
    try {
      const picked = await openDialog({
        multiple: true,
        directory: false,
        title: "Add file to project",
      });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      // v0.7.77 Sprint 2 V7 — Per-row duplicate detection so the toast
      // can distinguish "Added X" from "X already attached — bumped to
      // top." addMembership is idempotent on (slug, path) and bumps
      // updated_at on a re-add. We detect fresh vs bumped by comparing
      // created_at to updated_at: a fresh row has them equal.
      let added = 0;
      let bumped = 0;
      let lastAddedFile = "";
      let lastBumpedFile = "";
      for (const p of paths) {
        if (typeof p !== "string" || !p) continue;
        const row = await addMembership({
          project_slug: slug,
          asset_type: "external",
          asset_path: p,
        });
        if (row.created_at === row.updated_at) {
          added += 1;
          lastAddedFile = basename(p);
        } else {
          bumped += 1;
          lastBumpedFile = basename(p);
        }
      }
      const total = added + bumped;
      if (total > 0) {
        const projectName =
          project?.whop_bounty_title || project?.source_filename || slug;
        if (total === 1) {
          if (added === 1) {
            setToast(`Added ${lastAddedFile} to ${projectName}.`);
          } else {
            setToast(`${lastBumpedFile} already attached — bumped to top.`);
          }
        } else if (bumped === 0) {
          setToast(`Added ${total} files to ${projectName}.`);
        } else if (added === 0) {
          setToast(`${total} files already attached — bumped to top.`);
        } else {
          setToast(
            `Added ${added} file${added === 1 ? "" : "s"} to ${projectName}, bumped ${bumped} existing.`,
          );
        }
      }
    } catch (e) {
      setError(humanError(e));
    }
  }, [slug, project]);

  // v0.7.76 F4 — Reveal must open the containing folder in Finder, not
  // open the file itself. Old code called openSmart(assetPath) which routes
  // to opener.openPath → that triggers macOS `open <file>` (Quick Look /
  // default player), NOT a Finder reveal. Canonical pattern lives in
  // ClipPreview.revealInFinder: split dirname, then openSmart(dir) so the
  // opener plugin opens the folder. Stays on openSmart (not shell.open)
  // because shell.open is scope-restricted to URL schemes — a /Users/...
  // path fails the regex.
  const revealAsset = useCallback(async (assetPath: string) => {
    try {
      if (!assetPath) {
        setError("No file path to reveal.");
        return;
      }
      const sep = assetPath.includes("\\") ? "\\" : "/";
      const idx = assetPath.lastIndexOf(sep);
      const dir = idx > 0 ? assetPath.slice(0, idx) : assetPath;
      await openSmart(dir);
    } catch (e) {
      setError(humanError(e));
    }
  }, []);

  const onMove = useCallback(
    async (m: ProjectMembership, target: ProjectLibrarySummary) => {
      await moveMembership(
        m.project_slug,
        target.slug,
        m.asset_path,
        m.asset_type,
        m.clip_id,
      );
      // v0.7.77 Sprint 2 V7 — name the file + target project.
      const targetName =
        target.whop_bounty_title || target.source_filename || target.slug;
      setToast(`Moved ${basename(m.asset_path)} to ${targetName}.`);
      setMoveRow(null);
    },
    [],
  );

  // v0.7.73 — HTML5 drag-drop landing zone. LibraryCard / ProjectCard set
  // a custom MIME `application/x-liquidclips-asset` on dragstart; this
  // handler decodes and routes to addMembership. Native Finder file drops
  // do NOT go through this path — those land via the Tauri file-drop
  // listener + dropContext (already registered on mount).
  const onDropFromCard = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragHover(null);
      const raw = e.dataTransfer.getData("application/x-liquidclips-asset");
      if (!raw) return;
      try {
        const payload = JSON.parse(raw) as {
          kind?: "library-clip";
          project_slug?: string;
          asset_path?: string;
          asset_type?: ProjectMembership["asset_type"];
          source_project_slug?: string;
          clip_id?: string;
        };
        if (!payload?.asset_path) return;

        let added = 0;

        // v0.7.77 — LibraryClipStrip drops a SINGLE clip. Take only this
        // clip; do not fan out to every clip in the source project.
        if (payload.kind === "library-clip" && payload.source_project_slug) {
          if (payload.source_project_slug === slug) return; // self-drop
          await addMembership({
            project_slug: slug,
            asset_type: "clip",
            asset_path: payload.asset_path,
            source_project_slug: payload.source_project_slug,
            clip_id: payload.clip_id,
          });
          added = 1;
        } else {
          // v0.7.75 — Dropping a whole Library project card (LibraryCard
          // or ProjectCard) adds every rendered clip as a separate
          // membership. Falls back to the dragged reference if 0 clips.
          const sourceSlug =
            payload.project_slug || payload.source_project_slug;
          if (sourceSlug && sourceSlug !== slug) {
            const { project: sourceProject } = await sidecar.getProject(sourceSlug);
            for (const clip of sourceProject.clips || []) {
              const path = clipDisplayPath(clip);
              if (!path) continue;
              await addMembership({
                project_slug: slug,
                asset_type: "clip",
                asset_path: path,
                source_project_slug: sourceSlug,
                clip_id: clip.slug,
              });
              added += 1;
            }
          }
          if (added === 0) {
            await addMembership({
              project_slug: slug,
              asset_type: payload.asset_type || "render",
              asset_path: payload.asset_path,
              source_project_slug: payload.source_project_slug,
              clip_id: payload.clip_id,
            });
            added = 1;
          }
        }
        // v0.7.77 Sprint 2 V7 — name the project + use "clip" (the
        // HTML5 drag path is Library-card only, always a clip).
        const projectName =
          project?.whop_bounty_title || project?.source_filename || slug;
        setToast(
          `Added ${added} clip${added === 1 ? "" : "s"} to ${projectName}.`,
        );
      } catch (err) {
        setError(humanError(err));
      }
    },
    [slug, project],
  );

  const projectFiles = useMemo(() => {
    const out: { kind: "clip"; clip: Clip }[] = [];
    if (project) {
      for (const clip of project.clips) {
        out.push({ kind: "clip", clip });
      }
    }
    return out;
  }, [project]);

  if (loading) {
    return (
      <div className="flex w-full max-w-[1080px] flex-col gap-4 pt-2">
        <BackButton onBack={onBack} />
        <div className="skeleton h-[120px] rounded-2xl border border-line" />
        <div className="skeleton h-[400px] rounded-2xl border border-line" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex w-full max-w-[1080px] flex-col gap-4 pt-2">
        <BackButton onBack={onBack} />
        <div role="alert" className="error-banner">
          <span className="min-w-0 flex-1">{error || "Project not found."}</span>
        </div>
      </div>
    );
  }

  const title = project.whop_bounty_title || project.source_filename || project.slug;
  const rpm =
    typeof project.whop_bounty_reward_per_unit === "number"
      ? project.whop_bounty_reward_per_unit
      : null;
  const currency = (project.whop_bounty_currency || "usd").toUpperCase();
  const platforms = project.whop_bounty_platforms || [];
  const isBounty = !!project.whop_bounty_id;
  const done = Object.values(project.stages ?? {}).some(
    (s) => (s as { status?: string })?.status === "done",
  );
  const totalFiles = projectFiles.length + memberships.length;
  // v0.7.77 Sprint 2 V5 — A Project is "blank" when it has no clips AND
  // no ingested source path. Drives the "Open Workspace" vs "Resume"
  // label swap. F1's App.tsx Resume handler already routes blank
  // projects to the workstation; this is the visible label change.
  const isBlankProject =
    project.clips.length === 0 &&
    (!project.source_path || project.source_path.length === 0);

  return (
    <div
      className={`mx-auto flex w-full max-w-6xl flex-col gap-8 px-8 pt-6 pb-10 transition-colors ${
        dragHover ? "outline outline-2 outline-offset-4 outline-fuchsia rounded-2xl bg-fuchsia-soft/10" : ""
      }`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-liquidclips-asset")) {
          e.preventDefault();
          setDragHover("html5");
        }
      }}
      onDragLeave={() => setDragHover(null)}
      onDrop={(e) => void onDropFromCard(e)}
    >
      <BackButton onBack={onBack} />

      {toast && (
        <div
          role="status"
          className="rounded-lg border border-fuchsia/30 bg-fuchsia-soft/20 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep"
        >
          {toast}
        </div>
      )}

      {/* Header — demo-pages.html workspace pattern: eyebrow + tight H1 mt-0.5 */}
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          <span>project</span>
          <span>·</span>
          <span className="text-fuchsia">{type}</span>
          {done && (
            <>
              <span>·</span>
              <span>done</span>
            </>
          )}
        </div>
        <h1 className="mt-0.5 font-display text-[26px] font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
          {title}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {rpm !== null && (
            <Pill tone="fuchsia">
              {currency} {rpm.toLocaleString()} / clip
            </Pill>
          )}
          <Pill tone="neutral">
            {project.clips.length} clip{project.clips.length === 1 ? "" : "s"}
          </Pill>
          {memberships.length > 0 && (
            <Pill tone="neutral">+{memberships.length} attached</Pill>
          )}
          {platforms.map((p) => (
            <Pill key={p} tone="neutral">
              {p}
            </Pill>
          ))}
        </div>

        {/* Actions — demo workspace hero CTAs (h-11 px-6 + shadow-glow-md on primary) */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => onResume(project)}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-fuchsia px-6 font-sans text-sm font-semibold text-ink shadow-[var(--glow-md)] transition-all hover:bg-fuchsia-bright focus-visible:ring-2 focus-visible:ring-fuchsia focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            <Play className="h-4 w-4" strokeWidth={2.2} />
            {/* v0.7.77 Sprint 2 V5 — "Resume" implies prior work; for
                blank Projects the discovery path is "Open Workspace". */}
            {isBlankProject ? "Open Workspace" : "Resume"}
          </button>
          <button
            type="button"
            onClick={() => void onAddFile()}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-paper px-6 font-sans text-sm font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia-deep"
          >
            <FilePlus className="h-4 w-4" strokeWidth={2.2} />
            Add file
          </button>
          <button
            type="button"
            onClick={() => setAddFromLibraryOpen(true)}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-paper px-6 font-sans text-sm font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia-deep"
          >
            <Layers className="h-4 w-4" strokeWidth={2.2} />
            Add from Library
          </button>
          <button
            type="button"
            onClick={() => void openFolder()}
            disabled={opening}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-transparent px-5 font-sans text-sm font-medium text-text-secondary transition-colors hover:text-ink disabled:opacity-50"
          >
            <FolderOpen className="h-4 w-4" strokeWidth={2.2} />
            Open folder
          </button>
          {isBounty && project.whop_bounty_url && (
            <button
              type="button"
              onClick={() => void openBrief()}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-transparent px-5 font-sans text-sm font-medium text-text-secondary transition-colors hover:text-ink"
            >
              <ExternalLink className="h-4 w-4" strokeWidth={2.2} />
              Open Whop brief
            </button>
          )}
          {isBounty && (
            <button
              type="button"
              onClick={() => onResume(project)}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-paper px-6 font-sans text-sm font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia-deep"
              title="Submit a clip — opens the project workstation where Submit lives."
            >
              <Send className="h-4 w-4" strokeWidth={2.2} />
              Submit clip
            </button>
          )}
        </div>
      </header>

      {/* Bounty context */}
      {isBounty && (
        <section className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
            earning context
          </span>
          <div className="rounded-2xl border border-fuchsia/30 bg-fuchsia-soft/15 p-4 font-sans text-[13px] text-ink">
            <p className="font-medium">
              Whop bounty {project.whop_bounty_id}
            </p>
            {project.whop_bounty_creator && (
              <p className="mt-1 text-text-secondary">
                by {project.whop_bounty_creator}
              </p>
            )}
            {project.whop_bounty_description && (
              <p className="mt-2 line-clamp-3 text-text-secondary">
                {project.whop_bounty_description}
              </p>
            )}
            {project.whop_bounty_spots_remaining !== null &&
              project.whop_bounty_spots_remaining !== undefined && (
                <p className="mt-2 font-mono text-[11px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
                  {project.whop_bounty_spots_remaining} spot
                  {project.whop_bounty_spots_remaining === 1 ? "" : "s"} remaining
                </p>
              )}
          </div>
        </section>
      )}

      {/* Source */}
      <section className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          source
        </span>
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-paper-elev/40 p-4">
          <FolderOpen className="h-4 w-4 text-text-tertiary" strokeWidth={2} />
          <div className="flex-1 min-w-0">
            <p className="truncate font-sans text-[13px] text-ink">
              {basename(project.source_path) || project.source_filename || "—"}
            </p>
            <p className="truncate font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
              {project.root}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void openFolder()}
            className="shrink-0 rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary transition-colors hover:border-fuchsia hover:text-fuchsia-deep"
          >
            Open
          </button>
        </div>
      </section>

      {/* Project Files */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
            project files ({totalFiles})
          </span>
          <span className="font-sans text-[12px] text-text-secondary">
            {projectFiles.length} created · {memberships.length} attached
          </span>
        </div>

        {/* v0.7.77 polish — demo-pages.html import drop zone hero treatment.
            Borrowed inline (no .hud-frame CSS class — index.css is owned
            by Lane 1). Pixel-invader landmark, big H2, mono caption,
            primary "Or pick a file" CTA wired to existing onAddFile.
            Copy: truthful — does NOT promise cross-tab Library drag. */}
        <div
          className={`relative flex min-h-[280px] flex-col items-center justify-center rounded-3xl border p-12 text-center transition-all ${
            dragHover
              ? "border-fuchsia/60 bg-fuchsia-soft/15 scale-[1.005]"
              : "border-fuchsia/20 bg-[rgba(255,26,140,0.04)]"
          }`}
          style={
            dragHover
              ? undefined
              : { backgroundImage: "radial-gradient(ellipse at top, rgba(255,26,140,0.07), transparent 70%)" }
          }
        >
          {/* Pixel-invader landmark (demo-pages.html line 521 — inline so no
              asset dependency). Uses fuchsia fill + drop-shadow glow. */}
          <svg
            viewBox="0 0 24 16"
            aria-hidden="true"
            className="mb-5 h-12 w-16 fill-fuchsia drop-shadow-[0_0_24px_rgba(255,26,140,0.55)]"
          >
            <rect x="3" y="2" width="2" height="2" />
            <rect x="19" y="2" width="2" height="2" />
            <rect x="5" y="4" width="14" height="2" />
            <rect x="3" y="6" width="2" height="2" />
            <rect x="7" y="6" width="2" height="2" />
            <rect x="15" y="6" width="2" height="2" />
            <rect x="19" y="6" width="2" height="2" />
            <rect x="3" y="8" width="18" height="2" />
            <rect x="5" y="10" width="2" height="2" />
            <rect x="9" y="10" width="6" height="2" />
            <rect x="17" y="10" width="2" height="2" />
            <rect x="1" y="12" width="2" height="2" />
            <rect x="7" y="12" width="2" height="2" />
            <rect x="15" y="12" width="2" height="2" />
            <rect x="21" y="12" width="2" height="2" />
          </svg>

          {dragHover === "tauri" ? (
            <>
              <h2 className="font-display text-[24px] font-semibold tracking-[-0.025em] text-fuchsia-deep">
                Drop here to attach to {title}
              </h2>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-fuchsia">
                files attach as references · originals stay where they are
              </p>
            </>
          ) : dragHover === "html5" ? (
            <>
              <h2 className="font-display text-[24px] font-semibold tracking-[-0.025em] text-fuchsia-deep">
                Drop to attach to {title}
              </h2>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-fuchsia">
                attaches as a reference to this Project
              </p>
            </>
          ) : (
            <>
              <h2 className="font-display text-[24px] font-semibold tracking-[-0.025em] text-ink">
                Drop files into this Project.
              </h2>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-fuchsia-deep">
                Any file attaches as a reference · originals stay where they are
              </p>
              <button
                type="button"
                onClick={() => void onAddFile()}
                className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-fuchsia px-6 font-sans text-sm font-semibold text-ink shadow-[var(--glow-md)] transition-all hover:bg-fuchsia-bright focus-visible:ring-2 focus-visible:ring-fuchsia focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              >
                <FilePlus className="h-4 w-4" strokeWidth={2.2} />
                Or pick a file
              </button>
              <button
                type="button"
                onClick={() => setAddFromLibraryOpen(true)}
                className="mt-3 font-sans text-[13px] text-text-secondary underline-offset-4 transition-colors hover:text-fuchsia-deep hover:underline"
              >
                Use Add from Library to pull existing clips into this Project
              </button>
            </>
          )}
        </div>

        {totalFiles === 0 ? (
          // v0.7.77 polish — demo workspace cockpit-tile pattern. Each
          // tile borrows demo-pages.html lines 462-498: library-card base
          // + HUD corners + big halo'd fuchsia icon + bold label + eyebrow.
          // Copy preserved per Daniel's approved/forbidden list; no
          // promise of cross-tab drag.
          <div className="flex flex-col gap-5">
            <p className="font-display text-[18px] font-semibold text-ink">
              This Project is empty. Three ways to fill it:
            </p>
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
            >
              <button
                type="button"
                onClick={() => onResume(project)}
                className="library-card group relative flex h-44 flex-col items-center justify-center gap-2 rounded-2xl bg-paper-warm p-5 text-center transition-all hover:bg-paper hover:shadow-[var(--glow-md)] focus-visible:ring-2 focus-visible:ring-fuchsia focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              >
                <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
                <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
                <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
                <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
                <Play
                  aria-hidden="true"
                  className="h-12 w-12 text-fuchsia drop-shadow-[0_8px_18px_rgba(255,26,140,0.45)]"
                  strokeWidth={1.5}
                />
                <p className="font-display text-sm font-semibold text-ink group-hover:text-fuchsia-deep">
                  Open Workspace
                </p>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                  paste a url or drop a video
                </p>
              </button>
              <button
                type="button"
                onClick={() => void onAddFile()}
                className="library-card group relative flex h-44 flex-col items-center justify-center gap-2 rounded-2xl bg-paper-warm p-5 text-center transition-all hover:bg-paper hover:shadow-[var(--glow-md)] focus-visible:ring-2 focus-visible:ring-fuchsia focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              >
                <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
                <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
                <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
                <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
                <FilePlus
                  aria-hidden="true"
                  className="h-12 w-12 text-fuchsia drop-shadow-[0_8px_18px_rgba(255,26,140,0.45)]"
                  strokeWidth={1.5}
                />
                <p className="font-display text-sm font-semibold text-ink group-hover:text-fuchsia-deep">
                  Add file
                </p>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                  pick a file from finder
                </p>
              </button>
              <button
                type="button"
                onClick={() => setAddFromLibraryOpen(true)}
                className="library-card group relative flex h-44 flex-col items-center justify-center gap-2 rounded-2xl bg-paper-warm p-5 text-center transition-all hover:bg-paper hover:shadow-[var(--glow-md)] focus-visible:ring-2 focus-visible:ring-fuchsia focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              >
                <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
                <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
                <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
                <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
                <Layers
                  aria-hidden="true"
                  className="h-12 w-12 text-fuchsia drop-shadow-[0_8px_18px_rgba(255,26,140,0.45)]"
                  strokeWidth={1.5}
                />
                <p className="font-display text-sm font-semibold text-ink group-hover:text-fuchsia-deep">
                  Add from Library
                </p>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                  pull existing clips in
                </p>
              </button>
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              or drop files anywhere on this Project
            </p>
          </div>
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}
          >
            {projectFiles.map((item) => (
              <ProjectFileCard
                key={`clip-${item.clip.slug}`}
                title={item.clip.title || basename(clipDisplayPath(item.clip)) || item.clip.slug}
                type="clip"
                path={clipDisplayPath(item.clip)}
                thumb={clipThumbPath(item.clip)}
                createdAt={null}
                sourceProject={null}
                onReveal={() => {
                  const p = clipDisplayPath(item.clip);
                  if (p) void revealAsset(p);
                }}
              />
            ))}
            {memberships.map((m) => (
              <ProjectFileCard
                key={`mem-${m.id}`}
                title={basename(m.asset_path)}
                type={m.asset_type}
                path={m.asset_path}
                thumb={isImagePath(m.asset_path) ? m.asset_path : null}
                createdAt={m.created_at}
                sourceProject={
                  m.source_project_slug && m.source_project_slug !== slug
                    ? m.source_project_slug
                    : null
                }
                onReveal={() => void revealAsset(m.asset_path)}
                onMove={() => setMoveRow(m)}
                onRemove={() => void onRemoveMembership(m)}
              />
            ))}
          </div>
        )}
      </section>

      {/* v0.7.77 Sprint 1 — Add from Library full-viewport modal. */}
      <AddFromLibraryModal
        open={addFromLibraryOpen}
        currentProjectSlug={slug}
        currentProjectName={title}
        onClose={() => setAddFromLibraryOpen(false)}
        onAdded={() => {
          // useMemberships listens for lc:memberships-changed and refreshes
          // the grid automatically. Toast fired inside the modal.
        }}
      />

      {/* v0.7.77 Sprint 3 — Move-to-Project modal. Destination-only.
          The modal fetches its own project list; onConfirm hands the
          chosen ProjectLibrarySummary back here, where onMove writes
          the move + dispatches the toast. Throws on failure so the
          modal can surface inline. */}
      <MoveToProjectModal
        open={moveRow !== null}
        filename={moveRow ? basename(moveRow.asset_path) : null}
        currentProjectSlug={slug}
        onClose={() => setMoveRow(null)}
        onConfirm={async (target) => {
          if (!moveRow) return;
          await onMove(moveRow, target);
        }}
      />

      {/* Tools hint — no new social auth */}
      <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
        connect channels in Schedule → Channels to publish from this project
      </p>
    </div>
  );
}

function ProjectFileCard({
  title,
  type,
  path,
  thumb,
  createdAt,
  sourceProject,
  onReveal,
  onMove,
  onRemove,
}: {
  title: string;
  type: ProjectMembership["asset_type"] | "clip";
  path: string | null;
  thumb: string | null;
  createdAt: number | null;
  sourceProject: string | null;
  onReveal: () => void;
  onMove?: () => void;
  onRemove?: () => void;
}) {
  const [thumbError, setThumbError] = useState(false);
  const thumbSrc = thumb && !thumbError ? convertFileSrc(thumb) : null;
  const FileGlyph = type === "clip" || type === "render" || type === "source" ? FileVideo : isImagePath(path || "") ? FileImage : FileIcon;

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-paper-elev/40 p-2 transition-colors hover:border-fuchsia">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-paper-deep">
        {thumbSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbSrc}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
            onError={() => setThumbError(true)}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-text-tertiary">
            <FileGlyph className="h-8 w-8" strokeWidth={1.5} />
            <span className="font-mono text-[9px] uppercase tracking-[0.12em]">{type}</span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-1">
        <p className="line-clamp-1 font-sans text-[12px] font-medium text-ink" title={title}>
          {title}
        </p>
        {path && (
          <p className="line-clamp-1 font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary" title={path}>
            {path}
          </p>
        )}
        {sourceProject && (
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-fuchsia-deep">
            from {sourceProject}
          </p>
        )}
        {createdAt && (
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary">
            added {formatDateTime(createdAt)}
          </p>
        )}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-1 px-1 pb-1">
        <button
          type="button"
          onClick={onReveal}
          className="rounded-full border border-line bg-transparent px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-text-secondary transition-colors hover:border-fuchsia hover:text-fuchsia-deep"
        >
          Reveal
        </button>
        {onMove && (
          <button
            type="button"
            onClick={onMove}
            className="rounded-full border border-line bg-transparent px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-text-secondary transition-colors hover:border-fuchsia hover:text-fuchsia-deep"
          >
            Move
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-full border border-line bg-transparent px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-text-secondary transition-colors hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary transition-colors hover:border-fuchsia hover:text-fuchsia-deep"
    >
      <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.2} />
      Back to Projects
    </button>
  );
}
