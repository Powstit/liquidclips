import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { LiftTranscriptResult } from "../lib/sidecar";
import { PlatformIcon, type PlatformId } from "./PlatformIcon";
import { InvadersTrigger } from "./invaders/InvadersTrigger";
import { LiquidInvaderLoader } from "./LiquidInvaderLoader";

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
  // bug-hunt v0.7.18 — onError flips to true when poster file is missing.
  const [posterError, setPosterError] = useState(false);
  const posterSrc = meta.poster_path && !posterError ? convertFileSrc(meta.poster_path) : null;
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
          <div className="cockpit-frame relative overflow-hidden rounded-2xl bg-transparent">
            <span className="cockpit-tile-corner-tl" aria-hidden="true" />
            <span className="cockpit-tile-corner-tr" aria-hidden="true" />
            <span className="cockpit-tile-corner-bl" aria-hidden="true" />
            <span className="cockpit-tile-corner-br" aria-hidden="true" />
            {posterSrc ? (
              <img
                src={posterSrc}
                alt={title}
                className="aspect-[9/16] w-full object-cover"
                onError={() => setPosterError(true)}
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

          <div className="library-card relative rounded-2xl bg-transparent p-4">
            <span className="library-card-corner-tl" aria-hidden="true" />
            <span className="library-card-corner-tr" aria-hidden="true" />
            <span className="library-card-corner-bl" aria-hidden="true" />
            <span className="library-card-corner-br" aria-hidden="true" />
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
            <div className="library-card relative rounded-2xl bg-transparent p-4">
              <span className="library-card-corner-tl" aria-hidden="true" />
              <span className="library-card-corner-tr" aria-hidden="true" />
              <span className="library-card-corner-bl" aria-hidden="true" />
              <span className="library-card-corner-br" aria-hidden="true" />
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                  Original caption
                </span>
                <button
                  onClick={() => void copy("caption", meta.description!)}
                  className="hud-chip hover:!text-fuchsia"
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

        <div className="library-card relative rounded-2xl bg-transparent p-5">
          <span className="library-card-corner-tl" aria-hidden="true" />
          <span className="library-card-corner-tr" aria-hidden="true" />
          <span className="library-card-corner-bl" aria-hidden="true" />
          <span className="library-card-corner-br" aria-hidden="true" />
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
  etaS,
  onCancel,
}: {
  url: string;
  phase: "downloading" | "transcribing" | "done";
  percent: number | null;
  // Seconds remaining. Sidecar emits this on every transcribe progress event;
  // we format as "~3 min left" so the user has an honest expectation instead
  // of guessing from the bar alone.
  etaS?: number | null;
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
  // Unified 0-100% across the whole lift so the bar climbs once instead of
  // resetting when the phase flips (which read as "the app lied — it said
  // 100% but there was more"). Weights: download is fast (~30s), transcribe
  // is the time sink (~5 min). Download = 0-20%, transcribe = 20-100%.
  const unifiedPct = computeUnifiedPct(phase, percent);
  return (
    <div className="w-full max-w-[520px]">
      <div className="library-card relative rounded-2xl bg-transparent p-6">
        <span className="library-card-corner-tl" aria-hidden="true" />
        <span className="library-card-corner-tr" aria-hidden="true" />
        <span className="library-card-corner-bl" aria-hidden="true" />
        <span className="library-card-corner-br" aria-hidden="true" />
        <div className="flex items-center justify-between gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
          <span className="flex items-center gap-2">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
            {label}
          </span>
          {onCancel && (
            <button
              onClick={onCancel}
              className="rounded-full border border-line bg-transparent px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary transition-colors hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
            >
              Cancel
            </button>
          )}
        </div>
        <div className="mt-3 flex items-center gap-3">
          {/* Brand loader — liquid filling the pixel Invader so the user has a
              live visual the moment the lift starts (not just a 0% bar). */}
          <LiquidInvaderLoader size={32} />
          <h2 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
            Lifting the transcript.
          </h2>
        </div>
        <p className="mt-1 truncate font-mono text-[11px] text-text-tertiary">{url}</p>

        <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-paper-elev/60">
          {unifiedPct != null ? (
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${unifiedPct}%`,
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
          {unifiedPct != null && (
            <span className="ml-2 text-fuchsia-deep tabular-nums">{Math.round(unifiedPct)}%</span>
          )}
        </div>
        {phase === "transcribing" && typeof etaS === "number" && etaS > 0 && (
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            ~{formatEta(etaS)} left
          </p>
        )}
        {/* Invaders trigger — long lifts (esp. ~30min audio) sit at the
            transcribe stage for minutes; give the user something to do
            instead of staring at a 0% bar. */}
        <div className="mt-4">
          <InvadersTrigger />
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

// Human-readable countdown for the transcribe ETA. <60s → "Ns", <60m → "Nmin".
function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const m = Math.round(seconds / 60);
  return m === 1 ? "1 min" : `${m} min`;
}

// Bar shows a single monotonic 0-100% across the whole lift. Per-phase
// weights: download is short (~30s), transcribe is the time sink. Keeps the
// bar from hitting 100% then visibly resetting when the phase flips, which
// reads as "the app lied — there's more work after it said done."
function computeUnifiedPct(
  phase: "downloading" | "transcribing" | "done",
  percent: number | null,
): number | null {
  if (phase === "done") return 100;
  if (percent == null) return null;
  const p = Math.min(100, Math.max(0, percent));
  if (phase === "downloading") return p * 0.2;
  if (phase === "transcribing") return 20 + p * 0.8;
  return p;
}
