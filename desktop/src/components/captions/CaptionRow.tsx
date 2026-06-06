import { useEffect, useRef, useState } from "react";
import type { CaptionLine } from "../../lib/captions";

// One row in the caption-edit table.
//
// Collapsed (default): timestamps · text · low-confidence pip.
// Focused (click): inline text editor + start/end nudge handles + delete.

export function CaptionRow({
  line,
  index,
  isCurrent,
  onTextChange,
  onTimeChange,
  onSeek,
  onDelete,
}: {
  line: CaptionLine;
  index: number;
  /** True when the playhead is inside this line's window — highlights row. */
  isCurrent: boolean;
  onTextChange: (text: string) => void;
  onTimeChange: (start: number, end: number) => void;
  onSeek: (t: number) => void;
  onDelete: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [draftText, setDraftText] = useState(line.text);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Keep draftText in sync if the line changes externally (e.g. ASR auto-fix).
  useEffect(() => {
    if (!focused) setDraftText(line.text);
  }, [line.text, focused]);

  // Auto-grow the textarea to fit its content.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draftText, focused]);

  const lowConfidence = (line.confidence ?? 1) < 0.7;

  return (
    <div
      role="row"
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        // Commit draft on blur unless focus moved within the row.
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setFocused(false);
          if (draftText !== line.text) onTextChange(draftText);
        }
      }}
      onClick={() => setFocused(true)}
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        background: isCurrent
          ? "color-mix(in srgb, var(--color-fuchsia, #ff1a8c) 14%, var(--color-paper-warm, #15151c))"
          : "var(--color-paper-warm, #15151c)",
        border: "1px solid var(--color-line, rgba(255,255,255,0.07))",
        borderLeft: focused
          ? "3px solid var(--color-fuchsia, #ff1a8c)"
          : "1px solid var(--color-line, rgba(255,255,255,0.07))",
        cursor: "text",
      }}
      aria-label={`Caption line ${index + 1}: ${line.text}`}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontFamily: "var(--font-mono, JetBrains Mono), monospace",
          fontSize: 11,
          letterSpacing: "0.08em",
          color: "var(--color-cyan, #00e5ff)",
        }}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onSeek(line.start); }}
          aria-label="Seek to line start"
          style={{
            background: "transparent",
            border: "1px solid rgba(0, 229, 255, 0.32)",
            color: "var(--color-cyan, #00e5ff)",
            padding: "2px 6px",
            borderRadius: 4,
            fontFamily: "inherit",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          {formatTime(line.start)}
        </button>
        <span style={{ color: "var(--color-text-tertiary, #8a857e)" }}>━</span>
        <span>{formatTime(line.end)}</span>
        {lowConfidence && (
          <span
            style={{
              marginLeft: "auto",
              color: "var(--color-fuchsia, #ff1a8c)",
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            ● VERIFY
          </span>
        )}
        {line.modified && !lowConfidence && (
          <span
            style={{
              marginLeft: "auto",
              color: "var(--color-fuchsia, #ff1a8c)",
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            ● MOD
          </span>
        )}
      </div>

      {focused ? (
        <textarea
          ref={inputRef}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraftText(line.text);
              setFocused(false);
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          autoFocus
          rows={1}
          style={{
            display: "block",
            width: "100%",
            marginTop: 8,
            padding: "6px 4px",
            border: "none",
            outline: "none",
            background: "transparent",
            color: "var(--color-ink, #f4f1ea)",
            fontFamily: "var(--font-sans, Inter), sans-serif",
            fontSize: 15,
            lineHeight: 1.4,
            resize: "none",
            overflow: "hidden",
          }}
        />
      ) : (
        <p
          style={{
            margin: "8px 0 0",
            color: "var(--color-ink, #f4f1ea)",
            fontFamily: "var(--font-sans, Inter), sans-serif",
            fontSize: 15,
            lineHeight: 1.4,
            wordBreak: "break-word",
          }}
        >
          {line.text}
        </p>
      )}

      {focused && (
        <div style={{ display: "flex", gap: 12, marginTop: 8, alignItems: "center" }}>
          <TimeNudge
            label="start"
            value={line.start}
            onChange={(v) => onTimeChange(Math.max(0, v), Math.max(v + 0.1, line.end))}
          />
          <TimeNudge
            label="end"
            value={line.end}
            onChange={(v) => onTimeChange(line.start, Math.max(line.start + 0.1, v))}
          />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            aria-label="Delete this caption line"
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "1px solid rgba(255, 26, 140, 0.32)",
              color: "var(--color-fuchsia, #ff1a8c)",
              padding: "4px 10px",
              borderRadius: 6,
              fontFamily: "var(--font-mono, JetBrains Mono), monospace",
              fontSize: 11,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            ✕ delete
          </button>
        </div>
      )}
    </div>
  );
}

function TimeNudge({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span
        style={{
          fontFamily: "var(--font-mono, JetBrains Mono), monospace",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-text-tertiary, #8a857e)",
        }}
      >
        {label}
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onChange(value - 0.1); }}
        aria-label={`Decrease ${label}`}
        style={nudgeBtnStyle}
      >
        −
      </button>
      <span
        style={{
          fontFamily: "var(--font-mono, JetBrains Mono), monospace",
          fontSize: 11,
          color: "var(--color-cyan, #00e5ff)",
          minWidth: 56,
          textAlign: "center",
        }}
      >
        {formatTime(value)}
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onChange(value + 0.1); }}
        aria-label={`Increase ${label}`}
        style={nudgeBtnStyle}
      >
        +
      </button>
    </div>
  );
}

const nudgeBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(0, 229, 255, 0.32)",
  color: "var(--color-cyan, #00e5ff)",
  width: 22,
  height: 22,
  borderRadius: 5,
  fontSize: 14,
  lineHeight: 1,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

function formatTime(s: number): string {
  const sign = s < 0 ? "-" : "";
  const abs = Math.abs(s);
  const m = Math.floor(abs / 60);
  const rest = abs - m * 60;
  return `${sign}${String(m).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}
