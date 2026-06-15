// v0.7.72 — ProjectCard.
//
// Workspace-vocabulary card used by ProjectsTab. Different from LibraryCard:
//   - leads with the project TYPE pill (Earn / Manual / Import) instead of a
//     filename
//   - shows the RPM chip when the project is Earn (whop_bounty_id set)
//   - status reads as a workspace state (in progress / done / failed /
//     archived) instead of the Library output-vocabulary
//   - clicking the card opens ProjectDetail (the workspace view), NOT
//     ResultsGrid
//   - exposes Open Folder + Archive + Delete inline; resume/edit lives on
//     the Detail page so the card stays focused
//
// Shares the cockpit visual language with LibraryCard (HUD bracket corners,
// fuchsia hover lift) so the Projects rail feels like part of the app, not
// a new design system.

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Archive, FolderOpen, Trash2 } from "lucide-react";
import type { ProjectLibrarySummary } from "../../lib/sidecar";
import { humanError, sidecar } from "../../lib/sidecar";
import { Pill } from "../primitives";
import { addMembership, useMemberships } from "../../lib/projectMemberships";

type ProjectType = "Earn" | "Manual" | "Content" | "Client" | "Import";

function classifySummary(p: ProjectLibrarySummary): ProjectType {
  // v0.7.73 — Explicit user-chosen project_type wins. Heuristic fallback
  // (whop_bounty_id → Earn, imported → Import, else Manual) covers
  // legacy projects + Earn projects (where project_type is unset).
  if (p.whop_bounty_id) return "Earn";
  const t = (p.project_type || "").trim();
  if (t === "Manual" || t === "Content" || t === "Client" || t === "Import") return t;
  if (p.imported) return "Import";
  return "Manual";
}

function formatDate(epoch: number | null | undefined): string {
  if (!epoch) return "";
  const d = new Date(epoch * 1000);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ProjectCard({
  project,
  index,
  busy,
  onOpen,
  onOpenFolder,
  onArchive,
  onDelete,
}: {
  project: ProjectLibrarySummary;
  index: number;
  busy: boolean;
  onOpen: () => void;
  onOpenFolder: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const reduced = useReducedMotion();
  const type = classifySummary(project);
  const editedAt = formatDate(project.updated_at || project.created_at);
  const [thumbError, setThumbError] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const { memberships } = useMemberships(project.slug);
  const attachedCount = memberships.length;
  const thumbSrc =
    project.cover_thumb_path && !thumbError
      ? convertFileSrc(project.cover_thumb_path)
      : null;

  // Auto-clear the ephemeral drop error so it doesn't persist on the card.
  useEffect(() => {
    if (!dropError) return;
    const id = window.setTimeout(() => setDropError(null), 3000);
    return () => window.clearTimeout(id);
  }, [dropError]);
  const cappedDelay = Math.min(index, 12) * 0.04;

  const title =
    project.whop_bounty_title || project.source_filename || project.slug;
  const rpm =
    typeof project.whop_bounty_reward_per_unit === "number"
      ? project.whop_bounty_reward_per_unit
      : null;
  const currency = (project.whop_bounty_currency || "usd").toUpperCase();

  const status: { label: string; tone: "fuchsia" | "neutral" | "danger" } =
    project.archived
      ? { label: "archived", tone: "neutral" }
      : project.pipeline_failed
        ? { label: "failed", tone: "danger" }
        : project.done
          ? { label: "done", tone: "fuchsia" }
          : { label: "in progress", tone: "neutral" };

  return (
    <motion.article
      layout
      layoutId={`proj-card-${project.slug}`}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.94 }}
      // v0.7.77 polish — iPhone Springboard drop affordance.
      // When a Library/Project card is dragged OVER this card, lift +
      // soft-fill fuchsia + thicker dashed outline so the card reads
      // "open folder, drop here". Otherwise: at rest.
      animate={
        reduced
          ? { opacity: 1 }
          : dropHover
            ? { opacity: 1, y: -10, scale: 1.04 }
            : { opacity: 1, y: 0, scale: 1 }
      }
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.94 }}
      transition={
        reduced
          ? { duration: 0.16 }
          : { delay: cappedDelay, type: "spring", stiffness: 280, damping: 26 }
      }
      whileHover={
        reduced || dropHover
          ? undefined
          : {
              y: -6,
              scale: 1.02,
              transition: { type: "spring", stiffness: 360, damping: 22 },
            }
      }
      className={`library-card group relative flex flex-col gap-3 bg-transparent p-5 transition-colors ${
        project.archived ? "opacity-70 hover:opacity-100" : ""
      } ${dropHover ? "outline outline-2 outline-offset-2 outline-fuchsia bg-fuchsia-soft/25 shadow-[var(--glow-md)]" : ""}`}
      data-archived={project.archived ? "true" : "false"}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-liquidclips-asset")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDropHover(true);
        }
      }}
      onDragLeave={() => setDropHover(false)}
      onDrop={(e) => {
        setDropHover(false);
        const raw = e.dataTransfer.getData("application/x-liquidclips-asset");
        if (!raw) return;
        e.preventDefault();
        void (async () => {
          try {
            const payload = JSON.parse(raw) as {
              kind?: "library-clip";
              project_slug?: string;
              asset_path?: string;
              asset_type?: "clip" | "render" | "source" | "external";
              source_project_slug?: string;
              clip_id?: string;
            };
            if (!payload?.asset_path) return;
            if (payload.source_project_slug === project.slug) return; // self-drop no-op

            let added = 0;

            // v0.7.77 — LibraryClipStrip drops a SINGLE clip. The whole-
            // project fallback below would otherwise add every clip from
            // the source project, which is wrong UX for a per-clip drag.
            if (payload.kind === "library-clip" && payload.source_project_slug) {
              await addMembership({
                project_slug: project.slug,
                asset_type: "clip",
                asset_path: payload.asset_path,
                source_project_slug: payload.source_project_slug,
                clip_id: payload.clip_id,
              });
              added = 1;
            } else {
              // v0.7.75 — Whole-project drop (LibraryCard, ProjectCard).
              // Adds every rendered clip as a separate membership.
              const sourceSlug =
                payload.project_slug || payload.source_project_slug;
              if (sourceSlug && sourceSlug !== project.slug) {
                added = await addClipsFromProject(sourceSlug, project.slug);
              }
              if (added === 0) {
                await addMembership({
                  project_slug: project.slug,
                  asset_type: payload.asset_type || "render",
                  asset_path: payload.asset_path,
                  source_project_slug: payload.source_project_slug,
                  clip_id: payload.clip_id,
                });
                added = 1;
              }
            }
            try {
              window.dispatchEvent(
                new CustomEvent("lc:toast", {
                  detail: {
                    kind: "info",
                    message: `Added ${added} item${added === 1 ? "" : "s"} to ${project.whop_bounty_title || project.source_filename || project.slug}`,
                  },
                }),
              );
            } catch {
              /* best-effort */
            }
          } catch (err) {
            const message = humanError(err);
            console.warn("[ProjectCard] drop failed:", message);
            setDropError(message);
            try {
              window.dispatchEvent(
                new CustomEvent("lc:toast", {
                  detail: { kind: "error", message: `Could not attach: ${message}` },
                }),
              );
            } catch {
              /* best-effort */
            }
          }
        })();
      }}
    >
      {/* HUD bracket corners — same chrome family as LibraryCard so the
          rail feels native, even though the content prioritises workspace
          framing over output thumbnails. */}
      <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-br" />

      {/* Eyebrow row — TYPE first, then status; the workspace identity
          beats the timestamp. */}
      <div className="flex items-center justify-between gap-2">
        <span
          className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] ${
            type === "Earn"
              ? "bg-fuchsia-soft/40 text-fuchsia-deep"
              : type === "Import"
                ? "border border-line/50 bg-paper-elev/80 text-text-secondary"
                : "bg-paper-elev/80 text-text-secondary"
          }`}
        >
          {type}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] ${
            status.tone === "fuchsia"
              ? "bg-fuchsia-soft/30 text-fuchsia-deep"
              : status.tone === "danger"
                ? "bg-[var(--color-danger)]/20 text-[var(--color-danger)]"
                : "bg-paper-elev/40 text-text-tertiary"
          }`}
        >
          {status.label}
        </span>
      </div>

      {/* Cover or placeholder */}
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        title="Open project workspace"
        className="group/cover relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-line bg-paper-elev/60 transition-colors hover:border-fuchsia disabled:opacity-60"
      >
        {thumbSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbSrc}
            alt=""
            onError={() => setThumbError(true)}
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
            no preview yet
          </div>
        )}
      </button>

      {/* Title + meta */}
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        className="text-left"
      >
        <p className="line-clamp-2 font-display text-[14px] font-semibold leading-tight tracking-[-0.01em] text-ink group-hover:text-fuchsia-deep">
          {title}
        </p>
      </button>

      <div className="flex flex-wrap items-center gap-1.5">
        {rpm !== null && (
          <Pill tone="fuchsia">
            {currency} {rpm.toLocaleString()}
          </Pill>
        )}
        <Pill tone="neutral">
          {project.clips_count} clip{project.clips_count === 1 ? "" : "s"}
        </Pill>
        {attachedCount > 0 && (
          <Pill tone="neutral">
            +{attachedCount} attached
          </Pill>
        )}
        {editedAt && (
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary">
            · {editedAt}
          </span>
        )}
      </div>

      {dropError && (
        <p className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-2.5 py-1 font-mono text-[10px] text-[var(--color-danger)]">
          {dropError}
        </p>
      )}

      {/* v0.7.73 — Goal/outcome line. Surfaced from project.json's `brief`
          via the summary's `goal` field so the card communicates intent at
          a glance, not just thumbnails + stats. */}
      {project.goal && (
        <p className="line-clamp-2 font-sans text-[12px] leading-snug text-text-secondary">
          {project.goal}
        </p>
      )}

      {/* Action rail — small + secondary; primary action is the card click. */}
      <div className="mt-auto flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onOpenFolder}
          title={project.root}
          aria-label="Open folder"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-text-secondary transition-colors hover:border-fuchsia hover:text-fuchsia-deep"
        >
          <FolderOpen className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={onArchive}
          title={project.archived ? "Unarchive" : "Archive"}
          aria-label={project.archived ? "Unarchive" : "Archive"}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-text-secondary transition-colors hover:border-fuchsia hover:text-fuchsia-deep"
        >
          <Archive className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          title="Delete project"
          aria-label="Delete project"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-text-secondary transition-colors hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    </motion.article>
  );
}

async function addClipsFromProject(sourceSlug: string, targetSlug: string): Promise<number> {
  try {
    const { project } = await sidecar.getProject(sourceSlug);
    const clips = project.clips || [];
    let added = 0;
    for (const clip of clips) {
      const path = clip.vertical_path || clip.cut_path || clip.square_path || clip.portrait_path;
      if (!path) continue;
      await addMembership({
        project_slug: targetSlug,
        asset_type: "clip",
        asset_path: path,
        source_project_slug: sourceSlug,
        clip_id: clip.slug,
      });
      added += 1;
    }
    return added;
  } catch (e) {
    console.warn("[ProjectCard] addClipsFromProject failed:", humanError(e));
    return 0;
  }
}


