// v0.6.36 — Library wall (cockpit pass).
//
// Replaces the v0.6.34 LibraryTab grid with a transparent wall of floating
// cards. Filter chips become HudChips, the stat strip becomes a quiet mono
// row in the top-right, and clicking a card just routes — the shared-element
// morph from tile to ResultsGrid is deferred to v0.7 once ResultsGrid grows
// a layoutId at its entry frame.
//
// Data fetching + filter / search / archive / delete logic lives on the
// caller (LibraryTab) so this component stays presentational — easier to
// reuse for any future "wall of things" surface.

import { LayoutGroup, AnimatePresence } from "motion/react";
import { RefreshCw, Search } from "lucide-react";
import type { ProjectLibrarySummary } from "../../lib/sidecar";
import { HudChip } from "./HudChip";
import { LibraryCard } from "./LibraryCard";

export type LibraryFilter = "all" | "ready" | "reacted" | "imported" | "rewards" | "archived";

export const LIBRARY_FILTERS: { key: LibraryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ready", label: "Ready" },
  { key: "reacted", label: "Reactions" },
  { key: "imported", label: "Uploads" },
  { key: "rewards", label: "Rewards" },
  { key: "archived", label: "Archived" },
];

export function LibraryWall({
  projects,
  filtered,
  filter,
  query,
  loading,
  error,
  openingSlug,
  busySlug,
  archivedCount,
  onFilterChange,
  onQueryChange,
  onRefresh,
  onOpen,
  onOpenFolder,
  onArchive,
  onDelete,
  onGoToWorkstation,
}: {
  projects: ProjectLibrarySummary[];
  filtered: ProjectLibrarySummary[];
  filter: LibraryFilter;
  query: string;
  loading: boolean;
  error: string | null;
  openingSlug: string | null;
  busySlug: string | null;
  archivedCount: number;
  onFilterChange: (next: LibraryFilter) => void;
  onQueryChange: (next: string) => void;
  onRefresh: () => void;
  onOpen: (slug: string) => void;
  onOpenFolder: (p: ProjectLibrarySummary) => void;
  onArchive: (p: ProjectLibrarySummary) => void;
  onDelete: (p: ProjectLibrarySummary) => void;
  onGoToWorkstation: () => void;
}) {
  const visibleProjects = projects.filter((p) => !p.archived);
  const stats = {
    saved: visibleProjects.length,
    ready: visibleProjects.filter((p) => p.done).length,
    reacted: visibleProjects.filter((p) => p.reacted_count > 0).length,
    archived: archivedCount,
  };

  return (
    <div className="library-wall flex w-full max-w-[1180px] flex-col gap-6 pt-2">
      {/* HUD strip — eyebrow + headline left, stats + refresh right. No card
          chrome. Everything sits directly on the cockpit. */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-fuchsia">library</span>
          <h1 className="font-display text-[28px] font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
            Previous edits.
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <StatStrip stats={stats} />
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-transparent text-text-secondary transition-colors hover:border-fuchsia hover:text-fuchsia disabled:opacity-50"
            aria-label="Refresh library"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} strokeWidth={2} />
          </button>
        </div>
      </header>

      {/* Filter + search row. Filters on the left as HudChips, search on the
          right as an inline pill. No card frame around either. */}
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {LIBRARY_FILTERS.map((item) => (
            <HudChip
              key={item.key}
              active={filter === item.key}
              onClick={() => onFilterChange(item.key)}
              trailing={item.key === "archived" && archivedCount > 0 ? `${archivedCount}` : null}
            >
              {item.label}
            </HudChip>
          ))}
        </div>
        <label className="flex min-w-[220px] items-center gap-2 rounded-full border border-line bg-transparent px-3 py-2 focus-within:border-fuchsia">
          <Search className="h-4 w-4 shrink-0 text-text-tertiary" strokeWidth={2} />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="search clips, rewards, filenames"
            className="min-w-0 flex-1 bg-transparent font-sans text-[13px] text-ink outline-none placeholder:text-text-tertiary"
          />
        </label>
      </section>

      {error && (
        <div className="rounded-2xl border border-[#DC2626]/30 bg-[#DC2626]/10 px-4 py-3 font-sans text-[13px] text-[#DC2626]">
          {error}
        </div>
      )}

      {/* The wall. LayoutGroup makes filter changes spring instead of jump. */}
      {loading ? (
        <LoadingState />
      ) : filtered.length === 0 ? (
        <EmptyState
          hasProjects={projects.length > 0}
          filter={filter}
          onGoToWorkstation={onGoToWorkstation}
        />
      ) : (
        <LayoutGroup id="library-wall">
          <div className="library-wall-grid grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            <AnimatePresence mode="popLayout">
              {filtered.map((project, idx) => (
                <LibraryCard
                  key={project.slug}
                  project={project}
                  opening={openingSlug === project.slug}
                  busy={busySlug === project.slug}
                  onOpen={() => onOpen(project.slug)}
                  onOpenFolder={() => onOpenFolder(project)}
                  onArchive={() => onArchive(project)}
                  onDelete={() => onDelete(project)}
                  index={idx}
                />
              ))}
            </AnimatePresence>
          </div>
        </LayoutGroup>
      )}
    </div>
  );
}

function StatStrip({
  stats,
}: {
  stats: { saved: number; ready: number; reacted: number; archived: number };
}) {
  return (
    <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
      <StatPill label="saved" value={stats.saved} accent />
      <span>·</span>
      <StatPill label="ready" value={stats.ready} />
      <span>·</span>
      <StatPill label="reactions" value={stats.reacted} />
      {stats.archived > 0 && (
        <>
          <span>·</span>
          <StatPill label="archived" value={stats.archived} />
        </>
      )}
    </div>
  );
}

function StatPill({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={`font-display text-[14px] font-bold leading-none tracking-[-0.02em] ${accent ? "text-fuchsia" : "text-ink"}`}>
        {value}
      </span>
      <span>{label}</span>
    </span>
  );
}

function LoadingState() {
  return (
    <div className="library-wall-loading relative grid place-items-center py-16 font-mono text-[11px] uppercase tracking-[0.18em] text-text-tertiary">
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
      Reading local clip history<span className="blink">_</span>
    </div>
  );
}

function EmptyState({
  hasProjects,
  filter,
  onGoToWorkstation,
}: {
  hasProjects: boolean;
  filter: LibraryFilter;
  onGoToWorkstation: () => void;
}) {
  const labels: Record<LibraryFilter, { eyebrow: string; body: string }> = {
    all: { eyebrow: "library empty", body: "Generate or import clips once and they'll land here automatically." },
    ready: { eyebrow: "nothing ready", body: "No completed projects yet. Finish a run to see Ready clips here." },
    reacted: { eyebrow: "no reactions yet", body: "Add a reaction layout to a clip to see it land here." },
    imported: { eyebrow: "no uploads", body: "Imported clip packs appear here once you bring in MP4 / MOV files." },
    rewards: { eyebrow: "no reward projects", body: "Start work on a Whop bounty and the project will surface here." },
    archived: { eyebrow: "archive is empty", body: "Archived projects stay on disk but stay out of your default view." },
  };
  const msg = hasProjects ? labels[filter] : labels.all;
  return (
    <div className="library-wall-empty relative mx-auto my-10 flex w-full max-w-[480px] flex-col items-start gap-4 px-8 py-8">
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
      <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia">{msg.eyebrow}</span>
      <p className="font-sans text-[14px] leading-relaxed text-text-secondary">{msg.body}</p>
      {filter !== "archived" && (
        <button
          type="button"
          onClick={onGoToWorkstation}
          className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-4 py-2 font-sans text-[12px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[0_8px_24px_rgba(255,26,140,0.45)]"
        >
          Go to Workstation →
        </button>
      )}
    </div>
  );
}
