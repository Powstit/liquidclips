/**
 * ResultsGrid · Phase 6C port
 *
 * Ported from desktop/src/components/ResultsGrid.tsx (760 LOC). Phase 6C
 * keeps the data model (clips, tabs, best-bits filter, multi-select) and
 * reduces the visual to Design OS GlassCards. AddClipCard + YouTubeView are
 * inlined here per Phase 6C step 8.
 *
 * Reads from a project (fixture by default) + the live engine session for
 * "the active job just finished" reveal animation.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { GlassCard } from "../components";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { bus, useEvent } from "../bridge";
import { ClipCard } from "./ClipCard";
import { BakeErrorStrip } from "./BakeErrorStrip";
import { sidecar } from "./sidecar-stub";
import { type Clip, type ProjectMeta } from "./types";
import { ClipQuickScheduleDrawer } from "../schedule";
import "./ResultsGrid.css";

type Tab = "clips" | "youtube" | "files";

export interface ResultsGridProps {
  /** Live project from useEngineSession, or null while still rendering. */
  project: ProjectMeta | null;
  /** When `project` is null and the pipeline is running, render this many
   *  skeleton "Rendering…" cards so the user can count clips landing live. */
  pendingCount?: number;
  /** Fires when the user requests "drop another" — host opens UploadPortal. */
  onDropAnother?: () => void;
  /** Fires when the user clicks a clip card to open the studio. */
  onOpenClip?: (clip: Clip) => void;
  /** Item 3 — reports the multi-select count up so the WorkstationFrame
   *  title bar can surface "Selected: N" without owning grid state. */
  onSelectionChange?: (count: number) => void;
}

export function ResultsGrid({
  project,
  pendingCount = 0,
  onDropAnother,
  onOpenClip,
  onSelectionChange,
}: ResultsGridProps) {
  const [tab, setTab] = useState<Tab>("clips");
  const [bestBitsOnly, setBestBitsOnly] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());

  // BUG-041 · "Generate more" was toast-only. Wire to sidecar.pickMoreClips
  // (the RPC exists; mock fallback emits engine:complete{kind:"pick"} after
  // ~1.2s). State machine mirrors the BUG-033 / BUG-034 pattern so the
  // harness grips data-generate-more-state.
  //
  // BUG-041 causal-proof note · useEvent only re-subscribes when the event
  // name changes — the handler closure captures `project` at the time it
  // ran. On first mount `project` is null (hydration lands later via the
  // bake-complete chain). Without a ref, the listener's `!project` check
  // would bail forever. projectRef tracks the latest value.
  const [generateMoreState, setGenerateMoreState] = useState<"idle" | "picking" | "done" | "error">("idle");
  const [generateMoreError, setGenerateMoreError] = useState<string | null>(null);
  const projectRef = useRef(project);
  useEffect(() => { projectRef.current = project; }, [project]);

  useEvent("engine:complete", (p) => {
    if (p.kind !== "pick") return;
    const proj = projectRef.current;
    if (!proj || p.slug !== proj.slug) return;
    setGenerateMoreState("done");
  });
  useEvent("engine:error", (p) => {
    if (p.kind !== "pick") return;
    const proj = projectRef.current;
    if (!proj || p.slug !== proj.slug) return;
    setGenerateMoreState("error");
    setGenerateMoreError(p.human ?? p.error ?? "Couldn't generate more clips");
  });
  useEffect(() => {
    if (generateMoreState !== "done") return;
    const t = window.setTimeout(() => setGenerateMoreState("idle"), 2400);
    return () => window.clearTimeout(t);
  }, [generateMoreState]);

  useEffect(() => {
    onSelectionChange?.(selected.size);
  }, [selected, onSelectionChange]);
  const [focused, setFocused] = useState<number | null>(null);
  const [scheduleClip, setScheduleClip] = useState<Clip | null>(null);

  const allClips = project?.clips ?? [];
  const visible = useMemo(() => {
    if (bestBitsOnly) return allClips.filter((c) => (c.score ?? 0) >= 70);
    return allClips;
  }, [allClips, bestBitsOnly]);
  // When the project hasn't hydrated yet but the engine is producing clips,
  // show pendingCount skeleton tiles so the surface visibly tracks progress.
  const skeletonSlots = project ? 0 : Math.max(0, pendingCount);
  const tabCountLabel = project
    ? allClips.length
    : skeletonSlots > 0 ? `${skeletonSlots}…` : "…";

  const toggleSel = (c: Clip) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(c.idx)) next.delete(c.idx); else next.add(c.idx);
      return next;
    });
  };

  return (
    <section className="lc-results">
      {/* Header · tabs + filter + counts */}
      <header className="lc-results-head">
        <nav className="lc-results-tabs" role="tablist">
          <TabBtn id="clips" active={tab === "clips"} onClick={() => setTab("clips")}>
            Clips · {tabCountLabel}
          </TabBtn>
          <TabBtn id="youtube" active={tab === "youtube"} onClick={() => setTab("youtube")}>
            YouTube
          </TabBtn>
          <TabBtn id="files" active={tab === "files"} onClick={() => setTab("files")}>
            Files
          </TabBtn>
        </nav>

        <div className="lc-results-actions">
          <label className="lc-results-toggle">
            <input
              type="checkbox"
              data-testid="best-bits-only"
              checked={bestBitsOnly}
              onChange={(e) => setBestBitsOnly(e.target.checked)}
            />
            <span>Best bits only</span>
          </label>
          {/* BUG-041 · "Generate more" wired to sidecar.pickMoreClips.
              Disabled when no project bound (nothing to pick from), when a
              pick is already in flight, or — honestly — when /me + tier
              source can't confirm the user has clips-per-campaign cap room.
              Cap-checking is the next station audit's problem; this fix
              only converts the toast-FAKE to a real RPC call. */}
          <button
            type="button"
            data-testid="generate-more"
            data-generate-more-state={generateMoreState}
            className="lc-results-action"
            disabled={!project || generateMoreState === "picking"}
            onClick={async () => {
              if (!project) return;
              setGenerateMoreState("picking");
              setGenerateMoreError(null);
              try {
                await sidecar.pickMoreClips(project.slug);
                // "done" transition lands via the engine:complete listener.
              } catch (e) {
                setGenerateMoreState("error");
                setGenerateMoreError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            {generateMoreState === "picking"
              ? "Generating more…"
              : generateMoreState === "done"
                ? "More clips landed ✓"
                : generateMoreState === "error"
                  ? "Retry generate"
                  : "Generate more"}
          </button>
          {generateMoreError && (
            <span
              data-testid="generate-more-error"
              style={{ fontSize: 11, color: "#ff7aa0", marginLeft: 8 }}
            >
              {generateMoreError}
            </span>
          )}
        </div>
      </header>

      {/* Bake error strip — visible only when an error event landed */}
      <BakeErrorStrip />

      {/* Body */}
      {tab === "clips" && (
        <div className="lc-results-grid">
          <AddClipCard onClick={onDropAnother} />
          {visible.map((clip) => (
            <EngineErrorBoundary
              key={clip.idx}
              route="engine"
              component="ClipCard"
              sessionId={`clip-${clip.idx}`}
            >
              <ClipCard
                clip={clip}
                selected={selected.has(clip.idx)}
                focused={focused === clip.idx}
                showSelection
                onSelect={toggleSel}
                onOpen={(c) => {
                  setFocused(c.idx);
                  onOpenClip?.(c);
                }}
                onSchedule={(c) => setScheduleClip(c)}
              />
            </EngineErrorBoundary>
          ))}
          {Array.from({ length: skeletonSlots }, (_, i) => (
            <RenderingCard key={`skeleton-${i}`} index={i + 1} />
          ))}
        </div>
      )}

      {tab === "youtube" && project && <YouTubeView project={project} />}
      {tab === "files" && project && <FilesView project={project} />}
      {(tab === "youtube" || tab === "files") && !project && (
        <GlassCard density="quiet" className="lc-results-yt">
          <p className="lc-results-files-sub">Available once clips finish rendering.</p>
        </GlassCard>
      )}

      {/* Selection footer */}
      {tab === "clips" && selected.size > 0 && (
        <footer className="lc-results-footer">
          <span className="lc-results-footer-eb">Selected</span>
          <span className="lc-results-footer-num">{selected.size}</span>
          <button
            type="button"
            className="lc-results-action"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </footer>
      )}

      {/* Phase 6J-C · clip quick-schedule handoff — disabled until project hydrates */}
      {project && (
        <EngineErrorBoundary route="engine" component="ClipQuickScheduleDrawer">
          <ClipQuickScheduleDrawer
            open={scheduleClip !== null}
            onClose={() => setScheduleClip(null)}
            clip={scheduleClip ? { idx: scheduleClip.idx, title: scheduleClip.title } : null}
            projectSlug={project.slug}
            onScheduled={() => {
              setScheduleClip(null);
              bus.emit("nav:click", { route: "schedule" });
            }}
          />
        </EngineErrorBoundary>
      )}
    </section>
  );
}

function RenderingCard({ index }: { index: number }) {
  return (
    <GlassCard density="quiet" className="lc-clip-card lc-clip-card-rendering" hoverLift={false}>
      <div className="lc-clip-card-skeleton">
        <span className="lc-clip-card-rendering-eb">Rendering</span>
        <span className="lc-clip-card-rendering-num">#{index}</span>
        <span className="lc-clip-card-rendering-pulse" aria-hidden="true" />
      </div>
    </GlassCard>
  );
}

function TabBtn({
  id, active, onClick, children,
}: { id: Tab; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-tab={id}
      className={`lc-results-tab ${active ? "is-active" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function AddClipCard({ onClick }: { onClick?: () => void }) {
  return (
    <GlassCard density="quiet" className="lc-add-clip" hoverLift>
      <button
        type="button"
        className="lc-add-clip-shell"
        onClick={onClick}
        aria-label="Drop another source"
      >
        <span className="lc-add-clip-plus" aria-hidden="true">+</span>
        <span className="lc-add-clip-eb">Source bay</span>
        <span className="lc-add-clip-body">Drop another</span>
        <span className="lc-add-clip-sub">Paste a link or pick a file</span>
      </button>
    </GlassCard>
  );
}

function YouTubeView({ project }: { project: ProjectMeta }) {
  // Transcript-first list view — read-only, no clipping affordances.
  return (
    <GlassCard density="default" className="lc-results-yt">
      <header className="lc-results-yt-head">
        <span className="lc-results-yt-eb">Transcript</span>
        <span className="lc-results-yt-title">{project.name}</span>
      </header>
      <ul className="lc-results-yt-list">
        {project.clips.map((c) => (
          <li key={c.idx} className="lc-results-yt-row">
            <span className="lc-results-yt-time">{formatTime(c.start)} – {formatTime(c.end)}</span>
            <span className="lc-results-yt-text">{c.title}</span>
            <span className="lc-results-yt-score">{c.score ?? "—"}</span>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

function FilesView({ project }: { project: ProjectMeta }) {
  return (
    <GlassCard density="default" className="lc-results-files">
      <header className="lc-results-yt-head">
        <span className="lc-results-yt-eb">Source files</span>
        <span className="lc-results-yt-title">{project.source_url ?? project.source_path ?? "—"}</span>
      </header>
      <p className="lc-results-files-sub">
        Duration: {project.duration_s ? `${Math.round(project.duration_s / 60)}m` : "—"} ·
        {" "}{project.clips.length} clips generated
      </p>
    </GlassCard>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
