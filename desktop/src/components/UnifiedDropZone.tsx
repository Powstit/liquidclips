// v0.6.9 — Two-lane workspace launcher. Replaces the v0.6.5 single-input
// hero. Per docs/CLAUDE_WORKSPACE_ONBOARDING_HANDOFF_2026-06-04.md:
//
//   ┌──────────────┐  ┌────────────────────────┐
//   │ Make clips   │  │ Import finished clips  │
//   │ Wand/Scissors│  │ Upload/Layers          │
//   │ Long video…  │  │ Stack · Split · Remix… │
//   └──────────────┘  └────────────────────────┘
//
//   under the active lane:
//   ┌─────────────────────────────────────────────┐
//   │ paste/drop input + CTA                      │
//   │ pills: YouTube · TikTok · IG · X · Local    │
//   └─────────────────────────────────────────────┘
//
//   shared step strip:
//   [1 Add] → [2 Review] → [3 Schedule]
//
// Both lanes land in the same ResultsGrid / Project.clips[]. The "Make clips"
// lane keeps the existing pipeline. The "Import finished clips" lane calls
// the new sidecar `import_ready_clips(paths[])` which wraps each file in a
// Clip record with cut_path == vertical_path == the imported file.

import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowRight,
  CalendarClock,
  Film,
  FolderOpen,
  Layers,
  PlusCircle,
  Scissors,
  Sparkles,
  Upload,
} from "lucide-react";
import { sidecar, humanError, type Project } from "../lib/sidecar";
import {
  readCaptionsEnabled,
  setCaptionsEnabled as persistCaptionsEnabled,
} from "../lib/captionsPref";

const URL_RE = /^https?:\/\//i;

type Lane = "make" | "import";
type Mode = "clips" | "script";

type Props = {
  onPickFile: (brief: string) => void;
  onPasteUrl: (url: string, brief: string) => void;
  onLiftTranscript: (url: string) => void;
  /** v0.6.9 — Import lane handler. Receives the new Project from
   *  importReadyClips so the caller can flip view → "results". */
  onImportReadyClips: (project: Project) => void;
  /** Free-tier export counter. null = unlimited; hidden in that case. */
  remainingExports?: number | null;
  /** v0.7.55 P1-007 — defaults to true. When false, the surface knows
   *  the tier hasn't resolved yet (boot, in-flight /sync) and renders
   *  a neutral "checking quota…" pill instead of either the countdown
   *  or the Premium copy. Pre-fix the surface read `remainingExports
   *  === null` as Premium, so a free user mid-boot flashed Premium for
   *  ~500ms before /sync populated the counter. */
  tierResolved?: boolean;
};

export function UnifiedDropZone({
  onPickFile,
  onPasteUrl,
  onLiftTranscript,
  onImportReadyClips,
  remainingExports = null,
  tierResolved = true,
}: Props) {
  const [lane, setLane] = useState<Lane>("make");
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<Mode>("clips");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  // v0.7.55 — captions on/off. Persists to localStorage + pushes to
  // the sidecar's JUNIOR_ANIMATED_CAPTIONS env var so the next
  // pipeline call honors the choice.
  const [captionsOn, setCaptionsOnState] = useState<boolean>(true);
  useEffect(() => {
    setCaptionsOnState(readCaptionsEnabled());
  }, []);
  function toggleCaptions() {
    const next = !captionsOn;
    setCaptionsOnState(next);
    persistCaptionsEnabled(next);
  }

  function submitMake() {
    const trimmed = url.trim();
    if (!trimmed) {
      onPickFile("");
      return;
    }
    if (!URL_RE.test(trimmed)) {
      setError("That doesn't look like a URL. Paste a YouTube / TikTok / IG / X link.");
      return;
    }
    setError(null);
    if (mode === "clips") onPasteUrl(trimmed, "");
    else onLiftTranscript(trimmed);
  }

  async function pickImportPack() {
    if (importing) return;
    setError(null);
    const picked = await openDialog({
      multiple: true,
      filters: [
        { name: "Finished clips", extensions: ["mp4", "MP4", "mov", "MOV", "webm", "WEBM", "m4v", "M4V"] },
      ],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    if (paths.length === 0) return;
    setImporting(true);
    try {
      const { project } = await sidecar.importReadyClips(paths);
      onImportReadyClips(project);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="flex w-full flex-col gap-5">
      {/* ── Lane launcher ────────────────────────────────────────────── */}
      <div>
        <div className="mb-2.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-fuchsia">
          <Sparkles className="h-3 w-3" />
          start here
        </div>
        <h2 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Choose your clip flow.
        </h2>
        <p className="mt-1 font-sans text-[13px] text-text-secondary">
          Make new clips or bring finished ones into the same workspace.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <LaneCard
            active={lane === "make"}
            onSelect={() => setLane("make")}
            icon={
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-fuchsia/20 text-fuchsia">
                <Scissors className="h-5 w-5" strokeWidth={1.75} />
              </div>
            }
            title="Make clips"
            subtitle="Long video or link"
            pills={["YouTube", "TikTok", "IG", "X", "File"]}
          />
          <LaneCard
            active={lane === "import"}
            onSelect={() => setLane("import")}
            icon={
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-fuchsia/20 text-fuchsia">
                <Layers className="h-5 w-5" strokeWidth={1.75} />
              </div>
            }
            title="Import finished clips"
            subtitle="Stack · split · remix · schedule"
            pills={["MP4", "MOV", "WEBM", "Multi-account"]}
          />
        </div>
      </div>

      {/* ── Active lane input ───────────────────────────────────────── */}
      {lane === "make" ? (
        <section
          onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            onPickFile("");
          }}
          className={`relative flex w-full flex-col gap-4 rounded-3xl border-2 px-6 py-5 transition-all ${
            dragOver
              ? "border-fuchsia bg-fuchsia/10 shadow-[0_0_40px_rgba(255,26,140,0.45)]"
              : "border-fuchsia/55 bg-paper-elev/60 hover:border-fuchsia/80"
          }`}
        >
          <div className="flex items-stretch gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-2xl border border-line bg-paper-elev px-4 py-3 focus-within:border-fuchsia">
              <input
                type="text"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") submitMake(); }}
                placeholder="Paste a YouTube · TikTok · Instagram · X link — or drop a file"
                className="w-full bg-transparent font-sans text-[14px] text-ink placeholder:text-text-tertiary focus:outline-none"
              />
              <button
                type="button"
                onClick={() => onPickFile("")}
                title="Browse files"
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-paper-warm px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:border-fuchsia hover:text-fuchsia"
              >
                <FolderOpen className="h-3 w-3" />
                browse
              </button>
            </div>
            <button
              type="button"
              onClick={submitMake}
              className="inline-flex items-center gap-2 rounded-2xl bg-fuchsia px-5 py-3 font-sans text-[14px] font-semibold text-white shadow-[0_0_24px_rgba(255,26,140,0.55)] transition-all hover:bg-fuchsia-bright hover:shadow-[0_0_32px_rgba(255,26,140,0.75)]"
            >
              {mode === "clips" ? "Get clips" : "Get script"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              <span>YouTube</span><span>·</span>
              <span>TikTok</span><span>·</span>
              <span>Instagram</span><span>·</span>
              <span>X</span><span>·</span>
              <span>Local file</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">output:</span>
              <ModeOption label="Clips" selected={mode === "clips"} onSelect={() => setMode("clips")} />
              <ModeOption label="Script" selected={mode === "script"} onSelect={() => setMode("script")} />
            </div>
          </div>

          {/* v0.7.55 — Three tier states.
              • unresolved (boot, /sync in-flight) → neutral
                "checking quota…" pill so we don't lie about Premium
                before tier resolves (P1-007).
              • free (remainingExports is a number) → countdown copy.
              • paid (remainingExports === null AFTER resolve) → premium
                status pill.
              Captions toggle sits beside the tier pill since both are
              export-step settings. */}
          <div className="flex flex-wrap items-center gap-3">
            {!tierResolved ? (
              <p className="inline-flex w-fit items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-text-tertiary" />
                checking quota…
              </p>
            ) : remainingExports !== null ? (
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                {remainingExports} / 100 free clips remaining
              </p>
            ) : (
              <p className="inline-flex w-fit items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia-deep">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
                Premium · no watermark
              </p>
            )}
            <button
              type="button"
              onClick={toggleCaptions}
              aria-pressed={captionsOn}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${
                captionsOn
                  ? "border-fuchsia/40 bg-fuchsia-soft/30 text-fuchsia-deep hover:border-fuchsia"
                  : "border-line bg-paper text-text-tertiary hover:border-fuchsia hover:text-fuchsia"
              }`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  captionsOn ? "bg-fuchsia" : "bg-text-tertiary"
                }`}
              />
              Captions {captionsOn ? "on" : "off"}
            </button>
          </div>
          {error && <p className="font-mono text-[11px] text-[var(--color-danger)]">{error}</p>}

          {dragOver && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-3xl bg-fuchsia/15">
              <span className="font-mono text-[12px] uppercase tracking-[0.18em] text-fuchsia">
                ▸ drop to cut
              </span>
            </div>
          )}
        </section>
      ) : (
        <section className="relative flex w-full flex-col gap-4 rounded-3xl border-2 border-fuchsia/55 bg-paper-elev/60 px-6 py-5">
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-fuchsia/40 bg-paper/40 px-6 py-7 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-fuchsia/15 text-fuchsia">
              <Upload className="h-6 w-6" strokeWidth={1.75} />
            </div>
            <h3 className="font-display text-[18px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              Drop finished clips — or browse files
            </h3>
            <p className="max-w-[420px] font-sans text-[12px] leading-relaxed text-text-secondary">
              Pull in MP4 / MOV / WEBM clips already cut. They land in the same workspace as
              new clips — stack, split, remix, schedule, publish.
            </p>
            <button
              type="button"
              onClick={() => void pickImportPack()}
              disabled={importing}
              className="mt-1 inline-flex items-center gap-2 rounded-2xl bg-fuchsia px-5 py-2.5 font-sans text-[13px] font-semibold text-white shadow-[0_0_24px_rgba(255,26,140,0.5)] transition-all hover:bg-fuchsia-bright disabled:opacity-60"
            >
              <FolderOpen className="h-4 w-4" />
              {importing ? "Importing…" : "Browse files"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            <span>MP4</span><span>·</span>
            <span>MOV</span><span>·</span>
            <span>WEBM</span><span>·</span>
            <span>Stack</span><span>·</span>
            <span>Split</span><span>·</span>
            <span>Remix</span><span>·</span>
            <span>Schedule</span>
          </div>
          {error && <p className="font-mono text-[11px] text-[var(--color-danger)]">{error}</p>}
        </section>
      )}

      {/* ── Shared step strip ───────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        <Step n="1" label="Add" Icon={PlusCircle} active={true} />
        <Arrow />
        <Step n="2" label="Review" Icon={Film} active={false} />
        <Arrow />
        <Step n="3" label="Schedule" Icon={CalendarClock} active={false} />
      </div>
    </section>
  );
}

/* ─── pieces ───────────────────────────────────────────────────────── */

function LaneCard({
  active,
  onSelect,
  icon,
  title,
  subtitle,
  pills,
}: {
  active: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  pills: string[];
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`flex flex-col items-start gap-3 rounded-2xl border-2 px-4 py-4 text-left transition-all ${
        active
          ? "border-fuchsia bg-fuchsia-soft/30 shadow-[0_0_28px_rgba(255,26,140,0.45)]"
          : "border-line bg-paper-elev/50 hover:border-fuchsia/50 hover:bg-paper-elev"
      }`}
    >
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <div className={`font-display text-[16px] font-semibold leading-tight tracking-[-0.01em] ${active ? "text-ink" : "text-ink"}`}>
            {title}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            {subtitle}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {pills.map((p) => (
          <span
            key={p}
            className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] ${
              active
                ? "border-fuchsia/40 bg-fuchsia/10 text-fuchsia"
                : "border-line bg-paper text-text-tertiary"
            }`}
          >
            {p}
          </span>
        ))}
      </div>
    </button>
  );
}

function ModeOption({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={
        selected
          ? "inline-flex items-center gap-1.5 rounded-full bg-fuchsia/15 px-3 py-1 font-sans text-[12px] font-medium text-fuchsia"
          : "inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-sans text-[12px] text-text-tertiary transition-colors hover:text-ink"
      }
    >
      <span
        aria-hidden="true"
        className={
          selected
            ? "h-2 w-2 rounded-full bg-fuchsia shadow-[0_0_6px_var(--color-fuchsia)]"
            : "h-2 w-2 rounded-full border border-line"
        }
      />
      {label}
    </button>
  );
}

function Step({
  n,
  label,
  Icon,
  active,
}: {
  n: string;
  label: string;
  Icon: typeof PlusCircle;
  active: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
        active
          ? "border-fuchsia/40 bg-fuchsia/10 text-fuchsia"
          : "border-line bg-paper-elev text-text-tertiary"
      }`}
    >
      <Icon className="h-3 w-3" strokeWidth={1.75} />
      <span className="font-mono">{n} · {label}</span>
    </span>
  );
}

function Arrow() {
  return <span aria-hidden="true" className="text-text-tertiary">→</span>;
}
