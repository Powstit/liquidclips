// ship-lens v0.7.8 L3 + L5: LibraryCard stops pretending half-broken projects are healthy "In progress" tiles — `pipeline_failed` flips the chip to red "Pipeline failed" (failed wins over in-progress), `source_exists === false` raises a muted "Source missing" eyebrow, and `whop_bounty_id` adds a fuchsia "Whop Bounty" chip (truncated, full-title tooltip).
// ship-lens v0.7.7: fix #2a — imported packs render the same bug-glyph fallback as broken projects; add an "Imported · N clips" eyebrow + a distinct corner pip so the wall distinguishes the two states at a glance.
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

import { motion, useReducedMotion } from "motion/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Archive as ArchiveIcon,
  ArchiveRestore,
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
  onOpen,
  onOpenFolder,
  onArchive,
  onDelete,
  index,
}: {
  project: ProjectLibrarySummary;
  opening: boolean;
  busy: boolean;
  onOpen: () => void;
  onOpenFolder: () => void;
  onArchive: () => void;
  onDelete: () => void;
  /** Staggers the entry animation so the wall doesn't all spring in at
   *  once — feels alive, not robotic. Capped at 12 so a 200-project wall
   *  doesn't take 2 seconds to settle. */
  index: number;
}) {
  const reduced = useReducedMotion();
  const editedAt = formatDate(project.updated_at || project.created_at);
  const thumbSrc = project.cover_thumb_path ? convertFileSrc(project.cover_thumb_path) : null;
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
      }`}
      data-archived={project.archived ? "true" : "false"}
    >
      {/* Four HUD bracket corners — same dashed fuchsia language as the
          Workstation tiles, just smaller for the card scale. */}
      <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-br" />

      <button
        type="button"
        onClick={onOpen}
        disabled={opening || busy}
        className="relative block aspect-[9/16] w-full overflow-hidden rounded-xl bg-transparent text-left disabled:cursor-wait"
        title={opening ? "Opening…" : `Open ${project.source_filename}`}
      >
        {thumbSrc ? (
          <img
            src={thumbSrc}
            alt=""
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
            draggable={false}
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

        {/* Status chips — float at the corners, only visible when relevant. */}
        <div className="pointer-events-none absolute left-2 top-2 flex flex-col gap-1">
          {/* v0.7.8 L3 — `pipeline_failed` is the strongest of the three
              terminal states. Failed wins over "Ready" (a half-finished
              run that errored on reframe still has clips on disk but is
              not actually ready) and over "In progress" (a failure isn't
              a "waiting" state — the user needs to know it stopped). The
              chip's red accent matches the destructive Delete button so
              the visual language is consistent across "something is
              broken with this project." */}
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
          {/* v0.7.8 L3 — `source_exists === false` is a muted eyebrow, not
              a chip in the bright row, because it's an "FYI" state, not a
              "this is broken" state. The user moved the source file —
              clips on disk still play, but a re-run won't work. We render
              this BELOW the status chip so the priority ordering is:
              what's broken first, then what's missing on disk, then
              imported/archived metadata. `=== false` (not just falsy) so a
              v0.7.7 cached summary missing the field stays silent. */}
          {project.source_exists === false && (
            <StatusChip dim>
              <FileWarning className="h-2.5 w-2.5" strokeWidth={2.4} />
              Source missing
            </StatusChip>
          )}
          {/* v0.7.7 ship-lens fix #2a — imported packs land here without a
              `cover_thumb_path` (Project.create_imported_pack at
              python-sidecar/project.py:381 never writes one). Before this
              fix, the wall rendered the same bug-glyph fallback for
              imported-but-fine projects AND truly-broken projects, so
              Daniel couldn't tell them apart at a glance. The pip chip is
              persistent (not hover-only) so the distinction lands on the
              calm wall reading, not just under cursor. Agent B is
              generating real covers for imports in parallel; this badge
              stays even after covers ship — provenance is useful signal. */}
          {project.imported && (
            <StatusChip>
              <Layers className="h-2.5 w-2.5" strokeWidth={2.4} />
              Imported · {project.clips_count} clip{project.clips_count === 1 ? "" : "s"}
            </StatusChip>
          )}
        </div>
        <div className="pointer-events-none absolute right-2 top-2 flex flex-col items-end gap-1">
          {/* v0.7.8 L5 — Whop bounty chip. ProjectLibrarySummary already
              carries `whop_bounty_id` + `whop_bounty_title` from the
              sidecar (no extra hydration). Fuchsia accent (Liquid Clips
              brand) over the Whop trophy — bounty work is the Earn
              flywheel, so it earns the bright slot. Title is truncated to
              ~16 chars to keep the chip within the card width; the full
              title sits in the hover tooltip via `title` attribute on the
              wrapper span (StatusChip is presentational so we wrap it). */}
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

        {/* v0.6.38 — Persistent meta overlay (was hover-only). Always shows
            the filename + clip count + edited date at the bottom — better
            customer journey (you scan the wall without hovering) — but at
            a calm 65% opacity at rest so the wall still reads as cinema
            until you reach for one. Hover brings the overlay to full
            opacity + lifts the gradient. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/95 via-ink/55 to-transparent p-3 opacity-65 transition-opacity duration-300 group-hover:opacity-100">
          <h3 className="line-clamp-2 font-display text-[13px] font-semibold leading-tight tracking-[-0.01em] text-white">
            {project.source_filename}
          </h3>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-white/70">
            {project.clips_count} clip{project.clips_count === 1 ? "" : "s"} · {editedAt}
          </p>
        </div>
      </button>

      {/* v0.6.38 — Persistent action row at low opacity (was hover-only).
          Discoverable on the calm wall without hovering — Daniel's "simplicity
          + customer journey" call. Full opacity on hover. */}
      <div className="library-card-actions absolute inset-x-1 bottom-1 flex items-center justify-end gap-1 opacity-55 transition-opacity duration-300 group-hover:opacity-100">
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
          ? "bg-[#DC2626]/85 text-white shadow-[0_0_18px_rgba(220,38,38,0.5)]"
          : glow
          ? "bg-fuchsia/85 text-white shadow-[0_0_18px_rgba(255,26,140,0.6)]"
          : dim
          ? "bg-ink/70 text-white/60"
          : "bg-ink/80 text-white/85"
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
          ? "border-line text-text-secondary hover:border-[#DC2626] hover:text-[#DC2626]"
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
