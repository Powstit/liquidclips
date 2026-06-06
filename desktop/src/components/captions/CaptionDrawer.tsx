import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sidecar } from "../../lib/sidecar";
import {
  History,
  applyPatch,
  autoFixLines,
  lengthOpinion,
  type CaptionLine,
  type CaptionState,
} from "../../lib/captions";
import { CAPTION_STYLES, CAPTION_STYLE_KEYS, type CaptionStyleKey } from "../../lib/caption-styles";
import { CaptionOverlay } from "./CaptionOverlay";
import { CaptionRow } from "./CaptionRow";
import { CaptionStyleCard } from "./CaptionStyleCard";
import invaderSrc from "../../assets/icons/connections/library-bug.png";

// Master right-side drawer for editing a single clip's captions.
//
// Layout: 38% of the parent width. Stays open over the playing video. The
// CaptionOverlay re-renders as the parent feeds in currentTime via a
// `timeupdate` listener it attaches to its own <video> element.
//
// On Apply: writes the edit set to disk + re-bakes captions into the clip's
// rendered MP4 via the edit_captions RPC. Atomic replace — when it succeeds,
// the parent should bump its video src cache-bust to pick up the new file.

export function CaptionDrawer({
  open,
  slug,
  clipIdx,
  currentTime,
  videoDuration,
  onClose,
  onSeek,
  onApplied,
  onDirtyChange,
}: {
  open: boolean;
  slug: string;
  clipIdx: number;
  currentTime: number;
  videoDuration: number;
  onClose: () => void;
  onSeek: (t: number) => void;
  /** Called after a successful re-bake. Parent should cache-bust the video src. */
  onApplied: (videoPath: string, style: CaptionStyleKey) => void;
  /** Lets the parent ClipPreview show the unsaved-edits dot on the captions pill. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [state, setState] = useState<CaptionState | null>(null);
  const [loading, setLoading] = useState(false);
  const [baking, setBaking] = useState(false);
  const [autoFixToast, setAutoFixToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const history = useRef(new History());

  // Initial load — fetch persisted edits or derive from transcript.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    sidecar
      .getCaptions(slug, clipIdx)
      .then((res) => {
        if (cancelled) return;
        const initialLines: CaptionLine[] = res.lines.map((ln) => ({
          start: ln.start,
          end: ln.end,
          text: ln.text,
          words: ln.words,
        }));

        // Run ASR auto-fix on first transcript-sourced load only.
        let lines = initialLines;
        let fixed = 0;
        if (res.source === "transcript") {
          const fixedResult = autoFixLines(lines);
          lines = fixedResult.lines;
          fixed = fixedResult.count;
        }

        const fresh: CaptionState = {
          clipIdx,
          style: ((CAPTION_STYLES as Record<string, unknown>)[res.style] ? res.style : "brand_fuchsia") as CaptionStyleKey,
          lines,
          totalChars: lines.reduce((s, l) => s + (l.text?.length ?? 0), 0),
          syncStatus: res.source === "edits" ? "synced" : "dirty",
          updatedAt: res.updated_at,
          source: res.source,
        };
        setState(fresh);
        history.current = new History();
        history.current.push(fresh);
        setLoading(false);
        if (fixed > 0) {
          setAutoFixToast(`${fixed} text fix${fixed === 1 ? "" : "es"} auto-applied — Cmd-Z to revert`);
          window.setTimeout(() => setAutoFixToast(null), 4000);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, slug, clipIdx]);

  // Tell parent whether we have unsaved edits.
  useEffect(() => {
    onDirtyChange?.(state?.syncStatus === "dirty");
  }, [state?.syncStatus, onDirtyChange]);

  const mutate = useCallback((next: CaptionState) => {
    history.current.push(state!);
    setState(next);
  }, [state]);

  const handleStyleChange = useCallback((styleKey: CaptionStyleKey) => {
    if (!state || state.style === styleKey) return;
    mutate(applyPatch(state, { kind: "style", value: styleKey }));
  }, [state, mutate]);

  const handleTextChange = useCallback((idx: number, value: string) => {
    if (!state) return;
    mutate(applyPatch(state, { kind: "text", idx, value }));
  }, [state, mutate]);

  const handleTimeChange = useCallback((idx: number, start: number, end: number) => {
    if (!state) return;
    mutate(applyPatch(state, { kind: "time", idx, start, end }));
  }, [state, mutate]);

  const handleDelete = useCallback((idx: number) => {
    if (!state) return;
    mutate(applyPatch(state, { kind: "delete", idx }));
  }, [state, mutate]);

  const handleAddAfter = useCallback((idx: number) => {
    if (!state) return;
    const baseLine = state.lines[idx];
    const nextLine = state.lines[idx + 1];
    const start = baseLine ? baseLine.end : 0;
    const end = nextLine ? Math.max(start + 0.5, nextLine.start) : Math.min(start + 1.2, videoDuration);
    const newLine: CaptionLine = { start, end, text: "" };
    mutate(applyPatch(state, { kind: "add", afterIdx: idx, line: newLine }));
  }, [state, mutate, videoDuration]);

  const handleUndo = useCallback(() => {
    if (!state) return;
    const prev = history.current.undo(state);
    if (prev) setState(prev);
  }, [state]);

  const handleRedo = useCallback(() => {
    if (!state) return;
    const next = history.current.redo(state);
    if (next) setState(next);
  }, [state]);

  // Single source of truth for "did the user really want to close?" so the
  // Esc handler AND the X button apply the same dirty-check. Stops silent
  // data loss when the user clicks X with unsaved edits.
  const tryClose = useCallback(() => {
    if (state?.syncStatus === "dirty") {
      if (!window.confirm("You have unsaved caption edits. Discard them?")) return;
    }
    onClose();
  }, [state?.syncStatus, onClose]);

  const handleApply = useCallback(async () => {
    if (!state || baking) return;
    setBaking(true);
    setError(null);
    try {
      const res = await sidecar.editCaptions(slug, clipIdx, state.lines, state.style);
      const synced: CaptionState = { ...state, syncStatus: "synced", updatedAt: res.updated_at };
      setState(synced);
      history.current = new History();
      history.current.push(synced);
      onApplied(res.video_path, state.style);
    } catch (e) {
      setError(String(e));
      setState((s) => (s ? { ...s, syncStatus: "error" } : s));
    } finally {
      setBaking(false);
    }
  }, [state, baking, slug, clipIdx, onApplied]);

  // Cmd-Z / Cmd-Shift-Z + Cmd-S keyboard shortcuts (scope: drawer-focus only).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo(); else handleUndo();
      } else if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        // No-op gate — Cmd-S on a clean state should do nothing visible.
        // Without this, every Cmd-S fires the bake RPC even when nothing
        // changed, churning the renderer.
        if (state?.syncStatus !== "dirty") return;
        void handleApply();
      } else if (e.key === "Escape") {
        tryClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleUndo, handleRedo, state?.syncStatus, tryClose, handleApply]);

  const currentLineIdx = useMemo(() => {
    if (!state) return -1;
    for (let i = 0; i < state.lines.length; i++) {
      const ln = state.lines[i];
      if (currentTime >= ln.start && currentTime < ln.end) return i;
    }
    return -1;
  }, [state, currentTime]);

  const lengthAdvice = useMemo(() => {
    if (!state) return null;
    const opinions = lengthOpinion(state.totalChars);
    const longOn = opinions.filter((o) => o.verdict === "long").map((o) => o.platform.toUpperCase());
    if (longOn.length === 0) return `${state.totalChars} chars · within budget`;
    return `${state.totalChars} chars · long for ${longOn.join(", ")}`;
  }, [state]);

  if (!open) return null;

  return (
    <aside
      role="dialog"
      aria-label="Captions editor"
      aria-modal="false"
      className="caption-drawer"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: "min(440px, 38%)",
        background: "var(--color-paper-elev, #1c1c25)",
        borderLeft: "1px solid var(--color-line, rgba(255,255,255,0.07))",
        boxShadow: "-24px 0 60px rgba(0,0,0,0.55)",
        display: "flex",
        flexDirection: "column",
        zIndex: 20,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--color-line, rgba(255,255,255,0.07))",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontFamily: "var(--font-mono, JetBrains Mono), monospace",
        }}
      >
        <img src={invaderSrc} alt="" width={18} height={18} style={{ imageRendering: "pixelated" }} />
        <span
          style={{
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--color-fuchsia, #ff1a8c)",
            fontWeight: 700,
          }}
        >
          Captions
        </span>
        <SyncDot status={state?.syncStatus ?? "synced"} />
        <button
          type="button"
          onClick={tryClose}
          aria-label="Close drawer"
          style={{
            marginLeft: "auto",
            background: "transparent",
            border: "1px solid var(--color-line, rgba(255,255,255,0.07))",
            color: "var(--color-ink-soft, #c8c4be)",
            width: 28,
            height: 28,
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
        {loading && <p style={{ color: "var(--color-text-tertiary, #8a857e)" }}>Loading caption data…</p>}

        {!loading && state && state.lines.length === 0 && (
          <EmptyState
            slug={slug}
            clipIdx={clipIdx}
            onLoaded={(lines) => setState({ ...state, lines, syncStatus: "dirty" })}
            onClose={onClose}
          />
        )}

        {!loading && state && state.lines.length > 0 && (
          <>
            <SectionLabel>Style</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 8 }}>
              {CAPTION_STYLE_KEYS.map((k) => (
                <CaptionStyleCard
                  key={k}
                  styleKey={k}
                  active={state.style === k}
                  onClick={() => handleStyleChange(k)}
                />
              ))}
            </div>

            <SectionLabel style={{ marginTop: 18 }}>Lines · {state.lines.length}</SectionLabel>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              {state.lines.map((ln, i) => (
                <div key={`row-${i}`}>
                  <CaptionRow
                    line={ln}
                    index={i}
                    isCurrent={currentLineIdx === i}
                    onTextChange={(v) => handleTextChange(i, v)}
                    onTimeChange={(s, e) => handleTimeChange(i, s, e)}
                    onSeek={onSeek}
                    onDelete={() => handleDelete(i)}
                  />
                  <button
                    type="button"
                    onClick={() => handleAddAfter(i)}
                    aria-label="Add line after"
                    style={{
                      display: "block",
                      width: "100%",
                      margin: "6px 0",
                      padding: "4px 0",
                      background: "transparent",
                      border: "none",
                      borderTop: "1px dashed transparent",
                      color: "var(--color-text-tertiary, #8a857e)",
                      fontFamily: "var(--font-mono, JetBrains Mono), monospace",
                      fontSize: 10,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      cursor: "pointer",
                    }}
                    onMouseOver={(e) => { e.currentTarget.style.borderTopColor = "rgba(0, 229, 255, 0.5)"; e.currentTarget.style.color = "var(--color-cyan, #00e5ff)"; }}
                    onMouseOut={(e) => { e.currentTarget.style.borderTopColor = "transparent"; e.currentTarget.style.color = "var(--color-text-tertiary, #8a857e)"; }}
                  >
                    + add line
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {error && (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              border: "1px solid rgba(255, 26, 140, 0.4)",
              borderRadius: 8,
              background: "rgba(255, 26, 140, 0.08)",
              color: "var(--color-fuchsia, #ff1a8c)",
              fontFamily: "var(--font-mono, JetBrains Mono), monospace",
              fontSize: 12,
            }}
          >
            ✗ {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: "1px solid var(--color-line, rgba(255,255,255,0.07))",
          padding: "12px 18px",
          display: "grid",
          gap: 10,
        }}
      >
        {lengthAdvice && (
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-mono, JetBrains Mono), monospace",
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--color-text-tertiary, #8a857e)",
            }}
          >
            {lengthAdvice}
          </p>
        )}
        <button
          type="button"
          onClick={handleApply}
          disabled={baking || !state || state.syncStatus !== "dirty"}
          aria-label="Apply caption edits and re-render"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            padding: "14px 18px",
            border: "none",
            borderRadius: 999,
            background: baking
              ? "var(--color-paper-warm, #15151c)"
              : "linear-gradient(135deg, #ff1a8c 0%, #c70066 55%, #ff66b8 100%)",
            color: baking ? "var(--color-ink-soft, #c8c4be)" : "#fff",
            fontFamily: "var(--font-mono, JetBrains Mono), monospace",
            fontWeight: 800,
            fontSize: 13,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            cursor: baking || state?.syncStatus !== "dirty" ? "default" : "pointer",
            opacity: !state || state.syncStatus !== "dirty" && !baking ? 0.55 : 1,
            boxShadow: !baking && state?.syncStatus === "dirty"
              ? "0 0 0 1px rgba(255, 26, 140, 0.45), 0 12px 36px rgba(255, 26, 140, 0.28)"
              : undefined,
            transition: "box-shadow 200ms, transform 150ms",
          }}
        >
          {baking ? <InvaderFleet count={6} /> : "▸ Apply · re-render"}
        </button>

        <div style={{ display: "flex", gap: 8, fontSize: 10, justifyContent: "space-between" }}>
          <button type="button" onClick={handleUndo} style={footerBtnStyle}>↶ Undo</button>
          <button type="button" onClick={handleRedo} style={footerBtnStyle}>↷ Redo</button>
        </div>
      </div>

      {autoFixToast && <Toast text={autoFixToast} />}
    </aside>
  );
}

// ----- helpers -------------------------------------------------------------

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-mono, JetBrains Mono), monospace",
        fontSize: 10,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: "var(--color-text-tertiary, #8a857e)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SyncDot({ status }: { status: "synced" | "dirty" | "baking" | "error" }) {
  const color =
    status === "synced" ? "var(--color-cyan, #00e5ff)" :
    status === "dirty"  ? "var(--color-fuchsia, #ff1a8c)" :
    status === "error"  ? "#ff3344" :
                          "var(--color-cyan, #00e5ff)";
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 8px ${color}`,
      }}
      title={`captions ${status}`}
    />
  );
}

function InvaderFleet({ count = 6 }: { count?: number }) {
  // Multiplying-Invader loader — matches the marketing site's signature.
  return (
    <span style={{ display: "inline-flex", alignItems: "flex-end", gap: 6, height: 22 }}>
      {Array.from({ length: count }).map((_, i) => (
        <img
          key={i}
          src={invaderSrc}
          alt=""
          width={16}
          height={16}
          style={{
            imageRendering: "pixelated",
            animation: `cap-spawn 1.6s infinite ease-out`,
            animationDelay: `${i * 0.18}s`,
            opacity: 0,
            transform: "scale(0)",
          }}
        />
      ))}
      <style>{`
        @keyframes cap-spawn {
          0% { opacity: 0; transform: scale(0) translateY(8px); }
          20% { opacity: 1; transform: scale(1.15) translateY(0); }
          78% { opacity: 1; transform: scale(1) translateY(0); }
          100% { opacity: 0; transform: scale(0.6) translateY(-6px); }
        }
      `}</style>
    </span>
  );
}

function EmptyState({
  slug,
  clipIdx,
  onLoaded,
  onClose,
}: {
  slug: string;
  clipIdx: number;
  onLoaded: (lines: CaptionLine[]) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{
    hasTranscript: boolean;
    transcriptError?: string | null;
    hasWordData: boolean;
  } | null>(null);

  // Probe the sidecar once on mount so we can show the HONEST empty state
  // (transcript missing vs. transcript present but no words in this clip's
  // window vs. transcript readable but corrupt).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    sidecar
      .getCaptions(slug, clipIdx)
      .then((res) => {
        if (cancelled) return;
        if (res.lines.length > 0) {
          onLoaded(res.lines as CaptionLine[]);
          return;
        }
        setStatus({
          hasTranscript: res.has_transcript,
          transcriptError: res.transcript_error ?? null,
          hasWordData: res.has_word_data,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({ hasTranscript: false, hasWordData: false });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [slug, clipIdx, onLoaded]);

  // Pick the message + CTA that matches the actual failure mode. No more
  // dead-end "Try again" that hits the same empty result on every click.
  const { headline, body, action } = useMemo(() => {
    if (loading) {
      return { headline: "Checking transcript…", body: null, action: null };
    }
    if (!status) {
      return {
        headline: "No captions on this clip",
        body: null,
        action: { label: "Close", onClick: onClose },
      };
    }
    if (status.transcriptError) {
      return {
        headline: "Transcript file unreadable",
        body: `${status.transcriptError}. Re-run Lift Transcript from the project view to rebuild it.`,
        action: { label: "Close drawer", onClick: onClose },
      };
    }
    if (!status.hasTranscript) {
      return {
        headline: "No transcript on this project yet",
        body: "Captions need a word-level transcript to start. Close this drawer, run Lift Transcript on the source video, and the AI groupings will load here automatically.",
        action: { label: "Close drawer", onClick: onClose },
      };
    }
    if (!status.hasWordData) {
      return {
        headline: "Transcript has no word-level timestamps",
        body: "The drawer needs word timestamps for karaoke caption fill. Re-run Lift Transcript in Full Polish mode (Fast Draft skips word timing for speed).",
        action: { label: "Close drawer", onClick: onClose },
      };
    }
    // Transcript exists, word data is there, but no words fall inside this
    // clip's [start, end] window — clip has no spoken audio. Honest message,
    // no retry button (retry would hit the same empty result).
    return {
      headline: "No spoken words in this clip's window",
      body: "Captions only render on speech. If the clip is mostly music or silence, there's nothing to caption — that's expected.",
      action: { label: "Close drawer", onClick: onClose },
    };
  }, [loading, status, onClose]);

  return (
    <div style={{ textAlign: "center", padding: "40px 8px" }}>
      <img src={invaderSrc} alt="" width={48} height={48} style={{ imageRendering: "pixelated", opacity: 0.7 }} />
      <p
        style={{
          margin: "16px 0 8px",
          fontFamily: "var(--font-mono, JetBrains Mono), monospace",
          fontSize: 11,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--color-text-tertiary, #8a857e)",
        }}
      >
        {headline}
      </p>
      {body && (
        <p
          style={{
            margin: "8px auto 0",
            maxWidth: 320,
            fontFamily: "var(--font-sans, Inter), sans-serif",
            fontSize: 13,
            lineHeight: 1.55,
            color: "var(--color-text-secondary, #c8c4be)",
          }}
        >
          {body}
        </p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          style={{
            marginTop: 18,
            padding: "10px 18px",
            border: "1px solid rgba(0, 229, 255, 0.4)",
            background: "rgba(0, 229, 255, 0.08)",
            color: "var(--color-cyan, #00e5ff)",
            fontFamily: "var(--font-mono, JetBrains Mono), monospace",
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            borderRadius: 999,
            cursor: "pointer",
          }}
        >
          ▸ {action.label}
        </button>
      )}
    </div>
  );
}

function Toast({ text }: { text: string }) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 90,
        left: 18,
        right: 18,
        padding: "10px 14px",
        borderRadius: 8,
        background: "var(--color-paper-warm, #15151c)",
        border: "1px solid var(--color-cyan, #00e5ff)",
        color: "var(--color-cyan, #00e5ff)",
        fontFamily: "var(--font-mono, JetBrains Mono), monospace",
        fontSize: 11,
        letterSpacing: "0.08em",
        boxShadow: "0 12px 36px rgba(0,0,0,0.6)",
      }}
      role="status"
    >
      {text}
    </div>
  );
}

const footerBtnStyle: React.CSSProperties = {
  flex: 1,
  background: "transparent",
  border: "1px solid var(--color-line, rgba(255,255,255,0.07))",
  color: "var(--color-ink-soft, #c8c4be)",
  padding: "8px 12px",
  fontFamily: "var(--font-mono, JetBrains Mono), monospace",
  fontSize: 10,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  borderRadius: 999,
  cursor: "pointer",
};

// Re-export overlay for parents that want to render it inside their own video frame.
export { CaptionOverlay };
