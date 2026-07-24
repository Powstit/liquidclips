/**
 * SimpleComposerShell · idle greeter · pure visual · reads brain + session
 * from useComposerSession + useComposerBrain (owned by ComposerRoute).
 *
 * State DOES NOT LIVE HERE — that's the whole point. ComposerRoute
 * hosts the state so the idle → engaged swap doesn't drop it.
 *
 * 2026-07-22 · Sprint 2.5
 */

import { useEffect, useRef, type ReactElement } from "react";
import { useComposerSession } from "../state/useComposerSession";
import { useMe } from "../state/useMe";
import type { ComposerBrain } from "./useComposerBrain";
import "./SimpleComposer.css";

// IG-COMPOSER-TIER-PILL · 2026-07-24 · BUG-003
// Composer had zero tier awareness — no pill shown, no visible signal
// to the paying user about what tier they were on. Combined with
// pricing-pivot confusion (BUG-004) this made paying users unsure of
// what they got. `useMe().snapshot?.effectiveTier` is the canonical
// tier field (accounts for admin override). "agency" → AGENCY pill,
// anything else → FREE pill. Rendered inside the runtime-strip so it
// stays adjacent to the runtime-version indicator.
function deriveTierLabel(effectiveTier: string | null | undefined): "AGENCY" | "FREE" {
  return effectiveTier === "agency" || effectiveTier === "autopilot" ? "AGENCY" : "FREE";
}

interface QuickAction {
  key: string;
  label: string;
  hint: string;
  command: string;
  icon: ReactElement;
}

const QUICK_ACTIONS: readonly QuickAction[] = [
  { key: "1", label: "Find 3 clips", hint: "from footage", command: "give me 3 clips", icon: <IconClips /> },
  { key: "2", label: "Add my reaction", hint: "screen + camera", command: "add my reaction", icon: <IconCam /> },
  { key: "3", label: "Style captions", hint: "bold · pop · subtle", command: "style captions bold", icon: <IconCaption /> },
  { key: "4", label: "Find clip in library", hint: "1.3M-channel HQ", command: "find clip in library", icon: <IconLibrary /> },
  { key: "5", label: "Record my screen", hint: "Kade guides you", command: "record my screen", icon: <IconRecord /> },
  { key: "6", label: "Duck the audio", hint: "auto voice + music mix", command: "duck the audio", icon: <IconAudio /> },
] as const;

interface Props {
  brain: ComposerBrain;
}

export function SimpleComposerShell({ brain }: Props): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const command = useComposerSession((s) => s.command);
  const setCommand = useComposerSession((s) => s.setCommand);
  const history = useComposerSession((s) => s.history);
  const lastReply = useComposerSession((s) => s.lastReply);
  const lastIntentStatus = useComposerSession((s) => s.lastIntentStatus);
  const setShellOverride = useComposerSession((s) => s.setShellOverride);

  // IG-COMPOSER-TIER-PILL · BUG-003. Read canonical tier from useMe.
  // meLoading gate keeps the pill hidden during first hydrate so a
  // paying user does not briefly render as FREE.
  const me = useMe();
  const meHasSnapshot = !!me.snapshot;
  const tierLabel = deriveTierLabel(me.snapshot?.effectiveTier ?? null);

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
        return;
      }
      if (e.key === "Escape") {
        inputRef.current?.blur();
        setCommand("");
        return;
      }
      if (document.activeElement !== inputRef.current) {
        const num = parseInt(e.key, 10);
        if (!Number.isNaN(num) && num >= 1 && num <= QUICK_ACTIONS.length) {
          e.preventDefault();
          void brain.handleSubmit(QUICK_ACTIONS[num - 1].command);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [brain, setCommand]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void brain.handleSubmit(command);
  };

  return (
    <div className="lc-simple-composer" data-testid="simple-composer">
      <div className="lc-sc-canvas" data-layout="single">
        <img
          className="lc-sc-hero"
          style={{ viewTransitionName: "kade-avatar" } as React.CSSProperties}
          src="/brand/kade/kade-canvas-hero.png"
          alt=""
          aria-hidden="true"
        />
        <div className="lc-sc-prompt">What are we cutting today?</div>
        <form
          className="lc-sc-cmd-form"
          style={{ viewTransitionName: "composer-command-bar" } as React.CSSProperties}
          onSubmit={onSubmit}
        >
          <input
            ref={inputRef}
            type="text"
            className="lc-sc-cmd-input"
            placeholder="Tell Kade what to do…"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            data-testid="composer-command"
            autoComplete="off"
            spellCheck="false"
            aria-label="Command Kade"
          />
          <button
            type="submit"
            className="lc-sc-cmd-send"
            data-testid="composer-send"
            aria-label="Send command to Kade"
            disabled={!command.trim()}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </form>
        <div className="lc-sc-hotkeys">
          <kbd>⌘K</kbd> focus · <kbd>1-6</kbd> quick action · <kbd>Esc</kbd> close
        </div>

        {lastIntentStatus && (
          <div className="lc-sc-wire-status" data-testid="composer-wire-status" data-tone={lastIntentStatus.kind === "ok" ? "ok" : "fail"}>
            {lastIntentStatus.kind === "ok"
              ? `⚡ Kade heard you · ${lastIntentStatus.action} · ${lastIntentStatus.ms}ms`
              : `⚠ Hosted LLM failed (${lastIntentStatus.message.slice(0, 60)}) · using local fallback`}
          </div>
        )}
      </div>

      <aside className="lc-sc-sidebar">
        <div className="lc-sc-doing">
          <div className="lc-sc-doing-eyebrow">DOING</div>
          <img
            className="lc-sc-doing-avatar"
            src="/brand/kade/kade-idle.webp"
            alt=""
            aria-hidden="true"
          />
          <div className="lc-sc-doing-title">
            {lastReply ? lastReply.title : "Waiting for you"}
          </div>
        </div>

        {lastReply && (
          <div className="lc-sc-reply" data-testid="composer-last-reply" data-tone={lastReply.severity}>
            <div className="lc-sc-reply-eyebrow">KADE SAID</div>
            <div className="lc-sc-reply-title">{lastReply.title}</div>
            <div className="lc-sc-reply-body">{lastReply.body}</div>
          </div>
        )}

        <div className="lc-sc-runtime-strip">
          <span className="lc-sc-runtime-pill">runtime 2.3.15</span>
          {/* IG-COMPOSER-TIER-PILL · BUG-003 · 2026-07-24
              Paying users deserve a visible signal that their tier is
              active in the composer. Hidden during hydrate to avoid a
              brief FREE flash for a paying user. */}
          {meHasSnapshot && (
            <span
              className={`lc-sc-tier-pill lc-sc-tier-pill--${tierLabel.toLowerCase()}`}
              data-testid="composer-tier-pill"
              title={
                tierLabel === "AGENCY"
                  ? "Agency tier · all features unlocked"
                  : "Free tier · upgrade in Settings"
              }
            >
              {tierLabel}
            </span>
          )}
          <button
            className="lc-sc-diag-link"
            onClick={() => setShellOverride("engaged")}
            title="Force expand the cockpit"
            style={{ appearance: "none", border: "none", background: "transparent", cursor: "pointer" }}
          >
            Open cockpit →
          </button>
        </div>

        <div className="lc-sc-quicks">
          <div className="lc-sc-quicks-eyebrow">QUICK ACTIONS</div>
          {QUICK_ACTIONS.map((qa) => (
            <button
              key={qa.key}
              type="button"
              className="lc-sc-quick"
              onClick={() => void brain.handleSubmit(qa.command)}
              data-testid={`composer-quick-${qa.key}`}
              aria-label={`${qa.label} · ${qa.hint}`}
            >
              <span className="lc-sc-quick-num">{qa.key}</span>
              <span className="lc-sc-quick-icon">{qa.icon}</span>
              <span className="lc-sc-quick-label">
                <span className="lc-sc-quick-title">{qa.label}</span>
                <span className="lc-sc-quick-hint">{qa.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      {history.length > 0 && (
        <div className="lc-sc-recent" data-testid="composer-recent">
          <span className="lc-sc-recent-eyebrow">RECENT</span>
          {history.slice(0, 3).map((cmd) => (
            <button
              key={cmd}
              type="button"
              className="lc-sc-recent-chip"
              onClick={() => void brain.handleSubmit(cmd)}
              title={cmd}
            >
              {cmd.slice(0, 42)}{cmd.length > 42 ? "…" : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function IconClips() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.2" /><rect x="14" y="3" width="7" height="7" rx="1.2" /><rect x="3" y="14" width="7" height="7" rx="1.2" /><rect x="14" y="14" width="7" height="7" rx="1.2" /></svg>;
}
function IconCam() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="6" width="14" height="12" rx="2" /><polygon points="17 9 22 6 22 18 17 15" /></svg>;
}
function IconCaption() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 14 L11 14" /><path d="M13 14 L17 14" /><path d="M7 10 L15 10" /></svg>;
}
function IconLibrary() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4 L4 20" /><path d="M8 4 L8 20" /><rect x="11" y="4" width="4" height="16" rx="0.5" /><path d="M17 6 L21 5 L21 20 L17 20" /></svg>;
}
function IconRecord() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="4.5" width="19" height="13" rx="2" /><circle cx="12" cy="11" r="3" fill="currentColor" stroke="none" /><path d="M8 20.5 L16 20.5" /></svg>;
}
function IconAudio() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12 L6 12" /><path d="M8 8 L8 16" /><path d="M12 4 L12 20" /><path d="M16 8 L16 16" /><path d="M20 12 L22 12" /></svg>;
}

export default SimpleComposerShell;
