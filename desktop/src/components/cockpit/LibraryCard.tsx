// v0.7.32 — restored to the 11:00 screenshot reference (Daniel's "perfect example") after calm-wall drift. TL chip stack: pipeline_failed/Ready/In progress (first match) + Source missing eyebrow (if source_exists === false) + Imported · N (if imported). TR chip stack: Bounty + Archived + Reacted count (all stackable). Bottom meta overlay persistent at opacity-65, lifts to 100 on hover. Action row persistent at opacity-55, lifts to 100 on hover. Archived card opacity-70 at rest, full opacity on hover.
// Prior history: v0.7.8 L3+L5 (pipeline_failed/source_exists/whop_bounty), v0.7.7 #2a (imported pip), v0.6.38 (persistent overlay + action row), v0.6.36 (transparent fallback).
// v0.6.36 — LibraryCard.
//
// A single project tile on the Library wall. Transparent background, fuchsia
// HUD bracket corners at the four corners only (no full outline, no plate).
// The thumbnail fills the 9:16 frame. Filename + meta + action row fade in
// from the bottom on hover so the resting state reads as a wall of cinema
// stills, not a SaaS file grid.
//
// Cursor parallax + spring hover lift are inherited from the Cockpit root;
// this component only declares the tile-local micro-motion (whileHover /
// whileTap) and the hover-only overlay.

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Archive as ArchiveIcon,
  ArchiveRestore,
  Check,
  Edit3,
  FileWarning,
  FolderOpen,
  Layers,
  Trash2,
  Trophy,
  WandSparkles,
} from "lucide-react";
import type { ProjectLibrarySummary } from "../../lib/sidecar";
import libraryBugSprite from "../../assets/icons/connections/library-bug.png";

export function LibraryCard({
  project,
  opening,
  busy,
  selectMode,
  selected,
  onOpen,
  onEdit,
  onOpenFolder,
  onArchive,
  onDelete,
  onToggleSelect,
  index,
}: {
  project: ProjectLibrarySummary;
  opening: boolean;
  busy: boolean;
  selectMode: boolean;
  selected: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onOpenFolder: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onToggleSelect: () => void;
  /** Staggers the entry animation so the wall doesn't all spring in at
   *  once — feels alive, not robotic. Capped at 12 so a 200-project wall
   *  doesn't take 2 seconds to settle. */
  index: number;
}) {
  const reduced = useReducedMotion();
  const editedAt = formatDate(project.updated_at || project.created_at);
  // bug-hunt v0.7.18 — onError flips to true when the cover-thumb file is
  // missing (project archived, file moved, iCloud not downloaded). Falls
  // through to the existing bug-glyph fallback.
  const [thumbError, setThumbError] = useState(false);
  const thumbSrc = project.cover_thumb_path && !thumbError
    ? convertFileSrc(project.cover_thumb_path)
    : null;
  const cappedDelay = Math.min(index, 12) * 0.04;

  return (
    <motion.article
      layout
      layoutId={`lib-card-${project.slug}`}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.94 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.94 }}
      transition={
        reduced
          ? { duration: 0.16 }
          : { delay: cappedDelay, type: "spring", stiffness: 280, damping: 26 }
      }
      whileHover={
        reduced
          ? undefined
          : {
              y: -6,
              scale: 1.03,
              transition: { type: "spring", stiffness: 360, damping: 22 },
            }
      }
      className={`library-card group relative bg-transparent ${
        project.archived ? "opacity-70 hover:opacity-100" : ""
      } ${selected && selectMode ? "ring-2 ring-fuchsia rounded-xl" : ""}`}
      data-archived={project.archived ? "true" : "false"}
    >
      {/* Four HUD bracket corners — same dashed fuchsia language as the
          Workstation tiles, just smaller for the card scale. */}
      <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-br" />

      {selectMode && (
        <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5">
          <span
            className={`inline-flex h-5 w-5 items-center justify-center rounded border ${
              selected
                ? "border-fuchsia bg-fuchsia text-white"
                : "border-white/60 bg-black/40 text-white/70"
            }`}
          >
            {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={selectMode ? onToggleSelect : onOpen}
        disabled={opening || busy}
        className="relative block aspect-[9/16] w-full overflow-hidden rounded-xl bg-transparent text-left disabled:cursor-wait"
        title={opening ? "Opening…" : selectMode ? "Select" : `Open ${project.source_filename}`}
      >
        {thumbSrc ? (
          <img
            src={thumbSrc}
            alt=""
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
            draggable={false}
            onError={() => setThumbError(true)}
          />
        ) : (
          // v0.6.36 — Transparent fallback. The bug glyph floats fuchsia,
          // bobs subtly at rest, and lifts + intensifies on hover. Same
          // language as the Workstation tile glyphs.
          <div className="flex h-full w-full items-center justify-center bg-transparent">
            <img
              src={libraryBugSprite}
              alt=""
              className="library-card-bug h-14 w-14"
              draggable={false}
            />
          </div>
        )}

        {/* TL chip stack — hidden in select mode so the checkbox is unobstructed. */}
        {!selectMode && (
          <div className="pointer-events-none absolute left-2 top-2 flex flex-col gap-1">
            {project.pipeline_failed ? (
            <StatusChip danger>
              <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2.4} />
              Pipeline failed
            </StatusChip>
          ) : project.done ? (
            <StatusChip>Ready</StatusChip>
          ) : (
            <StatusChip dim>In progress</StatusChip>
          )}
          {project.source_exists === false && (
            <StatusChip dim>
              <FileWarning className="h-2.5 w-2.5" strokeWidth={2.4} />
              Source missing
            </StatusChip>
          )}
          {project.imported && (
            <StatusChip>
              <Layers className="h-2.5 w-2.5" strokeWidth={2.4} />
              Imported · {project.clips_count} clip{project.clips_count === 1 ? "" : "s"}
            </StatusChip>
          )}
          </div>
        )}
        {/* TR chip stack — 11:00 screenshot reference: stacked vertically.
            Whop bounty earns the bright glow slot (Earn flywheel is the
            highest-value signal). Archived chip carries the "this is in
            storage" semantic separately from card opacity. Reacted count
            shows the WandSparkles + count when the user has run reactions. */}
        <div className="pointer-events-none absolute right-2 top-2 flex flex-col items-end gap-1">
          {project.whop_bounty_id && (
            <span
              title={project.whop_bounty_title ?? "Whop Bounty"}
              className="pointer-events-auto"
            >
              <StatusChip glow>
                <Trophy className="h-2.5 w-2.5" strokeWidth={2.4} />
                {truncateBountyTitle(project.whop_bounty_title)}
              </StatusChip>
            </span>
          )}
          {project.archived && (
            <StatusChip>
              <ArchiveIcon className="h-2.5 w-2.5" strokeWidth={2.4} />
              Archived
            </StatusChip>
          )}
          {project.reacted_count > 0 && (
            <StatusChip glow>
              <WandSparkles className="h-2.5 w-2.5" strokeWidth={2.4} />
              {project.reacted_count}
            </StatusChip>
          )}
        </div>

        {/* Persistent meta overlay — 11:00 screenshot reference: filename +
            clip count + edited date visible at rest (opacity-65), full on
            hover. The calm-wall version hid this until hover; users prefer
            scanning the wall without hovering. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/95 via-ink/55 to-transparent p-3 opacity-65 transition-opacity duration-300 group-hover:opacity-100">
          <h3 className="line-clamp-2 font-display text-[13px] font-semibold leading-tight tracking-[-0.01em] text-white">
            {project.source_filename}
          </h3>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-white/70">
            {project.clips_count} clip{project.clips_count === 1 ? "" : "s"} · {editedAt}
          </p>
        </div>
      </button>

      {/* Persistent action row — hidden in select mode. */}
      {!selectMode && (
        <div className="library-card-actions absolute inset-x-1 bottom-1 flex items-center justify-end gap-1 opacity-55 transition-opacity duration-300 group-hover:opacity-100">
          <RingButton onClick={onEdit} disabled={busy} title="Open in workstation" ariaLabel="Edit">
            <Edit3 className="h-3.5 w-3.5" strokeWidth={2} />
          </RingButton>
          <RingButton onClick={onOpenFolder} title={project.root} ariaLabel="Open folder">
            <FolderOpen className="h-3.5 w-3.5" strokeWidth={2} />
          </RingButton>
          <RingButton
            onClick={onArchive}
            disabled={busy}
            title={project.archived ? "Restore" : "Archive"}
            ariaLabel={project.archived ? "Restore" : "Archive"}
          >
            {project.archived ? (
              <ArchiveRestore className="h-3.5 w-3.5" strokeWidth={2} />
            ) : (
              <ArchiveIcon className="h-3.5 w-3.5" strokeWidth={2} />
            )}
          </RingButton>
          <RingButton
            onClick={onDelete}
            disabled={busy}
            destructive
            title="Delete project + files on disk"
            ariaLabel="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          </RingButton>
        </div>
      )}
    </motion.article>
  );
}

function StatusChip({
  children,
  glow = false,
  dim = false,
  danger = false,
}: {
  children: React.ReactNode;
  glow?: boolean;
  dim?: boolean;
  /** v0.7.8 L3 — red destructive accent for "Pipeline failed". Matches the
   *  destructive Delete button's #DC2626 so the visual language of
   *  "something is broken" is consistent across the card. */
  danger?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] backdrop-blur-sm ${
        danger
          ? "bg-[var(--color-danger)]/85 text-white shadow-[0_0_18px_rgba(220,38,38,0.5)]"
          : glow
          ? "bg-fuchsia/85 text-white shadow-[0_0_18px_rgba(255,26,140,0.6)]"
          : dim
          ? "bg-paper/85 text-ink/60 shadow-[0_2px_8px_rgba(0,0,0,0.25)]"
          : "bg-paper/95 text-ink shadow-[0_3px_12px_rgba(0,0,0,0.4)]"
      }`}
    >
      {children}
    </span>
  );
}

/** v0.7.8 L5 — Truncate Whop bounty title to ~16 chars for the corner chip.
 *  Returns "Whop Bounty" when title is null/empty so the chip never shows
 *  a bare icon. Full title is preserved in the hover tooltip on the
 *  wrapping span. */
function truncateBountyTitle(title: string | null): string {
  if (!title || !title.trim()) return "Whop Bounty";
  const trimmed = title.trim();
  return trimmed.length > 16 ? `${trimmed.slice(0, 15)}…` : trimmed;
}

function RingButton({
  children,
  onClick,
  disabled,
  title,
  ariaLabel,
  destructive = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  ariaLabel: string;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full border bg-paper/70 backdrop-blur-md transition-colors ${
        destructive
          ? "border-line text-text-secondary hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
          : "border-line text-text-secondary hover:border-fuchsia hover:text-fuchsia"
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function formatDate(value: number) {
  if (!value) return "Unknown";
  const ms = value > 10_000_000_000 ? value : value * 1000;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}
