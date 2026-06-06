import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { humanError, sidecar } from "../../lib/sidecar";
import {
  History,
  applyPatch,
  autoFixLines,
  lengthOpinion,
  type CaptionLine,
  type CaptionState,
} from "../../lib/captions";
import {
  CAPTION_STYLES,
  CAPTION_STYLE_KEYS,
  CAPTION_MARGIN_V_MAX,
  type CaptionStyleKey,
  type CaptionPalette,
  type CaptionPosition,
} from "../../lib/caption-styles";
import { HexColorPicker } from "react-colorful";
import { CaptionOverlay } from "./CaptionOverlay";
import { CaptionRow } from "./CaptionRow";
import { CaptionStyleCard } from "./CaptionStyleCard";
import { ConfirmDialog } from "../ConfirmDialog";
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
  onPreviewChange,
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
  /** Live preview pipe — fires on every state mutation so the parent overlay
   *  reflects style/palette/line edits BEFORE Apply re-bakes the MP4. Cheap:
   *  payload is the same CaptionState the drawer already holds, parent just
   *  uses it to override the clip-baked style. */
  onPreviewChange?: (preview: {
    style: CaptionStyleKey;
    palette?: CaptionPalette;
    /** User-picked caption position — undefined when the clipper hasn't
     *  repositioned so the overlay falls back to the style's hardcoded
     *  marginVPercent. */
    position?: CaptionPosition;
    lines: CaptionLine[];
  } | null) => void;
}) {
  const [state, setState] = useState<CaptionState | null>(null);
  const [loading, setLoading] = useState(false);
  const [baking, setBaking] = useState(false);
  const [autoFixToast, setAutoFixToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Branded confirm replaces window.confirm() — the native dialog blocked
  // the Tauri webview thread and broke cockpit voice on every close-with-
  // unsaved-edits.
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
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
          // Rehydrate persisted custom palette if the user shipped this clip
          // with custom colours. Undefined for preset-style clips — drawer
          // falls back to the "custom" preset defaults when the user toggles
          // Custom on for the first time.
          palette: res.palette ?? undefined,
          // Rehydrate persisted position (top/middle/bottom + vertical
          // offset). Undefined means "never repositioned" — the bake uses
          // the style's hardcoded margin so existing clips with no override
          // re-render byte-identical.
          position: res.position ?? undefined,
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
        setError(humanError(e));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, slug, clipIdx]);

  // Tell parent whether we have unsaved edits.
  useEffect(() => {
    onDirtyChange?.(state?.syncStatus === "dirty");
  }, [state?.syncStatus, onDirtyChange]);

  // Live preview pipe — push style/palette/lines to the parent overlay on
  // every state change so the live caption surface reflects the clipper's
  // edits before the bake commits. Nulled on close so the overlay falls
  // back to the clip's baked spec.
  useEffect(() => {
    if (!state || !open) {
      onPreviewChange?.(null);
      return;
    }
    onPreviewChange?.({
      style: state.style,
      palette: state.palette,
      position: state.position,
      lines: state.lines,
    });
  }, [state, open, onPreviewChange]);

  const mutate = useCallback((next: CaptionState) => {
    history.current.push(state!);
    setState(next);
  }, [state]);

  const handleStyleChange = useCallback((styleKey: CaptionStyleKey) => {
    if (!state || state.style === styleKey) return;
    mutate(applyPatch(state, { kind: "style", value: styleKey }));
  }, [state, mutate]);

  // Position control — radio + slider. We treat the in-state `position` as
  // the source of truth and ALWAYS push a complete {align, marginV} pair so
  // the slider can't strand the state with a half-set override.
  const handlePositionChange = useCallback(
    (next: CaptionPosition) => {
      if (!state) return;
      mutate(applyPatch(state, { kind: "position", value: next }));
    },
    [state, mutate],
  );

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

  // Per-word colour edit — used by the WordPaintStrip under each row. Walks
  // the line's `words` array, swaps the colour on the matched word, and
  // re-runs through applyPatch as a "text" no-op so the line gets a
  // syncStatus="dirty" flip + history entry. Mirror of the line-level text
  // patch but mutates the words sub-array instead of the line text.
  const handleWordColor = useCallback(
    (lineIdx: number, wordIdx: number, color: string | undefined) => {
      if (!state) return;
      const target = state.lines[lineIdx];
      if (!target || !target.words || wordIdx < 0 || wordIdx >= target.words.length) {
        return;
      }
      const nextWords = target.words.map((w, j) => {
        if (j !== wordIdx) return w;
        // Drop the field entirely when clearing so a colourless word
        // serialises identically to a pre-feature word (no `color: null`
        // residue) — the BREAKS clause in the spec.
        if (!color) {
          const { color: _drop, ...rest } = w;
          return rest;
        }
        return { ...w, color };
      });
      const nextLines = state.lines.map((ln, i) =>
        i === lineIdx ? { ...ln, words: nextWords, modified: true } : ln,
      );
      // Push current state onto history before mutating (mirrors `mutate`).
      history.current.push(state);
      setState({ ...state, lines: nextLines, syncStatus: "dirty" });
    },
    [state],
  );

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
      setConfirmDiscardOpen(true);
      return;
    }
    onClose();
  }, [state?.syncStatus, onClose]);

  const handleApply = useCallback(async () => {
    if (!state || baking) return;
    setBaking(true);
    setError(null);
    try {
      // Only ship the palette when the user actually picked Custom. Sending
      // it on a preset style change would over-persist and cause toggling
      // back to brand_fuchsia to silently keep the user's custom colours.
      const palette = state.style === "custom" ? state.palette ?? null : null;
      // Only ship position when the clipper actually moved the captions —
      // sending an undefined-override would force every existing clip's
      // bake to re-emit the style's hardcoded margin verbatim. Sending
      // null preserves the BREAKS guarantee: clips with no override
      // re-render byte-identical.
      const position = state.position ?? null;
      const res = await sidecar.editCaptions(
        slug,
        clipIdx,
        state.lines,
        state.style,
        palette,
        position,
      );
      const synced: CaptionState = {
        ...state,
        syncStatus: "synced",
        updatedAt: res.updated_at,
        // Cache the ASS text so the libass-wasm overlay shows the rendered
        // version instead of falling back to the DOM approximation.
        assText: res.ass_text ?? state.assText,
      };
      setState(synced);
      history.current = new History();
      history.current.push(synced);
      onApplied(res.video_path, state.style);
    } catch (e) {
      setError(humanError(e));
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
        // Race guard — if a bake is already in flight, Cmd-S must not stack
        // a second RPC on top. handleApply has its own `if (baking) return`
        // guard, but checking here keeps the keypress from preventDefault-
        // stealing focus during a long render.
        if (baking) return;
        void handleApply();
      } else if (e.key === "Escape") {
        tryClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleUndo, handleRedo, state?.syncStatus, tryClose, handleApply, baking]);

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
    <>
    <ConfirmDialog
      open={confirmDiscardOpen}
      tone="destructive"
      title="Discard caption edits?"
      body={<>You have unsaved caption edits. Closing the drawer will throw them away.</>}
      confirmLabel="Discard edits"
      onCancel={() => setConfirmDiscardOpen(false)}
      onConfirm={() => {
        setConfirmDiscardOpen(false);
        onClose();
      }}
    />
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

            {/* Custom palette pickers — visible only when Custom is active.
                Three react-colorful pads (primary / secondary / outline) +
                hex inputs for keyboard-only users. Live overlay updates as
                the clipper drags; Apply re-bakes the MP4. */}
            {state.style === "custom" && (
              <CustomPaletteEditor
                palette={state.palette}
                onChange={(value: CaptionPalette) =>
                  mutate(applyPatch(state, { kind: "palette", value }))
                }
              />
            )}

            <SectionLabel style={{ marginTop: 18 }}>Position</SectionLabel>
            <CaptionPositionEditor
              styleKey={state.style}
              position={state.position}
              onChange={handlePositionChange}
            />

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
                  {ln.words && ln.words.length > 0 && (
                    <WordPaintStrip
                      line={ln}
                      onWordColor={(wordIdx, color) =>
                        handleWordColor(i, wordIdx, color)
                      }
                    />
                  )}
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
    </>
  );
}

// ----- helpers -------------------------------------------------------------

// Caption position editor — three radios (Top / Centre / Bottom) + a vertical
// offset slider. Mirrors libass `Alignment` numpad values (8/5/2) and writes
// directly into `marginV` (matches the Python style's margin_v field).
//
// Behaviour notes:
// - Initial render seeds the slider from the active style's hardcoded margin
//   so the clipper sees the same number their previous bake used.
// - Slider is capped at CAPTION_MARGIN_V_MAX (400px on a 1920-tall canvas)
//   so a wild drag can't push the caption block off-screen — matches the
//   Python clamp in `_build_style_line` so UI + bake agree on the ceiling.
// - We ALWAYS write a full {align, marginV} pair on every change so the
//   sidecar never receives a half-set override.
function CaptionPositionEditor({
  styleKey,
  position,
  onChange,
}: {
  styleKey: CaptionStyleKey;
  position: CaptionPosition | undefined;
  onChange: (next: CaptionPosition) => void;
}) {
  const spec = CAPTION_STYLES[styleKey] ?? CAPTION_STYLES.brand_fuchsia;
  // The style's hardcoded vertical margin in canvas px (1920-tall reference).
  // Used as the slider's seed value when no override is set yet.
  const styleMarginV = Math.round((spec.marginVPercent / 100) * 1920);
  const align = position?.align ?? 2;
  const marginV = position?.marginV ?? styleMarginV;

  const options: { value: 2 | 5 | 8; label: string }[] = [
    { value: 8, label: "Top" },
    { value: 5, label: "Centre" },
    { value: 2, label: "Bottom" },
  ];

  return (
    <div
      style={{
        marginTop: 8,
        padding: 12,
        borderRadius: 12,
        border: "1px solid var(--color-line, rgba(255,255,255,0.12))",
        background: "var(--color-paper-warm, rgba(255,255,255,0.02))",
        display: "grid",
        gap: 12,
      }}
    >
      <div
        role="radiogroup"
        aria-label="Caption vertical alignment"
        style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}
      >
        {options.map((opt) => {
          const active = align === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange({ align: opt.value, marginV })}
              style={{
                padding: "10px 8px",
                borderRadius: 8,
                border: active
                  ? "1px solid var(--color-fuchsia, #ff1a8c)"
                  : "1px solid var(--color-line, rgba(255,255,255,0.12))",
                background: active
                  ? "rgba(255, 26, 140, 0.12)"
                  : "transparent",
                color: active
                  ? "var(--color-fuchsia, #ff1a8c)"
                  : "var(--color-ink-soft, #c8c4be)",
                fontFamily: "var(--font-mono, JetBrains Mono), monospace",
                fontSize: 10,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                cursor: "pointer",
                fontWeight: active ? 800 : 500,
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        <label
          htmlFor="caption-position-margin"
          style={{
            fontFamily: "var(--font-mono, JetBrains Mono), monospace",
            fontSize: 9,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--color-text-tertiary, #8a857e)",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>Vertical offset</span>
          <span>{marginV}px</span>
        </label>
        <input
          id="caption-position-margin"
          type="range"
          min={0}
          max={CAPTION_MARGIN_V_MAX}
          step={1}
          value={marginV}
          // Range inputs fire onChange on every pointer tick — we treat each
          // tick as a discrete patch so the live overlay tracks the drag in
          // real time. Cmd-Z collapses runs of slider patches the same way
          // it would for text edits.
          onChange={(e) =>
            onChange({ align, marginV: Number(e.target.value) })
          }
          aria-valuemin={0}
          aria-valuemax={CAPTION_MARGIN_V_MAX}
          aria-valuenow={marginV}
          aria-label="Caption vertical offset in pixels"
          style={{ width: "100%", accentColor: "#ff1a8c" }}
        />
      </div>
    </div>
  );
}

// Custom palette editor — three react-colorful pads (primary / secondary /
// outline) + hex inputs for keyboard users + a contrast warning when the
// primary and outline collide (unreadable captions).
//
// Defaults come from the "custom" preset spec so a clipper who opens this
// for the first time sees brand-safe starter colours, not blank pads.
function CustomPaletteEditor({
  palette,
  onChange,
}: {
  palette: CaptionPalette | undefined;
  onChange: (next: CaptionPalette) => void;
}) {
  const defaults = CAPTION_STYLES.custom;
  const primary = palette?.primary ?? defaults.primary;
  const secondary = palette?.secondary ?? defaults.secondary;
  const outline = palette?.outline ?? defaults.outline;

  // Crude contrast check — primary fill vs. outline colour. When they're
  // close (Euclidean distance in RGB < 60) the caption reads as a smudge.
  // Inline pill, not a blocking toast — clippers know what they're doing.
  const lowContrast = colourDistance(primary, outline) < 60;

  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        borderRadius: 12,
        border: "1px solid var(--color-line, rgba(255,255,255,0.12))",
        background: "var(--color-paper-warm, rgba(255,255,255,0.02))",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono, JetBrains Mono), monospace",
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--color-text-tertiary, #8a857e)",
          }}
        >
          custom palette
        </span>
        {lowContrast && (
          <span
            role="status"
            style={{
              fontFamily: "var(--font-mono, JetBrains Mono), monospace",
              fontSize: 9,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#DC2626",
              padding: "2px 6px",
              borderRadius: 999,
              background: "rgba(220, 38, 38, 0.1)",
              border: "1px solid rgba(220, 38, 38, 0.3)",
            }}
          >
            low contrast
          </span>
        )}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
        }}
      >
        <PaletteSwatch
          label="Fill"
          value={primary}
          onChange={(v) => onChange({ primary: v })}
        />
        <PaletteSwatch
          label="Baseline"
          value={secondary}
          onChange={(v) => onChange({ secondary: v })}
        />
        <PaletteSwatch
          label="Outline"
          value={outline}
          onChange={(v) => onChange({ outline: v })}
        />
      </div>
    </div>
  );
}

function PaletteSwatch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontFamily: "var(--font-mono, JetBrains Mono), monospace",
          fontSize: 9,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--color-text-tertiary, #8a857e)",
        }}
      >
        {label}
      </span>
      <HexColorPicker
        color={value}
        onChange={onChange}
        style={{ width: "100%", height: 96 }}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => {
          const raw = e.target.value.trim();
          const next = raw.startsWith("#") ? raw : `#${raw}`;
          if (/^#[0-9a-fA-F]{6}$/.test(next) || /^#[0-9a-fA-F]{3}$/.test(next)) {
            onChange(next);
          }
        }}
        aria-label={`${label} colour hex value`}
        style={{
          fontFamily: "var(--font-mono, JetBrains Mono), monospace",
          fontSize: 10,
          padding: "4px 8px",
          borderRadius: 6,
          border: "1px solid var(--color-line, rgba(255,255,255,0.12))",
          background: "transparent",
          color: "var(--color-ink, #f4f1ea)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      />
    </div>
  );
}

function colourDistance(a: string, b: string): number {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return 999; // treat unparseable as far apart (no warning)
  const dr = pa[0] - pb[0];
  const dg = pa[1] - pb[1];
  const db = pa[2] - pb[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function parseHex(raw: string): [number, number, number] | null {
  const h = raw.replace("#", "").trim();
  const norm = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(norm)) return null;
  return [
    parseInt(norm.slice(0, 2), 16),
    parseInt(norm.slice(2, 4), 16),
    parseInt(norm.slice(4, 6), 16),
  ];
}

// Per-word colour painter — the "money word" feature. Shows every word in the
// line on a horizontal strip with a tiny coloured dot beneath each one.
// Click a dot → react-colorful popover → pick a hex → that word renders in
// that colour on the next bake. "Clear" link inside the popover removes the
// override so the word falls back to the style's primary fill.
//
// Lens self-check:
//  - ENABLES — clipper paints "save 50%" green in 2 clicks without re-cutting
//    the whole line.
//  - PREVENTS — the "re-cut a whole line to colour one word" pain that drove
//    creators to CapCut.
//  - BREAKS — words with no `color` field serialise unchanged → bakes are
//    byte-identical to today for lines the clipper hasn't touched.
//  - STRANDS — lines without word timings (manual-add) render the placeholder
//    "no per-word timings — re-run Lift Transcript to enable colour painting"
//    chip via the `ln.words && ln.words.length > 0` guard in the parent. The
//    popover Esc-closes; Tab moves focus back to the strip.
function WordPaintStrip({
  line,
  onWordColor,
}: {
  line: CaptionLine;
  onWordColor: (wordIdx: number, color: string | undefined) => void;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const words = line.words ?? [];

  // Esc-close so the popover doesn't trap keyboard users.
  useEffect(() => {
    if (openIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation(); // don't let the drawer-level Esc close the drawer
        setOpenIdx(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [openIdx]);

  if (words.length === 0) return null;

  return (
    <div
      style={{
        position: "relative",
        marginTop: 8,
        padding: "8px 10px",
        borderRadius: 8,
        background: "rgba(255,255,255,0.02)",
        border: "1px dashed rgba(255,255,255,0.06)",
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        alignItems: "flex-start",
      }}
      aria-label="Per-word colour painter"
    >
      {words.map((w, i) => (
        <WordDot
          key={`${i}-${w.text}`}
          text={w.text}
          color={w.color}
          isOpen={openIdx === i}
          onToggle={() => setOpenIdx((cur) => (cur === i ? null : i))}
          onColorChange={(c) => onWordColor(i, c)}
          onClear={() => {
            onWordColor(i, undefined);
            setOpenIdx(null);
          }}
        />
      ))}
    </div>
  );
}

function WordDot({
  text,
  color,
  isOpen,
  onToggle,
  onColorChange,
  onClear,
}: {
  text: string;
  color: string | undefined;
  isOpen: boolean;
  onToggle: () => void;
  onColorChange: (color: string) => void;
  onClear: () => void;
}) {
  // The popover's working draft — committed onChange so the bake-time state
  // mirrors what the picker shows. We seed from `color` or a brand-safe
  // default fuchsia so first-click never lands on a useless black square.
  const [draft, setDraft] = useState<string>(color ?? "#FF1A8C");
  useEffect(() => {
    setDraft(color ?? "#FF1A8C");
  }, [color]);

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <span
        style={{
          fontFamily: "var(--font-sans, Inter), sans-serif",
          fontSize: 12,
          color: "var(--color-ink, #f4f1ea)",
          maxWidth: 96,
          textAlign: "center",
          wordBreak: "break-word",
        }}
      >
        {text}
      </span>
      <button
        type="button"
        onClick={onToggle}
        aria-label={
          color
            ? `Change colour of "${text}" (currently ${color})`
            : `Paint "${text}" a custom colour`
        }
        aria-pressed={isOpen}
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          padding: 0,
          background: color ?? "transparent",
          border: color
            ? "1px solid rgba(255,255,255,0.4)"
            : "1px dashed rgba(255,255,255,0.32)",
          boxShadow: color ? `0 0 6px ${color}80` : undefined,
          cursor: "pointer",
        }}
      />
      {isOpen && (
        <div
          role="dialog"
          aria-label={`Colour picker for "${text}"`}
          style={{
            position: "absolute",
            top: "100%",
            left: "50%",
            transform: "translate(-50%, 6px)",
            zIndex: 30,
            background: "var(--color-paper-warm, #15151c)",
            border: "1px solid var(--color-line, rgba(255,255,255,0.12))",
            borderRadius: 10,
            padding: 10,
            boxShadow: "0 12px 36px rgba(0,0,0,0.6)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            minWidth: 160,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <HexColorPicker
            color={draft}
            onChange={(c) => {
              setDraft(c);
              onColorChange(c);
            }}
            style={{ width: 160, height: 120 }}
          />
          <input
            type="text"
            value={draft}
            onChange={(e) => {
              const raw = e.target.value.trim();
              const next = raw.startsWith("#") ? raw : `#${raw}`;
              setDraft(next);
              if (/^#[0-9a-fA-F]{6}$/.test(next) || /^#[0-9a-fA-F]{3}$/.test(next)) {
                onColorChange(next);
              }
            }}
            aria-label={`Hex value for "${text}"`}
            style={{
              fontFamily: "var(--font-mono, JetBrains Mono), monospace",
              fontSize: 11,
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid var(--color-line, rgba(255,255,255,0.12))",
              background: "transparent",
              color: "var(--color-ink, #f4f1ea)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          />
          <button
            type="button"
            onClick={onClear}
            disabled={!color}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              fontFamily: "var(--font-mono, JetBrains Mono), monospace",
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: color
                ? "var(--color-cyan, #00e5ff)"
                : "var(--color-text-tertiary, #8a857e)",
              cursor: color ? "pointer" : "default",
              textAlign: "right",
              opacity: color ? 1 : 0.55,
            }}
            aria-label={`Clear colour override on "${text}"`}
          >
            ↺ clear
          </button>
        </div>
      )}
    </div>
  );
}

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
