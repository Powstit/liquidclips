/**
 * ComposerWorkbench · the 5-region industry-standard workbench.
 *
 * VSCode Workbench pattern + Fluent 2 base+content layering. Reduces the
 * old 14-surface Composer to exactly 5 coordinated regions:
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ TopBar (48px) · tier · status · account                  │
 *   ├──────┬─────────────────────────────────┬─────────────────┤
 *   │      │                                  │                 │
 *   │  A   │        Editor Canvas             │   Right Panel   │
 *   │  c   │        (fluid center)            │   (280px)       │
 *   │  t   │                                  │   summon-only   │
 *   │  i   │                                  │                 │
 *   │  v   │                                  │                 │
 *   │  i   │                                  │                 │
 *   │  t   │                                  │                 │
 *   │  y   │                                  │                 │
 *   │  Bar │                                  │                 │
 *   │  48  │                                  │                 │
 *   ├──────┴──────────────────────────────────┴────────────────┤
 *   │ Bottom Panel (Timeline · Trim · Captions · Reactions ·   │
 *   │               Audio) tabs                                 │
 *   ├──────────────────────────────────────────────────────────┤
 *   │ Status Bar (22px) · backend health · Kade · version      │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Design rules (LOCKED · see ComposerRoute.tsx IG-COMPOSER-REGIONS):
 *   L4 · Kade lives at the AppShell level (StickyKade summon-only).
 *        Workbench NEVER mounts its own KadeSpeechBubble / KadePanel.
 *   L6 · Dev-only surfaces (Base Window JSON · ASK TESTS · REMOTE
 *        ACTIVE pill) are gated behind `?dev=1` OR import.meta.env.DEV.
 *   L7 · Exactly ONE primary CTA · verb-first · "Get clips". Every
 *        secondary action (Trim · Captions · Reactions · Audio) is
 *        ghost-styled inside the Bottom Panel tabs.
 *
 * State comes from useComposerSession (shared across shells, survives
 * View-Transition swap). Actions dispatch via brain.handleSubmit so
 * voice / text / click / palette all converge on one intent lane.
 *
 * 2026-07-22 · Sprint composer-5-region
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useComposerSession } from "../../state/useComposerSession";
import { useMe } from "../../state/useMe";
import { bus } from "../../bridge/events";
import type { ComposerBrain } from "../useComposerBrain";
import "./ComposerWorkbench.css";

// Turn a sidecar-emitted absolute path into a WebView-loadable URL.
function toClipSrc(path: string | null | undefined): string | null {
  if (!path) return null;
  try { return convertFileSrc(path); } catch { return null; }
}

// One primary CTA verb — "Get clips" — is the ONLY submit path exposed
// as the workbench's primary action. Everything else is a tab or ghost.
const PRIMARY_CTA_COMMAND = "give me 3 clips";
const PRIMARY_CTA_LABEL = "Get clips";

type BottomTab = "timeline" | "trim" | "captions" | "reactions" | "audio";

const BOTTOM_TABS: ReadonlyArray<{ key: BottomTab; label: string; hint: string }> = [
  { key: "timeline",  label: "Timeline",  hint: "Scrub · beats · markers" },
  { key: "trim",      label: "Trim",      hint: "Tighten · silence" },
  { key: "captions",  label: "Captions",  hint: "Style · position · WPL" },
  { key: "reactions", label: "Reactions", hint: "Layout · slot · duck" },
  { key: "audio",     label: "Audio",     hint: "Ducking · track · mix" },
] as const;

const ACTIVITY_SECTIONS = [
  { key: "explorer",   label: "Explorer",   icon: <ActivityExplorerIcon />,   hint: "Library · footage · shots" },
  { key: "search",     label: "Search",     icon: <ActivitySearchIcon />,     hint: "Find clip in library" },
  { key: "campaigns",  label: "Campaigns",  icon: <ActivityCampaignsIcon />,  hint: "Briefs · bounties" },
  { key: "record",     label: "Record",     icon: <ActivityRecordIcon />,     hint: "Screen · camera · F2" },
  { key: "export",     label: "Export",     icon: <ActivityExportIcon />,     hint: "Ship · publish" },
] as const;

type ActivityKey = (typeof ACTIVITY_SECTIONS)[number]["key"];

interface Props {
  brain: ComposerBrain;
  /** True when parent computed the composer is engaged (post-submit).
   *  Idle canvas shows a hero prompt; engaged canvas shows clips + progress. */
  engaged: boolean;
  /** True when the user typed `?dev=1` OR import.meta.env.DEV is on. Gates
   *  Base Window JSON · ASK TESTS chips · REMOTE ACTIVE pill. */
  isDev: boolean;
}

/* IRON GATE IG-COMPOSER-REGIONS · workbench 5-region contract.
 *
 * The workbench MUST expose exactly 6 region testids so QA can walk the
 * layout tree and iron-gate the redesign against a slow slide back into
 * the old 14-surface bag. See lint-composer-regions.sh guards 5–7.
 *
 * See ComposerRoute.tsx sentinel for the full contract.
 */
export function ComposerWorkbench({ brain, engaged, isDev }: Props): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const command = useComposerSession((s) => s.command);
  const setCommand = useComposerSession((s) => s.setCommand);
  const history = useComposerSession((s) => s.history);
  const progress = useComposerSession((s) => s.progress);
  const clips = useComposerSession((s) => s.clips);
  const runError = useComposerSession((s) => s.runError);
  const lastReply = useComposerSession((s) => s.lastReply);
  const kadeMood = useComposerSession((s) => s.kadeMood);
  const awaitingSource = useComposerSession((s) => s.awaitingSource);
  const showUrlInput = useComposerSession((s) => s.showUrlInput);
  const setShowUrlInput = useComposerSession((s) => s.setShowUrlInput);
  const urlDraft = useComposerSession((s) => s.urlDraft);
  const setUrlDraft = useComposerSession((s) => s.setUrlDraft);
  const activeSlug = useComposerSession((s) => s.activeSlug);
  const lastIntentStatus = useComposerSession((s) => s.lastIntentStatus);
  const setShellOverride = useComposerSession((s) => s.setShellOverride);
  const clearSession = useComposerSession((s) => s.clearSession);
  const sessionCtx = useComposerSession((s) => s.sessionCtx);

  const me = useMe();
  const tier: string = ((me as { tier?: string } | null | undefined)?.tier ?? "free") as string;
  const founder: boolean = Boolean((me as { founder_flag?: boolean } | null | undefined)?.founder_flag);
  const tierLabel = founder || tier === "agency" || tier === "agency_whitelabel" || tier === "autopilot" ? "AGENCY" : "FREE";

  const [activeActivity, setActiveActivity] = useState<ActivityKey | null>(null);
  const [bottomOpen, setBottomOpen] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<BottomTab>("timeline");
  const [rightOpen, setRightOpen] = useState<boolean>(false); // Kade Summonable · hidden by default
  const [paletteOpen, setPaletteOpen] = useState<boolean>(false);

  // IG-COMPOSER-CLIP-STRIP · 2026-07-23 · every clip in the array is
  // rendered · user can click any card to promote it to primary preview.
  // Previous bug: workbench read only clips[0] and never mapped the
  // array · user asked for 15 clips, saw 1. Discovered via remote
  // state.snapshot at 10:20am.
  const [selectedClipIdx, setSelectedClipIdx] = useState<number>(0);

  // ⌘K → command palette (Cursor pattern). Bottom Panel toggle: ⌘J.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.metaKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setBottomOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        setPaletteOpen(false);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 200);
    return () => window.clearTimeout(t);
  }, []);

  const submitCommand = (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    void brain.handleSubmit(q);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitCommand(command);
  };

  // IG-COMPOSER-CLIP-STRIP · primary = user-selected · defaults to clips[0]
  // when a new run finishes (via selectedClipIdx reset below).
  const primaryIdx = Math.max(0, Math.min(selectedClipIdx, clips.length - 1));
  const primaryClip = clips[primaryIdx];
  const primarySrc = toClipSrc(primaryClip?.vertical_path ?? null);
  // cover_path is sidecar-optional and not on the strict Clip type;
  // read it defensively so we get a poster when available.
  const primaryCover = toClipSrc(
    (primaryClip as unknown as { cover_path?: string | null } | undefined)?.cover_path ?? null,
  );

  // Reset the selected clip to 0 when a fresh run lands (clip 0 is
  // always the "top pick" from the LLM ranker).
  useEffect(() => {
    if (clips.length > 0 && selectedClipIdx >= clips.length) {
      setSelectedClipIdx(0);
    }
  }, [clips.length, selectedClipIdx]);

  const progressWidth = useMemo(() => {
    if (!progress) return 0;
    if (typeof progress.percent === "number") return Math.min(100, Math.max(0, progress.percent * 100));
    if (progress.segmentsTotal && progress.segmentsDone != null) {
      return Math.min(100, (progress.segmentsDone / progress.segmentsTotal) * 100);
    }
    return 6;
  }, [progress]);

  // ── Dev-only payload (Base Window JSON) — mounted ONLY when isDev.
  const baseWindowJson = useMemo(() => JSON.stringify({
    tier, founder, tierLabel, sessionCtx, activeSlug, progress,
    clipsCount: clips.length, awaitingSource, lastReply, kadeMood, lastIntentStatus,
  }, null, 2),
  [tier, founder, tierLabel, sessionCtx, activeSlug, progress, clips.length, awaitingSource, lastReply, kadeMood, lastIntentStatus]);

  return (
    <div className="lc-workbench" data-testid="composer-workbench" data-engaged={engaged ? "true" : "false"} data-dev={isDev ? "true" : "false"}>

      {/* ═══════════════ REGION 1 · TOP BAR (48px) ═══════════════ */}
      <header
        className="lc-wb-topbar"
        data-testid="composer-topbar"
        style={{ viewTransitionName: "hud" } as React.CSSProperties}
      >
        <div className="lc-wb-topbar-brand">
          Liquid <span>Clips</span>
        </div>
        <div className="lc-wb-topbar-status">
          <span className="lc-wb-topbar-tier-pill" data-tier={tierLabel.toLowerCase()}>
            {tierLabel === "AGENCY" ? "Agency · $99.99/mo" : "Free · 10 clips"}
          </span>
          <span className="lc-wb-topbar-project" title={activeSlug ?? "No project"}>
            {activeSlug ? `${activeSlug.slice(0, 24)}${activeSlug.length > 24 ? "…" : ""}` : "Untitled composition"}
          </span>
        </div>
        <div className="lc-wb-topbar-actions">
          <button
            type="button"
            className="lc-wb-topbar-btn"
            onClick={() => { clearSession(); setShellOverride("auto"); }}
            title="Clear session · returns to idle"
          >
            Clear
          </button>
          <button
            type="button"
            className="lc-wb-topbar-btn"
            data-active={rightOpen ? "true" : "false"}
            onClick={() => setRightOpen((v) => !v)}
            title="Toggle right panel · Kade summon"
            aria-pressed={rightOpen}
          >
            Kade
          </button>
        </div>
      </header>

      {/* ═══════════════ MIDDLE ROW · Activity + Canvas + Right ═══════════════ */}
      <div className="lc-wb-middle">

        {/* ═══════════════ REGION 2 · ACTIVITY BAR (48px) ═══════════════ */}
        <nav
          className="lc-wb-activitybar"
          data-testid="composer-activitybar"
          aria-label="Composer activity bar"
          style={{ viewTransitionName: "nav-rail" } as React.CSSProperties}
        >
          {ACTIVITY_SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              className="lc-wb-activity-btn"
              data-active={activeActivity === s.key ? "true" : "false"}
              data-testid={`composer-activity-${s.key}`}
              aria-label={`${s.label} · ${s.hint}`}
              onClick={() => setActiveActivity(activeActivity === s.key ? null : s.key)}
              title={s.hint}
            >
              <span className="lc-wb-activity-icon" aria-hidden="true">{s.icon}</span>
              <span className="lc-wb-activity-label">{s.label}</span>
            </button>
          ))}
        </nav>

        {/* ═══════════════ REGION 3 · EDITOR CANVAS (fluid) ═══════════════ */}
        <section
          className="lc-wb-canvas"
          data-testid="composer-canvas"
          aria-label="Editor canvas"
        >
          <div className="lc-wb-canvas-inner">

            {/* Hero prompt · idle state · no clip loaded yet */}
            {!engaged && !progress && clips.length === 0 && (
              <div className="lc-wb-canvas-idle">
                <img
                  className="lc-wb-canvas-hero"
                  style={{ viewTransitionName: "kade-avatar" } as React.CSSProperties}
                  src="/brand/kade/kade-canvas-hero.png"
                  alt=""
                  aria-hidden="true"
                />
                <div className="lc-wb-canvas-prompt">What are we cutting today?</div>
                <div className="lc-wb-canvas-hint">
                  Paste a URL, pick a file, or hit <kbd>{PRIMARY_CTA_LABEL}</kbd>.
                </div>
              </div>
            )}

            {/* Source-ask · when the brain requests a source before proceeding */}
            {awaitingSource && (
              <div className="lc-wb-canvas-source-ask" data-testid="composer-source-ask">
                <div className="lc-wb-canvas-source-title">Where's the source?</div>
                <div className="lc-wb-canvas-source-row">
                  <button
                    type="button"
                    className="lc-wb-source-btn"
                    onClick={brain.pickFile}
                    data-testid="composer-source-pick-file"
                  >
                    Pick a file
                  </button>
                  <button
                    type="button"
                    className="lc-wb-source-btn"
                    onClick={() => setShowUrlInput(!showUrlInput)}
                    data-testid="composer-source-paste-url"
                  >
                    Paste URL
                  </button>
                </div>
                {showUrlInput && (
                  <form
                    className="lc-wb-source-url-form"
                    onSubmit={(e) => { e.preventDefault(); brain.submitUrl(); }}
                  >
                    <input
                      type="url"
                      className="lc-wb-source-url-input"
                      placeholder="https://youtube.com/watch?v=…"
                      value={urlDraft}
                      onChange={(e) => setUrlDraft(e.target.value)}
                      autoFocus
                    />
                    <button type="submit" className="lc-wb-source-btn">Go</button>
                  </form>
                )}
              </div>
            )}

            {/* Progress · in-flight sidecar work */}
            {progress && (
              <div className="lc-wb-canvas-progress" data-testid="composer-progress">
                <div className="lc-wb-canvas-progress-eyebrow">
                  {progress.stage.toUpperCase()}
                  {progress.note ? ` · ${progress.note.slice(0, 60)}` : ""}
                  {progress.segmentsTotal && progress.segmentsDone != null
                    ? ` · ${progress.segmentsDone} of ${progress.segmentsTotal}`
                    : ""}
                </div>
                <div className="lc-wb-canvas-progress-bar">
                  <div className="lc-wb-canvas-progress-fill" style={{ width: `${progressWidth}%` }} />
                </div>
              </div>
            )}

            {/* Error surface — visible when a run failed and clips are empty */}
            {runError && !progress && clips.length === 0 && (
              <div className="lc-wb-canvas-error" data-testid="composer-error">
                {runError}
              </div>
            )}

            {/* Clip preview · engaged state · shows the primary clip result */}
            {clips.length > 0 && (
              <div className="lc-wb-canvas-preview" data-has-video={primarySrc ? "true" : "false"}>
                {primarySrc ? (
                  <video
                    key={primaryClip?.idx ?? 0}
                    className="lc-wb-canvas-preview-video"
                    src={primarySrc}
                    poster={primaryCover ?? undefined}
                    controls
                    autoPlay
                    muted
                    playsInline
                    loop
                    data-testid="composer-canvas-video"
                  />
                ) : (
                  <div className="lc-wb-canvas-preview-fallback">
                    <div className="lc-wb-canvas-preview-title">{primaryClip?.title ?? "Preview"}</div>
                    <div className="lc-wb-canvas-preview-note">Preview available in the installed app.</div>
                  </div>
                )}
              </div>
            )}

            {/* IG-COMPOSER-CLIP-STRIP · 2026-07-23 · every clip in the array
                rendered as a card · click to promote to primary. Root cause
                of "asked for 15 got 1": workbench read only clips[0]. */}
            {clips.length > 0 && (
              <div
                className="lc-wb-clip-strip"
                data-testid="composer-clip-strip"
                aria-label={`${clips.length} clips ready`}
              >
                <div className="lc-wb-clip-strip-count">{clips.length} clips ready · click one to preview</div>
                <div className="lc-wb-clip-strip-cards" role="list">
                  {clips.map((c, i) => {
                    const src = toClipSrc(c.vertical_path ?? null);
                    const cover = toClipSrc(
                      (c as unknown as { cover_path?: string | null } | undefined)?.cover_path ?? null,
                    );
                    const active = i === primaryIdx;
                    const dur = Math.max(0, Math.round(((c as { end?: number } | undefined)?.end ?? 0) - ((c as { start?: number } | undefined)?.start ?? 0)));
                    return (
                      <button
                        key={i}
                        type="button"
                        className="lc-wb-clip-strip-card"
                        role="listitem"
                        data-testid={`composer-clip-card-${i}`}
                        data-active={active ? "true" : "false"}
                        data-has-video={src ? "true" : "false"}
                        onClick={() => setSelectedClipIdx(i)}
                        title={c.title ?? `Clip ${i + 1}`}
                        aria-pressed={active}
                      >
                        <div className="lc-wb-clip-strip-card-poster">
                          {cover ? (
                            <img src={cover} alt="" loading="lazy" />
                          ) : (
                            <div className="lc-wb-clip-strip-card-poster-fallback">
                              #{i + 1}
                            </div>
                          )}
                        </div>
                        <div className="lc-wb-clip-strip-card-meta">
                          <div className="lc-wb-clip-strip-card-title">
                            {c.title ?? `Clip ${i + 1}`}
                          </div>
                          <div className="lc-wb-clip-strip-card-sub">
                            {dur ? `${dur}s` : "clip"}
                            {active ? " · playing" : ""}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Primary CTA + command bar · one and only primary action.
              L7 · exactly ONE primary CTA testid across the workbench
              tree (see lint-composer-regions.sh guard 6). */}
          <form
            className="lc-wb-command"
            style={{ viewTransitionName: "composer-command-bar" } as React.CSSProperties}
            onSubmit={onSubmit}
          >
            <input
              ref={inputRef}
              type="text"
              className="lc-wb-command-input"
              placeholder="Tell Kade what to do…"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              autoComplete="off"
              spellCheck="false"
              aria-label="Command Kade"
              data-testid="composer-command"
            />
            <button
              type="button"
              className="lc-wb-command-primary"
              data-testid="composer-primary-cta"
              onClick={() => submitCommand(command.trim() || PRIMARY_CTA_COMMAND)}
              title={`Primary action · ${PRIMARY_CTA_LABEL}`}
            >
              {command.trim() ? "Send" : PRIMARY_CTA_LABEL}
              <span className="lc-wb-command-primary-arrow" aria-hidden="true">→</span>
            </button>
          </form>

          {lastIntentStatus && (
            <div
              className="lc-wb-wire-status"
              data-tone={lastIntentStatus.kind === "ok" ? "ok" : "fail"}
              data-testid="composer-wire-status"
            >
              {lastIntentStatus.kind === "ok"
                ? `Kade heard you · ${lastIntentStatus.action} · ${lastIntentStatus.ms}ms`
                : `Hosted LLM failed (${lastIntentStatus.message.slice(0, 60)}) · local fallback`}
            </div>
          )}
        </section>

        {/* ═══════════════ REGION 4 · RIGHT PANEL (280px) ═══════════════
            Kade summon-only per Cursor pattern · hidden by default.
            "Toggle right panel" in the topbar or ⌘K palette opens it. */}
        <aside
          className="lc-wb-rightpanel"
          data-testid="composer-rightpanel"
          data-open={rightOpen ? "true" : "false"}
          aria-label="Kade panel"
          style={{ viewTransitionName: "right-panel" } as React.CSSProperties}
        >
          {rightOpen && (
            <>
              <div className="lc-wb-rightpanel-head">
                <span className="lc-wb-rightpanel-eyebrow">KADE</span>
                <span className="lc-wb-rightpanel-mood" data-mood={kadeMood}>
                  {kadeMood.toUpperCase()}
                </span>
              </div>
              {lastReply && (
                <div className="lc-wb-rightpanel-reply" data-tone={lastReply.severity}>
                  <div className="lc-wb-rightpanel-reply-title">{lastReply.title}</div>
                  <div className="lc-wb-rightpanel-reply-body">{lastReply.body}</div>
                </div>
              )}
              {history.length > 0 && (
                <div className="lc-wb-rightpanel-history">
                  <div className="lc-wb-rightpanel-history-eyebrow">RECENT</div>
                  {history.slice(0, 5).map((cmd, i) => (
                    <button
                      key={`${cmd}-${i}`}
                      type="button"
                      className="lc-wb-rightpanel-history-chip"
                      onClick={() => submitCommand(cmd)}
                      title={cmd}
                    >
                      {cmd.slice(0, 36)}{cmd.length > 36 ? "…" : ""}
                    </button>
                  ))}
                </div>
              )}

              {/* L6 · Base Window JSON dev-panel · gated behind isDev.
                  Never renders in production customer builds. */}
              {isDev && (
                <div className="lc-wb-rightpanel-json" data-testid="composer-dev-json-panel" aria-label="Base Window JSON · dev">
                  <div className="lc-wb-rightpanel-json-eyebrow">DEV · BASE WINDOW</div>
                  <pre className="lc-wb-rightpanel-json-pre">{baseWindowJson}</pre>
                </div>
              )}
            </>
          )}
        </aside>
      </div>

      {/* ═══════════════ REGION 5 · BOTTOM PANEL (240px, resizable) ═══════════════
          All secondary editing surfaces live here as tabs · Timeline · Trim
          · Captions · Reactions · Audio. Each tab dispatches through
          brain.handleSubmit so voice / text / click converge. */}
      <section
        className="lc-wb-bottompanel"
        data-testid="composer-bottompanel"
        data-open={bottomOpen ? "true" : "false"}
        aria-label="Bottom panel"
      >
        <div className="lc-wb-bottompanel-tabs" role="tablist" aria-label="Editing tabs">
          {BOTTOM_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className="lc-wb-bottompanel-tab"
              role="tab"
              aria-selected={activeTab === tab.key}
              data-active={activeTab === tab.key ? "true" : "false"}
              data-testid={`composer-bottom-tab-${tab.key}`}
              onClick={() => { setActiveTab(tab.key); setBottomOpen(true); }}
              title={tab.hint}
            >
              {tab.label}
            </button>
          ))}
          <div className="lc-wb-bottompanel-spacer" />
          <button
            type="button"
            className="lc-wb-bottompanel-toggle"
            onClick={() => setBottomOpen((v) => !v)}
            aria-pressed={bottomOpen}
            aria-label={bottomOpen ? "Collapse bottom panel" : "Expand bottom panel"}
            title="Toggle bottom panel · ⌘J"
          >
            {bottomOpen ? "▾" : "▴"}
          </button>
        </div>
        {bottomOpen && (
          <div className="lc-wb-bottompanel-body" data-tab={activeTab}>
            <BottomTabBody tab={activeTab} onCommand={submitCommand} />
          </div>
        )}
      </section>

      {/* ═══════════════ REGION 6 · STATUS BAR (22px) ═══════════════ */}
      <footer
        className="lc-wb-statusbar"
        data-testid="composer-statusbar"
        aria-label="Status bar"
      >
        <span className="lc-wb-statusbar-item">
          <span className="lc-wb-statusbar-dot" data-mood={kadeMood} />
          Kade · {kadeMood}
        </span>
        <span className="lc-wb-statusbar-sep">·</span>
        <span className="lc-wb-statusbar-item">runtime 2.3.15</span>
        <span className="lc-wb-statusbar-sep">·</span>
        <span className="lc-wb-statusbar-item">
          {clips.length > 0 ? `${clips.length} clip${clips.length === 1 ? "" : "s"} ready` : engaged ? "working" : "idle"}
        </span>
        <span className="lc-wb-statusbar-spacer" />
        {/* L6 · REMOTE ACTIVE pill only in dev. Real remote-control status
            surface lives at #/remote-log for staff. */}
        {isDev && (
          <span className="lc-wb-statusbar-item lc-wb-statusbar-remote" data-testid="composer-dev-remote-pill">
            REMOTE ACTIVE
          </span>
        )}
        <span className="lc-wb-statusbar-item">v2.3</span>
      </footer>

      {/* ⌘K command palette · minimal, appears on top */}
      {paletteOpen && (
        <div className="lc-wb-palette" role="dialog" aria-label="Command palette" data-testid="composer-palette">
          <div className="lc-wb-palette-hint">Type a command · <kbd>Esc</kbd> to close</div>
          <form onSubmit={(e) => { e.preventDefault(); setPaletteOpen(false); submitCommand(command); }}>
            <input
              type="text"
              className="lc-wb-palette-input"
              placeholder="give me 3 clips · style captions bold · trim silences"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              autoFocus
            />
          </form>
        </div>
      )}

      {/* L6 · Dev-only ASK TESTS chip strip. Fires curated capability
          probes. Never renders in production. */}
      {isDev && (
        <div className="lc-wb-dev-asktests" data-testid="composer-dev-asktests" aria-label="Dev · ASK TESTS">
          <span className="lc-wb-dev-eyebrow">DEV · ASK TESTS</span>
          {(["give me 3 clips","add my reaction","style captions bold","trim this clip","duck the audio"] as const).map((cmd) => (
            <button
              key={cmd}
              type="button"
              className="lc-wb-dev-chip"
              onClick={() => { void brain.handleSubmit(cmd); bus.emit("kade:mood", { mood: "thinking" }); }}
              data-testid={`composer-dev-asktest-${cmd.replace(/\s+/g,"-")}`}
            >
              {cmd}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Bottom tab bodies ────────────────────────────────────────────
 * Each tab body issues canonical commands through `onCommand`. Kept
 * lean · no local state, no side effects. Ghost / outline styling
 * (see .lc-wb-ghost class) so nothing challenges the ONE primary CTA
 * up in the canvas region. */
function BottomTabBody({ tab, onCommand }: { tab: BottomTab; onCommand: (cmd: string) => void }): ReactElement {
  switch (tab) {
    case "timeline":
      return (
        <div className="lc-wb-bottom-body">
          <div className="lc-wb-bottom-body-eyebrow">TIMELINE</div>
          <div className="lc-wb-bottom-strip" aria-hidden="true">
            {[...Array(48)].map((_, i) => (
              <span key={i} className="lc-wb-bottom-tick" />
            ))}
          </div>
          <div className="lc-wb-bottom-actions">
            <button type="button" className="lc-wb-ghost" onClick={() => onCommand("show timeline")}>
              Show timeline
            </button>
            <button type="button" className="lc-wb-ghost" onClick={() => onCommand("lock reaction to beat")}>
              Lock to beat
            </button>
          </div>
        </div>
      );
    case "trim":
      return (
        <div className="lc-wb-bottom-body">
          <div className="lc-wb-bottom-body-eyebrow">TRIM</div>
          <div className="lc-wb-bottom-actions">
            <button type="button" className="lc-wb-ghost" onClick={() => onCommand("trim this clip")}>Trim clip</button>
            <button type="button" className="lc-wb-ghost" onClick={() => onCommand("tighten this")}>Tighten</button>
            <button type="button" className="lc-wb-ghost" onClick={() => onCommand("remove silences")}>Silences</button>
          </div>
        </div>
      );
    case "captions":
      return (
        <div className="lc-wb-bottom-body">
          <div className="lc-wb-bottom-body-eyebrow">CAPTIONS</div>
          <div className="lc-wb-bottom-actions">
            <button type="button" className="lc-wb-ghost" onClick={() => onCommand("style captions bold")}>Bold</button>
            <button type="button" className="lc-wb-ghost" onClick={() => onCommand("style captions pop")}>Pop</button>
            <button type="button" className="lc-wb-ghost" onClick={() => onCommand("captions position mid")}>Center</button>
          </div>
        </div>
      );
    case "reactions":
      return (
        <div className="lc-wb-bottom-body">
          <div className="lc-wb-bottom-body-eyebrow">REACTIONS</div>
          <div className="lc-wb-bottom-actions">
            <button type="button" className="lc-wb-ghost" onClick={() => onCommand("add my reaction")}>Add reaction</button>
            <button type="button" className="lc-wb-ghost" onClick={() => onCommand("reactions layout pip")}>PiP</button>
            <button type="button" className="lc-wb-ghost" onClick={() => onCommand("reactions layout side-by-side")}>Side-by-side</button>
          </div>
        </div>
      );
    case "audio":
      return (
        <div className="lc-wb-bottom-body">
          <div className="lc-wb-bottom-body-eyebrow">AUDIO</div>
          <div className="lc-wb-bottom-actions">
            <button type="button" className="lc-wb-ghost" onClick={() => onCommand("duck the audio")}>Duck</button>
            <button type="button" className="lc-wb-ghost" onClick={() => onCommand("mix audio")}>Mix</button>
            <button type="button" className="lc-wb-ghost" onClick={() => onCommand("audio track lofi")}>Lo-fi track</button>
          </div>
        </div>
      );
  }
}

/* ── Activity bar icons ─────────────────────────────────────────── */
function ActivityExplorerIcon(): ReactElement {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h6l2 2h8v10a2 2 0 0 1-2 2H4z" /></svg>;
}
function ActivitySearchIcon(): ReactElement {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4" /></svg>;
}
function ActivityCampaignsIcon(): ReactElement {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11l14-6v14L4 13z" /><path d="M4 11v4a2 2 0 0 0 2 2h2" /></svg>;
}
function ActivityRecordIcon(): ReactElement {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></svg>;
}
function ActivityExportIcon(): ReactElement {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v10" /><path d="M8 8l4-4 4 4" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>;
}

export default ComposerWorkbench;
