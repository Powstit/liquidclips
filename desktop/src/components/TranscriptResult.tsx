import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { LiftTranscriptResult } from "../lib/sidecar";
import { PlatformIcon, type PlatformId } from "./PlatformIcon";

// Result screen for the "Lift transcript" path. No clipping, no LLM — just the
// transcript, the poster, the original caption, and a clean way to copy/open.

export function TranscriptResult({
  result,
  onDone,
}: {
  result: LiftTranscriptResult;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState<"transcript" | "caption" | null>(null);
  // Defensive — if the sidecar payload is missing fields the type promised
  // (e.g. partial JSON, schema drift after sidecar upgrade), we render with
  // fallbacks instead of throwing a TypeError that React 18 surfaces as a
  // fully blank app window.
  const meta = result.meta ?? ({} as Partial<LiftTranscriptResult["meta"]>);
  const segments = Array.isArray(result.segments) ? result.segments : [];
  const platform = result.platform === "link" ? "instagram" : (result.platform as PlatformId);
  const posterSrc = meta.poster_path ? convertFileSrc(meta.poster_path) : null;
  const title = meta.title || "Untitled";
  const uploader = meta.uploader || "—";

  async function copy(kind: "transcript" | "caption", text: string) {
    try {
      await writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1800);
    } catch (e) {
      console.warn("copy failed", e);
    }
  }

  return (
    <div className="w-full max-w-[920px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
            Lifted
          </div>
          <h2 className="mt-1 font-display text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">
            Transcript ready.
          </h2>
          <p className="mt-1 font-mono text-[11px] text-text-tertiary">
            {formatDuration(result.duration ?? 0)} · {(result.language || "unknown").toUpperCase()} · {segments.length} segment{segments.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          onClick={onDone}
          className="rounded-full bg-fuchsia px-5 py-2.5 font-sans text-[14px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)]"
        >
          Lift another →
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
        <div className="flex flex-col gap-3">
          <div className="relative overflow-hidden rounded-2xl border border-line bg-ink shadow-[0_2px_12px_rgba(15,15,18,0.06)]">
            {posterSrc ? (
              <img
                src={posterSrc}
                alt={title}
                className="aspect-[9/16] w-full object-cover"
              />
            ) : (
              <div className="grid aspect-[9/16] w-full place-items-center font-mono text-[11px] text-paper/60">
                no poster
              </div>
            )}
            <div className="absolute left-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/70 text-paper backdrop-blur-md">
              <PlatformIcon id={platform} className="h-4 w-4" />
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-paper p-4">
            <h3 className="font-display text-[15px] font-semibold leading-snug tracking-[-0.01em] text-ink line-clamp-3">
              {title}
            </h3>
            <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary">
              {uploader}
            </p>
            <button
              onClick={() => void openExternal(meta.source_url ?? "")}
              className="mt-3 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-fuchsia-deep hover:text-fuchsia"
            >
              View original ↗
            </button>
          </div>

          {meta.description && (
            <div className="rounded-2xl border border-line bg-paper-warm/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                  Original caption
                </span>
                <button
                  onClick={() => void copy("caption", meta.description!)}
                  className="rounded-full border border-line bg-paper px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary hover:border-fuchsia hover:text-ink"
                >
                  {copied === "caption" ? "copied" : "copy"}
                </button>
              </div>
              <p className="mt-2 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink line-clamp-[12]">
                {meta.description}
              </p>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-paper p-5 shadow-[0_2px_12px_rgba(15,15,18,0.04)]">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
              Transcript
            </span>
            <button
              onClick={() => void copy("transcript", buildPlainText(result))}
              className="rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[13px] font-medium text-white transition-all hover:bg-fuchsia-bright"
            >
              {copied === "transcript" ? "Copied" : "Copy all"}
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {segments.map((seg, i) => (
              <div
                key={i}
                className="grid grid-cols-[60px_1fr] gap-3 border-b border-line/50 pb-3 last:border-0 last:pb-0"
              >
                <span className="font-mono text-[11px] leading-relaxed text-text-tertiary">
                  {formatTimestamp(seg.start)}
                </span>
                <p className="font-sans text-[14px] leading-relaxed text-ink">
                  {seg.text}
                </p>
              </div>
            ))}
            {segments.length === 0 && (
              <p className="font-mono text-[12px] text-text-tertiary">
                No speech detected. The video might be silent or music-only.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LiftingProgress({
  url,
  phase,
  percent,
  onCancel,
}: {
  url: string;
  phase: "downloading" | "transcribing" | "done";
  percent: number | null;
  // Optional. When provided, a Cancel button renders in the header. App.tsx
  // wires this to sidecar.liftCancel() which writes a cancel marker the
  // running lift_transcript polls every 2s.
  onCancel?: () => void;
}) {
  const label =
    phase === "downloading"
      ? "Downloading audio"
      : phase === "transcribing"
      ? "Transcribing"
      : "Finishing up";
  const pct = percent != null ? Math.min(100, Math.max(0, percent)) : null;
  return (
    <div className="w-full max-w-[520px]">
      <div className="rounded-2xl border border-line bg-paper p-6 shadow-[0_2px_12px_rgba(15,15,18,0.04)]">
        <div className="flex items-center justify-between gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
          <span className="flex items-center gap-2">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
            {label}
          </span>
          {onCancel && (
            <button
              onClick={onCancel}
              className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary transition-colors hover:border-[#DC2626] hover:text-[#DC2626]"
            >
              Cancel
            </button>
          )}
        </div>
        <h2 className="mt-3 font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Lifting the transcript.
        </h2>
        <p className="mt-1 truncate font-mono text-[11px] text-text-tertiary">{url}</p>

        <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-paper-elev/60">
          {pct != null ? (
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${pct}%`,
                background: "var(--grad-fuchsia)",
                boxShadow: "var(--glow-sm)",
              }}
            />
          ) : (
            // Indeterminate phase — shimmer instead of a fake fixed %.
            <div className="working-stage-shimmer h-full w-1/3 rounded-full" />
          )}
        </div>
        <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          <span className={phase === "downloading" ? "text-fuchsia-deep" : ""}>1 · download</span>
          <span className={phase === "transcribing" ? "text-fuchsia-deep" : ""}>2 · transcribe</span>
          <span className={phase === "done" ? "text-fuchsia-deep" : ""}>3 · done</span>
          {pct != null && (
            <span className="ml-2 text-fuchsia-deep tabular-nums">{Math.round(pct)}%</span>
          )}
        </div>
      </div>
    </div>
  );
}

function buildPlainText(result: LiftTranscriptResult): string {
  if (result.text && result.text.trim()) return result.text;
  const segs = Array.isArray(result.segments) ? result.segments : [];
  return segs.map((s) => s.text).join(" ");
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}
