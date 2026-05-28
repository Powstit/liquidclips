import { useEffect, useState } from "react";
import { sidecar, type Intent, type TimePrediction } from "../lib/sidecar";

// Liquid Clips agent conversation pattern (matches JuniorLoader / Splash voice).
// One question, three pills, breathing room. No dense cards, no bullets.

const OPTIONS: { id: Intent; label: string; hint: string }[] = [
  { id: "clips",   label: "Clip it for shorts",  hint: "TikTok · Reels · Shorts" },
  { id: "youtube", label: "Prep for YouTube",    hint: "Chapters · description · titles" },
  { id: "both",    label: "Both",                hint: "Clips and YouTube extras" },
];

const QUESTION = "What are we making?";

export function IntentPicker({
  source,
  brief,
  durationSeconds,
  fileSizeMb,
  onPick,
  onCancel,
}: {
  source: { kind: "file"; path: string } | { kind: "url"; url: string };
  brief: string;
  durationSeconds?: number;
  fileSizeMb?: number;
  onPick: (intent: Intent) => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [prediction, setPrediction] = useState<TimePrediction | null>(null);
  const [predictionOpen, setPredictionOpen] = useState(false);

  // Fetch ETA the moment the picker mounts. If the caller didn't pass duration
  // (true for URL drops since we haven't yt-dlp'd yet), probe the local file
  // ourselves; URLs simply don't show an ETA on the picker.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let dur = durationSeconds ?? 0;
        let sizeMb = fileSizeMb ?? 0;
        if (dur <= 0 && source.kind === "file") {
          const probe = await sidecar.probe(source.path);
          dur = probe.duration_seconds || 0;
          sizeMb = (probe.size_bytes || 0) / 1_048_576;
        }
        if (dur <= 0) return;
        const p = await sidecar.predictTime(dur, sizeMb);
        if (!cancelled) setPrediction(p);
      } catch {
        // Probe / predict are best-effort — if either fails, picker just
        // doesn't show an ETA. The pipeline still runs.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [durationSeconds, fileSizeMb, source]);

  useEffect(() => {
    let cancelled = false;
    let i = 0;
    setTyped("");
    const step = () => {
      if (cancelled) return;
      i += 1;
      setTyped(QUESTION.slice(0, i));
      if (i < QUESTION.length) {
        setTimeout(step, 28);
      }
    };
    setTimeout(step, 60);
    return () => {
      cancelled = true;
    };
  }, []);

  const label = source.kind === "file"
    ? (source.path.split("/").pop() || "video")
    : source.url;

  return (
    <div className="flex w-full max-w-[640px] flex-col items-start gap-7">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
        <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        junior
      </div>

      <div className="flex items-center gap-3">
        <span
          className="inline-grid h-[36px] w-[36px] place-items-center rounded-lg bg-fuchsia font-mono text-[18px] font-bold leading-none text-white"
          aria-hidden
        >
          /
        </span>
        <p className="font-mono text-[16px] leading-none text-ink">
          {typed}
          <span className="blink ml-[2px] text-fuchsia">_</span>
        </p>
      </div>

      <p className="max-w-[520px] truncate font-mono text-[11px] leading-relaxed text-text-tertiary">
        from <span className="text-text-secondary">{label}</span>
        {brief && <> · brief: <span className="text-text-secondary">{brief}</span></>}
      </p>

      {prediction && (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-paper-warm/40 px-3 py-2">
          <button
            onClick={() => setPredictionOpen((o) => !o)}
            className="flex items-center justify-between gap-2 text-left"
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
              estimated time
            </span>
            <span className="flex items-center gap-2 font-mono text-[12px] text-ink">
              ~{formatEta(prediction.total_s)}
              <span className="text-text-tertiary">{predictionOpen ? "▾" : "▸"}</span>
            </span>
          </button>
          {predictionOpen && (
            <div className="space-y-1 border-t border-line/60 pt-2 font-mono text-[10px] text-text-tertiary">
              {prediction.stages.map((s) => (
                <div key={s.name} className="flex justify-between">
                  <span className="lowercase">{s.name}</span>
                  <span>{formatEta(s.seconds)}</span>
                </div>
              ))}
              <div className="mt-1 flex justify-between border-t border-line/60 pt-1 text-text-secondary">
                <span>path</span>
                <span className="uppercase tracking-[0.08em]">{prediction.path}</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex w-full flex-col gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            onClick={() => onPick(o.id)}
            className="group flex items-center justify-between gap-4 rounded-full border border-line bg-paper px-5 py-3 text-left transition-all hover:border-fuchsia hover:bg-fuchsia-soft/30 hover:shadow-[0_8px_24px_rgba(255,26,140,0.12)]"
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-sans text-[15px] font-medium leading-tight text-ink">
                {o.label}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                {o.hint}
              </span>
            </div>
            <span className="font-mono text-[13px] text-text-tertiary transition-colors group-hover:text-fuchsia">
              →
            </span>
          </button>
        ))}
      </div>

      <button
        onClick={onCancel}
        className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary hover:text-ink"
      >
        ← cancel
      </button>
    </div>
  );
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
