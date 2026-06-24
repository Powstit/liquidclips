// v0.7.77 Sprint 3 — Move-to-Project modal.
//
// Replaces the inline Move picker that used to share ProjectDetail's
// generic `pickerOpen` surface with the (now-retired) Add-from-Library
// picker. Move is destination-only: pick a target project + confirm.
// NO clip grid, NO source-of-truth selection, NO Library bridge — those
// belong to AddFromLibraryModal. This modal's job is to surface the
// list of projects the membership row can be moved to, and report back.
//
// Data:
//   On open, fetch `sidecar.listProjects(200, false)`. Filter out the
//   current Project so the user can't move a card to where it already
//   lives. Uses only existing RPCs — IG-002 untouched.
//
// Persistence:
//   This modal does NOT call moveMembership directly. It calls back to
//   the parent's onConfirm with the chosen ProjectLibrarySummary. The
//   parent owns the moveMembership write + the toast, so naming, error
//   handling, and post-move cleanup stay co-located with the source of
//   truth (membership state).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Search, X } from "lucide-react";
import {
  humanError,
  sidecar,
  type ProjectLibrarySummary,
} from "../../lib/sidecar";

export function MoveToProjectModal({
  open,
  filename,
  currentProjectSlug,
  onClose,
  onConfirm,
}: {
  open: boolean;
  /** The card's display filename — shown in the sub-copy and the toast.
   *  Falsy when the modal is closed; the modal renders nothing in that
   *  case so callers don't have to manage a placeholder. */
  filename: string | null;
  currentProjectSlug: string;
  onClose: () => void;
  /** Resolves once the parent has persisted the move. Modal closes on
   *  resolve; stays open on reject so the user can retry. */
  onConfirm: (target: ProjectLibrarySummary) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectLibrarySummary[]>([]);
  const [query, setQuery] = useState("");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refetchTick, setRefetchTick] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // Reset everything on close.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelectedSlug(null);
      setProjects([]);
      setError(null);
      setSubmitting(false);
      setRefetchTick(0);
    }
  }, [open]);

  // Fetch destination candidates on open / retry.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const { projects: list } = await sidecar.listProjects(200, false);
        if (cancelled) return;
        setProjects(list);
      } catch (e) {
        if (!cancelled) setError(humanError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, refetchTick]);

  // Focus the search input on open.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open]);

  const candidates = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return projects
      .filter((p) => p.slug !== currentProjectSlug)
      .filter((p) => {
        if (!trimmed) return true;
        const hay = [
          p.whop_bounty_title,
          p.source_filename,
          p.slug,
          p.project_type,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(trimmed);
      });
  }, [projects, currentProjectSlug, query]);

  const selectedTarget = useMemo(
    () => candidates.find((p) => p.slug === selectedSlug) ?? null,
    [candidates, selectedSlug],
  );

  const targetName = selectedTarget
    ? selectedTarget.whop_bounty_title ||
      selectedTarget.source_filename ||
      selectedTarget.slug
    : null;

  const onSubmit = useCallback(async () => {
    if (!selectedTarget || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(selectedTarget);
      // Parent closes; defensive close in case parent forgets.
      onClose();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setSubmitting(false);
    }
  }, [selectedTarget, submitting, onConfirm, onClose]);

  // Keyboard.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        if (!submitting) onClose();
        return;
      }
      if (e.key === "Enter") {
        const active = document.activeElement;
        const inInput =
          active?.tagName === "INPUT" || active?.tagName === "TEXTAREA";
        if (!inInput && selectedSlug && !submitting) {
          e.preventDefault();
          void onSubmit();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, selectedSlug, onClose, onSubmit]);

  const allProjectsCount = projects.filter(
    (p) => p.slug !== currentProjectSlug,
  ).length;
  const showInitialEmpty =
    !loading && !error && allProjectsCount === 0;
  const showSearchEmpty =
    !loading &&
    !error &&
    allProjectsCount > 0 &&
    candidates.length === 0 &&
    query.trim().length > 0;

  return (
    <AnimatePresence>
      {open && (
        <MoveModalShell onClose={() => { if (!submitting) onClose(); }}>
        {/* Header */}
        <header className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-fuchsia">
              move to project
            </span>
            <h2 className="font-display text-[20px] font-semibold tracking-[-0.02em] text-ink">
              Choose a destination
              {filename ? (
                <>
                  {" "}
                  for{" "}
                  <span className="text-fuchsia-deep" title={filename}>
                    {filename}
                  </span>
                  .
                </>
              ) : (
                "."
              )}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line bg-transparent text-text-secondary transition-colors hover:border-fuchsia hover:text-ink disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        {/* Search */}
        <div className="flex items-center gap-2 rounded-full border border-line bg-paper-elev/60 px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-text-tertiary" strokeWidth={2} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search projects…"
            spellCheck={false}
            className="flex-1 bg-transparent font-mono text-[11px] text-ink placeholder:text-text-tertiary focus:outline-none"
          />
        </div>

        {/* Body */}
        <div className="flex max-h-[320px] flex-col">
          {error && (
            <div role="alert" className="error-banner mb-3">
              <span className="min-w-0 flex-1 truncate">{error}</span>
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
            <div className="flex flex-col gap-1.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton h-8 rounded-lg" />
              ))}
            </div>
          )}

          {showInitialEmpty && (
            <EmptyState
              title="No other projects yet."
              sub="Create another Project first, then move this item into it."
              cta={null}
            />
          )}

          {showSearchEmpty && (
            <EmptyState
              title={`No projects match "${query.trim()}".`}
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

          {!loading && !error && candidates.length > 0 && (
            <div className="flex flex-col gap-1 overflow-y-auto">
              {candidates.map((p) => (
                <DestinationRow
                  key={p.slug}
                  project={p}
                  selected={selectedSlug === p.slug}
                  onSelect={() => setSelectedSlug(p.slug)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-paper px-6 font-sans text-sm font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia-deep disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={!selectedTarget || submitting}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-fuchsia px-6 font-sans text-sm font-semibold text-ink shadow-[var(--glow-md)] transition-all hover:bg-fuchsia-bright disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-fuchsia focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            {submitting
              ? "Moving…"
              : targetName
                ? `Move to ${targetName}`
                : "Pick a destination"}
          </button>
        </footer>
        </MoveModalShell>
      )}
    </AnimatePresence>
  );
}

/** v0.7.77 — Shared motion entry for the Move modal. */
function MoveModalShell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/85 p-4 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.1 : 0.18, ease: "easeOut" }}
      role="dialog"
      aria-modal="true"
      aria-label="Move to project"
      onClick={onClose}
    >
      <motion.div
        className="flex w-full max-w-[480px] flex-col gap-4 rounded-2xl border border-line bg-paper-warm p-5 shadow-e2"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
        transition={{
          duration: reduced ? 0.12 : 0.24,
          ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

function DestinationRow({
  project,
  selected,
  onSelect,
}: {
  project: ProjectLibrarySummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const name =
    project.whop_bounty_title || project.source_filename || project.slug;
  const cls = project.whop_bounty_id
    ? "Earn"
    : project.imported
      ? "Import"
      : project.project_type || "Manual";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left transition-colors ${
        selected
          ? "border-fuchsia bg-fuchsia-soft/30"
          : "border-transparent bg-transparent hover:border-fuchsia hover:bg-fuchsia-soft/20"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className={`inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full border ${
            selected
              ? "border-fuchsia bg-fuchsia"
              : "border-line bg-transparent"
          }`}
        >
          {selected && <span className="h-1 w-1 rounded-full bg-paper" />}
        </span>
        <span className="truncate font-sans text-[12px] text-ink">{name}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary">
        <span>
          {project.clips_count} clip{project.clips_count === 1 ? "" : "s"}
        </span>
        <span>{cls}</span>
      </span>
    </button>
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
    <div className="empty-state flex flex-col items-center gap-2 py-8 text-center">
      <p className="font-display text-[15px] font-semibold text-ink">{title}</p>
      {sub && <p className="font-sans text-[12px] text-text-secondary">{sub}</p>}
      {cta}
    </div>
  );
}
