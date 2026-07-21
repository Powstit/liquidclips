/**
 * MasterComposerShell · engaged workspace · full 5-region cockpit.
 * Pure visual — reads brain + session from context. No local state.
 *
 * 2026-07-22 · Sprint 2.5
 */

import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { bus } from "../bridge";
import { useComposerSession, type KadeMood } from "../state/useComposerSession";
import { useMe } from "../state/useMe";
import type { ComposerBrain } from "./useComposerBrain";
import "./MasterComposer.css";

const NAV_ITEMS: readonly { id: string; label: string; route: string; icon: ReactElement }[] = [
  { id: "home", label: "Home", route: "home", icon: <IconHome /> },
  { id: "create", label: "Create", route: "composer", icon: <IconCreate /> },
  { id: "clips", label: "Clips", route: "workstation", icon: <IconClips /> },
  { id: "campaigns", label: "Campaigns", route: "campaigns", icon: <IconCampaign /> },
  { id: "earn", label: "Earn", route: "earn", icon: <IconEarn /> },
  { id: "schedule", label: "Schedule", route: "schedule", icon: <IconSchedule /> },
];

function kadePoseFor(mood: KadeMood, stage: string | null): string {
  if (mood === "alert") return "/brand/kade/kade-hover.webp";
  if (mood === "thinking") {
    if (stage === "transcribe") return "/brand/kade/kade-generating-captions.webp";
    if (stage === "llm") return "/brand/kade/kade-reading-brief.webp";
    if (stage === "cut") return "/brand/kade/kade-cutting-clips.webp";
    return "/brand/kade/kade-cutting-clips.webp";
  }
  return "/brand/kade/kade-idle.webp";
}

interface Props {
  brain: ComposerBrain;
}

export function MasterComposerShell({ brain }: Props): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const me = useMe();

  const command = useComposerSession((s) => s.command);
  const setCommand = useComposerSession((s) => s.setCommand);
  const history = useComposerSession((s) => s.history);
  const awaitingSource = useComposerSession((s) => s.awaitingSource);
  const showUrlInput = useComposerSession((s) => s.showUrlInput);
  const setShowUrlInput = useComposerSession((s) => s.setShowUrlInput);
  const urlDraft = useComposerSession((s) => s.urlDraft);
  const setUrlDraft = useComposerSession((s) => s.setUrlDraft);
  const sessionCtx = useComposerSession((s) => s.sessionCtx);
  const activeSlug = useComposerSession((s) => s.activeSlug);
  const progress = useComposerSession((s) => s.progress);
  const clips = useComposerSession((s) => s.clips);
  const runError = useComposerSession((s) => s.runError);
  const lastReply = useComposerSession((s) => s.lastReply);
  const kadeMood = useComposerSession((s) => s.kadeMood);
  const lastIntentStatus = useComposerSession((s) => s.lastIntentStatus);
  const setShellOverride = useComposerSession((s) => s.setShellOverride);
  const clearSession = useComposerSession((s) => s.clearSession);

  const tier: string = ((me as { tier?: string } | null | undefined)?.tier ?? "free") as string;
  const founder: boolean = Boolean((me as { founder_flag?: boolean } | null | undefined)?.founder_flag);
  const tierLabel = founder || tier === "agency" || tier === "agency_whitelabel" || tier === "autopilot" ? "AGENCY" : "FREE";

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 200);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (e.key === "Escape") {
        inputRef.current?.blur();
        setCommand("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCommand]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void brain.handleSubmit(command);
  };

  const progressWidth = useMemo(() => {
    if (!progress) return 0;
    if (typeof progress.percent === "number") return Math.min(100, Math.max(0, progress.percent * 100));
    if (progress.segmentsTotal && progress.segmentsDone != null) {
      return Math.min(100, (progress.segmentsDone / progress.segmentsTotal) * 100);
    }
    return 6;
  }, [progress]);

  const baseWindowJson = useMemo(() => {
    return JSON.stringify({
      tier, founder, tierLabel, sessionCtx, activeSlug, progress,
      clipsCount: clips.length, awaitingSource, lastReply, kadeMood, lastIntentStatus,
    }, null, 2);
  }, [tier, founder, tierLabel, sessionCtx, activeSlug, progress, clips.length, awaitingSource, lastReply, kadeMood, lastIntentStatus]);

  return (
    <div className="lc-master" data-testid="master-composer" data-turbo="false">
      <nav
        className="lc-master-nav"
        style={{ viewTransitionName: "nav-rail" } as React.CSSProperties}
        aria-label="Primary navigation"
      >
        <div className="lc-master-nav-logo" title="Liquid Clips">
          <span>LC</span>
        </div>
        {NAV_ITEMS.map((n) => (
          <button
            key={n.id}
            type="button"
            className="lc-master-nav-item"
            data-active={n.id === "create" ? "true" : "false"}
            onClick={() => bus.emit("nav:click", { route: n.route as never })}
            aria-label={n.label}
          >
            {n.icon}
            <span className="lc-master-nav-label">{n.label}</span>
          </button>
        ))}
      </nav>

      <div className="lc-master-main">
        <header
          className="lc-master-hud"
          style={{ viewTransitionName: "hud" } as React.CSSProperties}
        >
          <div className="lc-master-hud-brand">
            Liquid <span>Clips</span>
          </div>
          <div className="lc-master-hud-chip" data-tier={tierLabel.toLowerCase()}>
            {tierLabel === "AGENCY" ? "Agency · $99.99/mo" : "Free · 10 clips + watermark"}
          </div>
          <div className="lc-master-hud-mode">
            <button
              className="lc-master-hud-mode-btn"
              data-active="true"
              onClick={() => setShellOverride("engaged")}
              title="Force cockpit"
            >Kade</button>
            <button
              className="lc-master-hud-mode-btn"
              onClick={() => setShellOverride("idle")}
              title="Collapse to Classic greeter"
            >Classic</button>
          </div>
          <div className="lc-master-hud-runtime">
            <span className="lc-master-hud-runtime-pill">runtime 2.2.76</span>
            <button
              className="lc-master-hud-diag-link"
              onClick={() => { clearSession(); setShellOverride("auto"); }}
              style={{ appearance: "none", border: "none", background: "transparent", cursor: "pointer" }}
              title="Wipe session state · returns to idle greeter"
            >
              Clear ↺
            </button>
            <a className="lc-master-hud-diag-link" href="#/diagnostics?staff=1" title="Diagnostic Center">
              Diag →
            </a>
          </div>
        </header>

        <div className="lc-master-workspace">
          <div className="lc-master-canvas-region">
            <div className="lc-master-canvas" data-loaded={clips.length > 0 ? "true" : "false"}>
              <img
                className="lc-master-kade"
                style={{ viewTransitionName: "kade-avatar" } as React.CSSProperties}
                src={kadePoseFor(kadeMood, progress?.stage ?? null)}
                alt=""
                aria-hidden="true"
              />
              {!progress && clips.length === 0 && !awaitingSource && (
                <div className="lc-master-prompt">What are we cutting today?</div>
              )}

              {awaitingSource && (
                <div className="lc-master-source-ask" data-testid="master-composer-source-ask">
                  <div className="lc-master-source-ask-title">Where's the source?</div>
                  <div className="lc-master-source-ask-row">
                    <button type="button" className="lc-master-source-btn" onClick={brain.pickFile} data-testid="master-composer-pick-file">
                      📁 Pick a file
                    </button>
                    <button type="button" className="lc-master-source-btn" onClick={() => setShowUrlInput(!showUrlInput)} data-testid="master-composer-paste-url-toggle">
                      🔗 Paste URL
                    </button>
                  </div>
                  {showUrlInput && (
                    <form className="lc-master-source-url-form" onSubmit={(e) => { e.preventDefault(); brain.submitUrl(); }}>
                      <input
                        type="url"
                        className="lc-master-source-url-input"
                        placeholder="https://youtube.com/watch?v=…"
                        value={urlDraft}
                        onChange={(e) => setUrlDraft(e.target.value)}
                        autoFocus
                        data-testid="master-composer-url-input"
                      />
                      <button type="submit" className="lc-master-source-btn">Go</button>
                    </form>
                  )}
                </div>
              )}

              {progress && (
                <div className="lc-master-progress" data-testid="master-composer-progress">
                  <div className="lc-master-progress-eyebrow">
                    {progress.stage.toUpperCase()}
                    {progress.note ? ` · ${progress.note.slice(0, 60)}` : ""}
                    {progress.segmentsTotal && progress.segmentsDone != null
                      ? ` · ${progress.segmentsDone} of ${progress.segmentsTotal}`
                      : ""}
                  </div>
                  <div className="lc-master-progress-bar">
                    <div className="lc-master-progress-fill" style={{ width: `${progressWidth}%` }} />
                  </div>
                </div>
              )}

              {runError && !progress && clips.length === 0 && (
                <div className="lc-master-error" data-testid="master-composer-error">
                  {runError}
                </div>
              )}

              {clips.length > 0 && (
                <div className="lc-master-clips" data-testid="master-composer-clips">
                  <div className="lc-master-clips-eyebrow">
                    {clips.length} clip{clips.length === 1 ? "" : "s"} ready · scroll →
                  </div>
                  <div className="lc-master-clips-row">
                    {clips.map((c) => (
                      <div key={c.idx} className="lc-master-clip-card">
                        <div className="lc-master-clip-title">{c.title}</div>
                        <div className="lc-master-clip-meta">
                          {typeof c.score === "number" ? `${c.score}%` : "—"}
                          {" · "}
                          {c.duration_s ? `${Math.round(c.duration_s)}s` : `${Math.round(c.end - c.start)}s`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="lc-master-timeline-stub" aria-hidden="true">
                <div className="lc-master-timeline-track">
                  {[...Array(24)].map((_, i) => (
                    <span key={i} className="lc-master-timeline-tick" data-active={activeSlug ? "true" : "false"} />
                  ))}
                </div>
              </div>
            </div>

            {lastIntentStatus && (
              <div className="lc-master-wire-status" data-testid="master-composer-wire-status" data-tone={lastIntentStatus.kind === "ok" ? "ok" : "fail"}>
                {lastIntentStatus.kind === "ok"
                  ? `⚡ Kade heard you · ${lastIntentStatus.action} · ${lastIntentStatus.ms}ms`
                  : `⚠ Hosted LLM failed (${lastIntentStatus.message.slice(0, 60)}) · using local fallback`}
              </div>
            )}
          </div>
        </div>

        <form
          className="lc-master-cmd"
          style={{ viewTransitionName: "composer-command-bar" } as React.CSSProperties}
          onSubmit={onSubmit}
        >
          <input
            ref={inputRef}
            type="text"
            className="lc-master-cmd-input"
            placeholder="Tell Kade what to do…"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            autoComplete="off"
            spellCheck="false"
            aria-label="Command Kade"
            data-testid="master-composer-command"
          />
          <button
            type="submit"
            className="lc-master-cmd-send"
            disabled={!command.trim()}
            data-testid="master-composer-send"
            aria-label="Send command"
          >
            →
          </button>
        </form>
        <div className="lc-master-hotkeys">
          <kbd>⌘K</kbd> focus · <kbd>Esc</kbd> clear
          {history.length > 0 && (
            <span className="lc-master-history">
              {" · recent: "}
              {history.slice(0, 2).map((cmd, i) => (
                <button
                  key={cmd + i}
                  type="button"
                  className="lc-master-history-chip"
                  onClick={() => void brain.handleSubmit(cmd)}
                  title={cmd}
                >
                  {cmd.slice(0, 28)}{cmd.length > 28 ? "…" : ""}
                </button>
              ))}
            </span>
          )}
        </div>
      </div>

      <aside
        className="lc-master-right"
        style={{ viewTransitionName: "right-panel" } as React.CSSProperties}
        aria-label="Base Window JSON state"
      >
        <div className="lc-master-right-head">
          <span className="lc-master-right-eyebrow">BASE WINDOW · LIVE</span>
          <span className="lc-master-right-mood" data-mood={kadeMood}>
            {kadeMood.toUpperCase()}
          </span>
        </div>
        <pre className="lc-master-right-json">{baseWindowJson}</pre>
        {lastReply && (
          <div className="lc-master-right-reply" data-tone={lastReply.severity}>
            <div className="lc-master-right-reply-eyebrow">KADE SAID</div>
            <div className="lc-master-right-reply-title">{lastReply.title}</div>
            <div className="lc-master-right-reply-body">{lastReply.body}</div>
          </div>
        )}
      </aside>
    </div>
  );
}

function IconHome() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12L12 4l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9z" /></svg>;
}
function IconCreate() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16v12H4z" /><path d="M4 10l6 4 4-3 6 5" /></svg>;
}
function IconClips() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M10 10l5 2-5 2z" fill="currentColor" /></svg>;
}
function IconCampaign() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3 6 6 1-4.5 4 1 6L12 16l-5.5 3 1-6L3 9l6-1z" /></svg>;
}
function IconEarn() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20" /><path d="M6 8h9a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h10" /></svg>;
}
function IconSchedule() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>;
}

export default MasterComposerShell;
