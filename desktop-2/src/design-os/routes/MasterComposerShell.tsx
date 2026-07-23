/**
 * MasterComposerShell · engaged workspace · full 5-region cockpit.
 * Pure visual — reads brain + session from context. No local state.
 *
 * 2026-07-22 · Sprint 2.5
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useComposerSession, type KadeMood } from "../state/useComposerSession";
import { useMe } from "../state/useMe";
import type { ComposerBrain } from "./useComposerBrain";
import { toggleComposerMute, isComposerMuted } from "../components/CompletionChime";
import "./MasterComposer.css";

// 2026-07-22 · Turn a sidecar-emitted absolute path (e.g.
// `/Users/…/clips/01-…-vertical.mp4`) into a WebView-loadable URL. In
// Tauri v2 that's `asset:` under the hood via `convertFileSrc`. Outside
// Tauri (Vite dev in a browser) it returns the original path which won't
// load — that's expected and only used inside the installed app.
function toClipSrc(path: string | null | undefined): string | null {
  if (!path) return null;
  try {
    return convertFileSrc(path);
  } catch {
    return null;
  }
}

// 2026-07-22 · Nav items removed · AppShell.tsx mounts ConsoleNav (the
// left rail) at the shell level. A second rail here duplicates it.

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
  const [muted, setMuted] = useState<boolean>(() => isComposerMuted());
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
      {/* 2026-07-22 · The AppShell already mounts ConsoleNav (left rail).
       *  Rendering another nav here creates the duplicate-sidebar bug
       *  Daniel reported in the 07:04 screenshot. The mockup shipped its
       *  own nav because it was a standalone HTML — the real app doesn't. */}
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
            <button
              type="button"
              className="lc-master-hud-diag-link"
              onClick={() => setMuted(toggleComposerMute())}
              title={muted ? "Sound off · click to enable" : "Sound on · click to mute"}
              aria-label={muted ? "Unmute composer sounds" : "Mute composer sounds"}
              style={{ appearance: "none", border: "none", background: "transparent", cursor: "pointer", padding: "0 4px" }}
            >
              {muted ? "🔇" : "🔊"}
            </button>
            <span className="lc-master-hud-runtime-pill">runtime 2.3.15</span>
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
          {/* 2026-07-22 · mockup-parity · left "Quick Actions" side panel
           *  from the approved kade-composer-simulator.html (§ side-panel).
           *  Each button submits a prefilled command through the brain so
           *  users have a discoverable cockpit even before they type. */}
          <QuickActionsPanel brain={brain} kadeMood={kadeMood} />
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
                <ClipRail clips={clips} />
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

// 2026-07-22 · Nav Icon* removed with the duplicate nav rail — the
// AppShell's ConsoleNav owns its own icons on the real left rail.

// 2026-07-22 · ClipRail · the visible payoff of the golden path. Every
// finished clip renders as a card with a real playable preview (via
// Tauri asset URL), title, duration, and clear Play / Export actions.
// This is what makes the "clips ready" moment feel real to the user.
interface ClipRailClip {
  idx: number;
  title: string;
  start: number;
  end: number;
  duration_s?: number | null;
  score?: number | null;
  vertical_path?: string | null;
  cover_path?: string | null;
}
function ClipRail({ clips }: { clips: readonly ClipRailClip[] }): ReactElement {
  const [activeIdx, setActiveIdx] = useState<number>(clips[0]?.idx ?? 0);
  const active = clips.find((c) => c.idx === activeIdx) ?? clips[0];
  const activeSrc = toClipSrc(active?.vertical_path);
  const activeCover = toClipSrc(active?.cover_path);
  return (
    <div className="lc-master-clips" data-testid="master-composer-clips">
      <div className="lc-master-clips-eyebrow">
        ✨ {clips.length} clip{clips.length === 1 ? "" : "s"} ready · pick your winners
      </div>
      {active && (
        <div className="lc-master-clip-hero" data-has-video={activeSrc ? "true" : "false"}>
          {activeSrc ? (
            <video
              key={active.idx}
              className="lc-master-clip-hero-video"
              src={activeSrc}
              poster={activeCover ?? undefined}
              controls
              autoPlay
              muted
              playsInline
              loop
              data-testid="master-composer-clip-hero-video"
            />
          ) : (
            <div className="lc-master-clip-hero-fallback">
              <div className="lc-master-clip-hero-fallback-title">{active.title}</div>
              <div className="lc-master-clip-hero-fallback-note">Preview available in the installed app.</div>
            </div>
          )}
          <div className="lc-master-clip-hero-meta">
            <div className="lc-master-clip-hero-title">{active.title}</div>
            <div className="lc-master-clip-hero-sub">
              {typeof active.score === "number" ? `${active.score}% match` : "top pick"}
              {" · "}
              {active.duration_s ? `${Math.round(active.duration_s)}s` : `${Math.round(active.end - active.start)}s`}
              {" · "}
              9:16 vertical
            </div>
          </div>
        </div>
      )}
      <div className="lc-master-clips-row" role="tablist" aria-label="Ready clips">
        {clips.map((c) => {
          const thumb = toClipSrc(c.cover_path);
          const src = toClipSrc(c.vertical_path);
          const isActive = c.idx === activeIdx;
          return (
            <button
              key={c.idx}
              type="button"
              className="lc-master-clip-card"
              data-active={isActive ? "true" : "false"}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveIdx(c.idx)}
              data-testid={`master-composer-clip-card-${c.idx}`}
            >
              <div className="lc-master-clip-card-thumb">
                {thumb ? (
                  <img src={thumb} alt="" />
                ) : src ? (
                  <video src={src} muted playsInline preload="metadata" />
                ) : (
                  <div className="lc-master-clip-card-thumb-fallback">▶</div>
                )}
              </div>
              <div className="lc-master-clip-title">{c.title}</div>
              <div className="lc-master-clip-meta">
                {typeof c.score === "number" ? `${c.score}%` : "—"}
                {" · "}
                {c.duration_s ? `${Math.round(c.duration_s)}s` : `${Math.round(c.end - c.start)}s`}
              </div>
            </button>
          );
        })}
      </div>
      <div className="lc-master-clips-actions">
        <div className="lc-master-clips-hint">
          Click a card to preview · use the command bar to say
          <em> “export clip 1”</em> or <em> “drop clip 2”</em>.
        </div>
      </div>
    </div>
  );
}

// 2026-07-22 · QuickActionsPanel · left cockpit rail from the approved
// mockup (kade-composer-simulator.html § side-panel + quick-action).
// Each button submits a prefilled utterance through the ComposerBrain so
// users have a discoverable "here's what Kade can do" surface even
// before typing.
const QUICK_ACTIONS: ReadonlyArray<{ label: string; command: string; icon: string }> = [
  { label: "Find 3 clips from footage", command: "give me 3 clips",         icon: "🔍" },
  { label: "Add my reaction",           command: "add my reaction",         icon: "📷" },
  { label: "Style captions",            command: "style captions",          icon: "💬" },
  { label: "Find clip in library",      command: "find clip in library",    icon: "📚" },
  { label: "Match this brief",          command: "match this brief",        icon: "🎯" },
  { label: "Record my screen",          command: "record my screen",        icon: "⏺" },
  { label: "Lock reaction to beat",     command: "lock reaction to beat",   icon: "🎵" },
  { label: "Add hook text",             command: "add hook text",           icon: "✍" },
  { label: "Duck the audio",            command: "duck the audio",          icon: "🎚" },
  { label: "Show timeline",             command: "show timeline",           icon: "⏱" },
  { label: "Show my watermark",         command: "show my watermark",       icon: "🏷" },
];
function QuickActionsPanel({ brain, kadeMood }: { brain: ComposerBrain; kadeMood: KadeMood }): ReactElement {
  const kadePose = kadeMood === "thinking"
    ? "/brand/kade/kade-generating-captions.webp"
    : kadeMood === "alert"
      ? "/brand/kade/kade-hover.webp"
      : "/brand/kade/kade-idle.webp";
  const doingLabel = kadeMood === "thinking" ? "On it right now." : kadeMood === "alert" ? "Hit a snag." : "Waiting for you.";
  return (
    <aside className="lc-master-side" aria-label="Kade quick actions">
      <div className="lc-master-side-head">Kade · <b>Standby</b></div>
      <div className="lc-master-side-status">
        <img className="lc-master-side-status-thumb" src={kadePose} alt="" aria-hidden="true" />
        <div className="lc-master-side-status-text">
          <span className="lc-master-side-status-label">DOING</span>
          <span className="lc-master-side-status-doing">{doingLabel}</span>
        </div>
      </div>
      <div className="lc-master-side-title">Quick actions</div>
      <div className="lc-master-side-actions">
        {QUICK_ACTIONS.map((qa) => (
          <button
            key={qa.command}
            type="button"
            className="lc-master-quick-action"
            onClick={() => void brain.handleSubmit(qa.command)}
            data-testid={`quick-action-${qa.command.replace(/\s+/g, "-")}`}
          >
            <span className="lc-master-quick-action-icon" aria-hidden="true">{qa.icon}</span>
            <span className="lc-master-quick-action-text">{qa.label}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

export default MasterComposerShell;
