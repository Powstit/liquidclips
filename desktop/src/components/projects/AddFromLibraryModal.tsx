// v0.7.77 Sprint 1 — Add from Library modal.
//
// Replaces the v0.7.76 inline 2-step picker (pick project → pick clips)
// for the Add-from-Library flow. The previous picker showed project rows
// while the user expected a clip grid — Daniel's hand-walk verdict on
// v0.7.76 was "Add from Library is broken." The fix is a one-step flat
// clip grid that surfaces Library clips directly, with thumbs, source
// labels, search, filter chips, and multi-select.
//
// Data:
//   On open, fetch `sidecar.listProjects(200, false)` then in parallel
//   `sidecar.getProject(slug)` for every non-archived project that has
//   clips and is not the current Project. Flatten into a single
//   ClipEntry[] sorted by source `updated_at desc`. Uses ONLY existing
//   sidecar RPCs — no IG-002 changes.
//
// Move flow is NOT handled here. Move is still served by the simplified
// inline picker inside ProjectDetail; Sprint 3 will extract it.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { CheckSquare, FileVideo, Search, Square, X } from "lucide-react";
import {
  humanError,
  sidecar,
  type Clip,
  type ProjectLibrarySummary,
} from "../../lib/sidecar";
import { addMembership } from "../../lib/projectMemberships";

type LibraryFilter = "earn" | "manual" | "imports";

type ClipEntry = {
  clip: Clip;
  sourceProject: ProjectLibrarySummary;
};

function clipDisplayPath(clip: Clip): string {
  return (
    clip.vertical_path ||
    clip.cut_path ||
    clip.square_path ||
    clip.portrait_path ||
    ""
  );
}

function clipThumbPath(clip: Clip): string | null {
  if (clip.thumbnails && clip.thumbnails.length > 0) {
    return clip.thumbnails[0].path;
  }
  return null;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function classifySource(p: ProjectLibrarySummary): "Earn" | "Manual" | "Import" {
  if (p.whop_bounty_id) return "Earn";
  if (p.imported) return "Import";
  return "Manual";
}

function entryId(e: ClipEntry): string {
  return `${e.sourceProject.slug}::${e.clip.slug}`;
}

export function AddFromLibraryModal({
  open,
  currentProjectSlug,
  currentProjectName,
  onClose,
  onAdded,
}: {
  open: boolean;
  currentProjectSlug: string;
  currentProjectName: string;
  onClose: () => void;
  /** Fires after a successful Add. The parent can refresh state or close
   *  the modal. The modal closes itself on success. */
  onAdded: (count: number) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<ClipEntry[]>([]);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Set<LibraryFilter>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [refetchTick, setRefetchTick] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // Reset state on close so the next open starts clean.
  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setQuery("");
      setFilters(new Set());
      setEntries([]);
      setError(null);
      setAdding(false);
      setRefetchTick(0);
    }
  }, [open]);

  // Fetch Library clips when modal opens (and on retry).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const { projects } = await sidecar.listProjects(200, false);
        if (cancelled) return;
        const candidates = projects.filter(
          (p) => p.slug !== currentProjectSlug && p.clips_count > 0,
        );
        const results = await Promise.all(
          candidates.map(async (summary) => {
            try {
              const { project } = await sidecar.getProject(summary.slug);
              return { summary, clips: project.clips || [] };
            } catch {
              return { summary, clips: [] as Clip[] };
            }
          }),
        );
        if (cancelled) return;
        const flat: ClipEntry[] = [];
        for (const { summary, clips } of results) {
          for (const clip of clips) {
            flat.push({ clip, sourceProject: summary });
          }
        }
        flat.sort((a, b) => {
          const ta =
            a.sourceProject.updated_at || a.sourceProject.created_at || 0;
          const tb =
            b.sourceProject.updated_at || b.sourceProject.created_at || 0;
          return tb - ta;
        });
        setEntries(flat);
      } catch (e) {
        if (!cancelled) setError(humanError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, currentProjectSlug, refetchTick]);

  // Focus search input on open.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open]);

  const visible = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return entries.filter(({ clip, sourceProject }) => {
      if (filters.size > 0) {
        const cls = classifySource(sourceProject);
        const filterMatch =
          (filters.has("earn") && cls === "Earn") ||
          (filters.has("manual") && cls === "Manual") ||
          (filters.has("imports") && cls === "Import");
        if (!filterMatch) return false;
      }
      if (trimmed) {
        const hay = [
          clip.title,
          clip.slug,
          sourceProject.whop_bounty_title,
          sourceProject.source_filename,
          sourceProject.slug,
          sourceProject.project_type,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(trimmed)) return false;
      }
      return true;
    });
  }, [entries, filters, query]);

  const toggleClip = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleFilter = useCallback((f: LibraryFilter) => {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }, []);

  const onAdd = useCallback(async () => {
    if (selected.size === 0 || adding) return;
    const toAttach = visible.filter((e) => selected.has(entryId(e)));
    if (toAttach.length === 0) return;
    setAdding(true);
    setError(null);
    try {
      let added = 0;
      for (const { clip, sourceProject } of toAttach) {
        const path = clipDisplayPath(clip);
        if (!path) continue;
        await addMembership({
          project_slug: currentProjectSlug,
          asset_type: "clip",
          asset_path: path,
          source_project_slug: sourceProject.slug,
          clip_id: clip.slug,
        });
        added += 1;
      }
      if (added > 0) {
        try {
          window.dispatchEvent(
            new CustomEvent("lc:toast", {
              detail: {
                kind: "info",
                message: `Added ${added} clip${added === 1 ? "" : "s"} to ${currentProjectName}.`,
              },
            }),
          );
        } catch {
          /* best-effort */
        }
      }
      onAdded(added);
      onClose();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setAdding(false);
    }
  }, [
    selected,
    adding,
    visible,
    currentProjectSlug,
    currentProjectName,
    onAdded,
    onClose,
  ]);

  // Keyboard shortcuts.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        if (!adding) onClose();
        return;
      }
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected((prev) => {
          const next = new Set(prev);
          for (const entry of visible) next.add(entryId(entry));
          return next;
        });
        return;
      }
      if (meta && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "Enter") {
        const active = document.activeElement;
        const inInput =
          active?.tagName === "INPUT" || active?.tagName === "TEXTAREA";
        if (!inInput && selected.size > 0 && !adding) {
          e.preventDefault();
          void onAdd();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, adding, visible, selected.size, onClose, onAdd]);

  const showInitialEmpty =
    !loading && !error && entries.length === 0;
  const showSearchEmpty =
    !loading &&
    !error &&
    entries.length > 0 &&
    visible.length === 0 &&
    query.trim().length > 0;
  const showFilterEmpty =
    !loading &&
    !error &&
    entries.length > 0 &&
    visible.length === 0 &&
    query.trim().length === 0 &&
    filters.size > 0;

  return (
    <AnimatePresence>
      {open && (
        <AddFromLibraryShell>
      {/* Header */}
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line/60 px-6 py-4">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-fuchsia">
            add from library
          </span>
          <h2 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-ink">
            Pick clips to attach to {currentProjectName}.
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={adding}
          aria-label="Close"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-transparent text-text-secondary transition-colors hover:border-fuchsia hover:text-ink disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      {/* Search + filters */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line/40 px-6 py-3">
        <div className="flex items-center gap-2 rounded-full border border-line bg-paper-elev/60 px-3 py-1.5">
          <Search
            className="h-3.5 w-3.5 text-text-tertiary"
            strokeWidth={2}
          />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search clips, projects…"
            spellCheck={false}
            className="w-[220px] bg-transparent font-mono text-[11px] text-ink placeholder:text-text-tertiary focus:outline-none"
          />
        </div>
        <FilterChip
          label="Earn"
          active={filters.has("earn")}
          onClick={() => toggleFilter("earn")}
        />
        <FilterChip
          label="Manual"
          active={filters.has("manual")}
          onClick={() => toggleFilter("manual")}
        />
        <FilterChip
          label="Imports"
          active={filters.has("imports")}
          onClick={() => toggleFilter("imports")}
        />
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
          {loading
            ? "loading…"
            : `${visible.length} of ${entries.length} clip${entries.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {error && (
          <div role="alert" className="error-banner mb-4">
            <span className="min-w-0 flex-1 truncate">
              Couldn&apos;t load Library: {error}
            </span>
            <button
              type="button"
              onClick={() => setRefetchTick((n) => n + 1)}
              className="btn-secondary"
            >
              Retry
            </button>
          </div>
        )}

        {loading && (
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            }}
          >
            {Array.from({ length: 12 }).map((_, i) => (
              <SkeletonTile key={i} />
            ))}
          </div>
        )}

        {showInitialEmpty && (
          <EmptyState
            title="No Library clips yet."
            sub="Capture or import your first clip in Workspace, then come back."
            cta={null}
          />
        )}

        {showSearchEmpty && (
          <EmptyState
            title={`No clips match "${query.trim()}".`}
            sub={null}
            cta={
              <button
                type="button"
                onClick={() => setQuery("")}
                className="btn-secondary"
              >
                Clear search
              </button>
            }
          />
        )}

        {showFilterEmpty && (
          <EmptyState
            title="No clips match these filters."
            sub={null}
            cta={
              <button
                type="button"
                onClick={() => setFilters(new Set())}
                className="btn-secondary"
              >
                Clear filters
              </button>
            }
          />
        )}

        {!loading && !error && visible.length > 0 && (
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            }}
          >
            {visible.map((entry) => {
              const id = entryId(entry);
              return (
                <ClipTile
                  key={id}
                  entry={entry}
                  selected={selected.has(id)}
                  onToggle={() => toggleClip(id)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Footer action bar */}
      <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-line/60 bg-paper-elev/40 px-8 py-4">
        <button
          type="button"
          onClick={onClose}
          disabled={adding}
          className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-paper px-6 font-sans text-sm font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia-deep disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void onAdd()}
          disabled={selected.size === 0 || adding}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-fuchsia px-6 font-sans text-sm font-semibold text-ink shadow-[var(--glow-md)] transition-all hover:bg-fuchsia-bright disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-fuchsia focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          {adding
            ? "Adding…"
            : selected.size === 0
              ? "Pick clips to add"
              : `Add ${selected.size} clip${selected.size === 1 ? "" : "s"} to ${currentProjectName} →`}
        </button>
      </footer>
        </AddFromLibraryShell>
      )}
    </AnimatePresence>
  );
}

/** v0.7.77 — Full-viewport modal shell with motion entry (backdrop blur
 *  fade + content fade-y) and exit via AnimatePresence. */
function AddFromLibraryShell({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col bg-paper/95 backdrop-blur-md"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
      transition={{
        duration: reduced ? 0.12 : 0.24,
        ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Add from Library"
    >
      {children}
    </motion.div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${
        active
          ? "border-fuchsia bg-fuchsia-soft/40 text-fuchsia-deep"
          : "border-line bg-transparent text-text-secondary hover:border-fuchsia hover:text-fuchsia-deep"
      }`}
    >
      {label}
    </button>
  );
}

function SkeletonTile() {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-line bg-paper-elev/30 p-2">
      <div className="skeleton aspect-video w-full rounded-xl" />
      <div className="skeleton h-3 w-3/4 rounded" />
      <div className="skeleton h-2 w-1/2 rounded" />
    </div>
  );
}

function EmptyState({
  title,
  sub,
  cta,
}: {
  title: string;
  sub: string | null;
  cta: ReactNode;
}) {
  return (
    <div className="empty-state mx-auto flex max-w-[420px] flex-col items-center gap-3 py-12 text-center">
      <p className="font-display text-[18px] font-semibold text-ink">{title}</p>
      {sub && (
        <p className="font-sans text-[13px] text-text-secondary">{sub}</p>
      )}
      {cta}
    </div>
  );
}

function ClipTile({
  entry,
  selected,
  onToggle,
}: {
  entry: ClipEntry;
  selected: boolean;
  onToggle: () => void;
}) {
  const [thumbError, setThumbError] = useState(false);
  const thumbRaw = clipThumbPath(entry.clip);
  const thumbSrc =
    thumbRaw && !thumbError ? convertFileSrc(thumbRaw) : null;
  const title =
    entry.clip.title ||
    basename(clipDisplayPath(entry.clip)) ||
    entry.clip.slug;
  const sourceTitle =
    entry.sourceProject.whop_bounty_title ||
    entry.sourceProject.source_filename ||
    entry.sourceProject.slug;
  const cls = classifySource(entry.sourceProject);

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={`group relative flex flex-col gap-2 rounded-2xl border p-2 text-left transition-all ${
        selected
          ? "border-fuchsia bg-fuchsia-soft/30"
          : "border-line bg-paper-elev/40 hover:border-fuchsia"
      }`}
    >
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
          <div className="flex h-full w-full items-center justify-center text-text-tertiary">
            <FileVideo className="h-6 w-6" strokeWidth={1.5} />
          </div>
        )}
        <div className="absolute left-1.5 top-1.5 rounded-md bg-paper/80 p-0.5 backdrop-blur-sm">
          {selected ? (
            <CheckSquare
              className="h-3.5 w-3.5 text-fuchsia"
              strokeWidth={2.4}
            />
          ) : (
            <Square
              className="h-3.5 w-3.5 text-text-tertiary group-hover:text-fuchsia"
              strokeWidth={2}
            />
          )}
        </div>
      </div>
      <div className="flex flex-col gap-0.5 px-1">
        <p
          className="line-clamp-1 font-sans text-[12px] font-medium text-ink"
          title={title}
        >
          {title}
        </p>
        <p
          className="line-clamp-1 font-mono text-[9px] uppercase tracking-[0.12em] text-text-tertiary"
          title={sourceTitle}
        >
          {sourceTitle}
        </p>
        <span
          className={`mt-0.5 inline-flex w-fit rounded-full px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em] ${
            cls === "Earn"
              ? "bg-fuchsia-soft/40 text-fuchsia-deep"
              : "bg-paper-elev/80 text-text-secondary"
          }`}
        >
          {cls}
        </span>
      </div>
    </button>
  );
}
