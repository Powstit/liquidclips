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
  const platform = result.platform === "link" ? "instagram" : (result.platform as PlatformId);
  const posterSrc = result.meta.poster_path ? convertFileSrc(result.meta.poster_path) : null;
  const title = result.meta.title || "Untitled";
  const uploader = result.meta.uploader || "—";

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
            {formatDuration(result.duration)} · {(result.language || "unknown").toUpperCase()} · {result.segments.length} segment{result.segments.length === 1 ? "" : "s"}
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
              onClick={() => void openExternal(result.meta.source_url)}
              className="mt-3 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-fuchsia-deep hover:text-fuchsia"
            >
              View original ↗
            </button>
          </div>

          {result.meta.description && (
            <div className="rounded-2xl border border-line bg-paper-warm/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                  Original caption
                </span>
                <button
                  onClick={() => void copy("caption", result.meta.description!)}
                  className="rounded-full border border-line bg-paper px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary hover:border-fuchsia hover:text-ink"
                >
                  {copied === "caption" ? "copied" : "copy"}
                </button>
              </div>
              <p className="mt-2 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink line-clamp-[12]">
                {result.meta.description}
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
            {result.segments.map((seg, i) => (
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
            {result.segments.length === 0 && (
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
}: {
  url: string;
  phase: "downloading" | "transcribing" | "done";
  percent: number | null;
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
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
          {label}
        </div>
        <h2 className="mt-3 font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Lifting the transcript.
        </h2>
        <p className="mt-1 truncate font-mono text-[11px] text-text-tertiary">{url}</p>

        <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-paper-warm">
          <div
            className="h-full rounded-full bg-fuchsia transition-all duration-300"
            style={{ width: `${pct ?? (phase === "downloading" ? 25 : 65)}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
          <span>1 · download</span>
          <span>2 · transcribe</span>
          <span>3 · done</span>
        </div>
      </div>
    </div>
  );
}

function buildPlainText(result: LiftTranscriptResult): string {
  if (result.text && result.text.trim()) return result.text;
  return result.segments.map((s) => s.text).join(" ");
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
