import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import type { Clip, OverlayType, Project, RatioKey } from "../lib/sidecar";
import { sidecar, RATIOS } from "../lib/sidecar";
import { CopyButton } from "./CopyButton";
import { InfoTip } from "./InfoTip";
import { LayoutIcon, LAYOUTS, type LayoutKey } from "./clips-feed/LayoutIcon";
import { pickOverlaySource } from "./OverlaySourcePicker";
import { LayoutCellDiagram } from "./clips-feed/LayoutCellDiagram";
import { LAYOUT_TOPOLOGY } from "./clips-feed/layout-cells";
import { BountyFitChecklist } from "./earn/bounty-fit";

// Editor modal — the side-door power view from each feed card. Designed to
// echo the card's vocabulary (same layout icons, same ratio chips) so the
// jump card → editor feels like zooming in, not switching tools.

function formatHms(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function viralityClass(score: number): string {
  if (score >= 90) return "bg-fuchsia text-white";
  if (score >= 75) return "bg-fuchsia-bright text-white";
  if (score >= 50) return "bg-fuchsia-glow text-ink";
  return "bg-paper-warm text-text-tertiary";
}

function pathForRatio(clip: Clip, ratio: RatioKey): string | undefined {
  const overlayPath = clip.overlay?.applied_paths?.[ratio];
  if (overlayPath) return overlayPath;
  if (ratio === "vertical") return clip.vertical_path;
  if (ratio === "square") return clip.square_path;
  return clip.portrait_path;
}

export function ClipPreview({
  clip,
  index,
  slug,
  project,
  totalClips,
  onClose,
  onProjectChange,
  onNavigate,
}: {
  clip: Clip;
  index: number;
  slug: string;
  project: Project;
  totalClips: number;
  onClose: () => void;
  onProjectChange: (p: Project) => void;
  onNavigate?: (direction: -1 | 1) => void;
}) {
  const [ratio, setRatio] = useState<RatioKey>("vertical");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [trimOpen, setTrimOpen] = useState(false);
  const [trimStart, setTrimStart] = useState(clip.start);
  const [trimEnd, setTrimEnd] = useState(clip.end);
  const [showVariants, setShowVariants] = useState(false);
  // Editable metadata. Reset whenever the underlying clip / index changes
  // (i.e. user navigates to the next clip, the previous one finished
  // re-cutting, etc).
  const [titleDraft, setTitleDraft] = useState(clip.title);
  const [descDraft, setDescDraft] = useState(clip.description);
  const [pinDraft, setPinDraft] = useState(clip.pinned_comment ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [brollOffset, setBrollOffset] = useState(clip.overlay?.start_offset_s ?? 0);
  const [audioSource, setAudioSource] = useState<"main" | "broll" | "muted">(clip.overlay?.audio_source ?? "main");

  useEffect(() => {
    setTrimStart(clip.start);
    setTrimEnd(clip.end);
    setActionError(null);
    setTitleDraft(clip.title);
    setDescDraft(clip.description);
    setPinDraft(clip.pinned_comment ?? "");
    setSaveState("idle");
    setBrollOffset(clip.overlay?.start_offset_s ?? 0);
    setAudioSource(clip.overlay?.audio_source ?? "main");
  }, [clip.start, clip.end, clip.title, clip.description, clip.pinned_comment, clip.overlay?.start_offset_s, clip.overlay?.audio_source, index]);

  const isDirty =
    titleDraft !== clip.title ||
    descDraft !== clip.description ||
    pinDraft !== (clip.pinned_comment ?? "");

  async function saveMeta() {
    if (!isDirty || busy) return;
    setBusy(true);
    setActionError(null);
    setSaveState("saving");
    try {
      const r = await sidecar.updateClipMeta(slug, index - 1, {
        title: titleDraft,
        description: descDraft,
        pinned_comment: pinDraft,
      });
      onProjectChange(r.project);
      setSaveState("saved");
      window.setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1800);
    } catch (e) {
      setActionError(String(e));
      setSaveState("idle");
    } finally {
      setBusy(false);
    }
  }

  const videoPath = useMemo(() => pathForRatio(clip, ratio) ?? clip.cut_path, [clip, ratio]);
  const videoSrc = videoPath ? convertFileSrc(videoPath) : null;
  const layout: LayoutKey = (clip.overlay?.type as LayoutKey) ?? "none";

  // Esc closes, ←/→ navigate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      const t = e.target as HTMLElement | null;
      if (t && /INPUT|TEXTAREA/.test(t.tagName)) return;
      if (e.key === "ArrowLeft" && onNavigate && index > 1) onNavigate(-1);
      if (e.key === "ArrowRight" && onNavigate && index < totalClips) onNavigate(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onNavigate, index, totalClips]);

  // Apply a launch-safe b-roll layout. The renderer supports one extra source
  // per clip; the advanced cell editor stays hidden until the backend supports
  // independent cells / audio / music beds end-to-end.
  async function applyLayout(kind: LayoutKey, opts?: { forcePick?: boolean }) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      if (kind === "none") {
        const r = await sidecar.applyOverlay(slug, index - 1, null);
        onProjectChange(r.project);
      } else {
        // Re-use existing source if the layout type is unchanged; otherwise
        // ask via the picker (this project's clips OR upload a file).
        const existing = clip.overlay?.source_path;
        let source: string | undefined = existing;
        if (opts?.forcePick || !source || (clip.overlay?.type ?? "none") !== kind) {
          const pick = await pickOverlaySource({ project, excludeIdx: index - 1 });
          if (pick.kind === "cancel") return;
          source = pick.path;
        }
        const r = await sidecar.applyOverlay(slug, index - 1, {
          type: kind as OverlayType,
          source_path: source,
          start_offset_s: brollOffset,
          audio_source: audioSource,
        });
        onProjectChange(r.project);
      }
    } catch (e) {
      setActionError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    if (trimEnd - trimStart < 30 || trimEnd - trimStart > 75) {
      setActionError("Clip must be 30–75 seconds.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const r = await sidecar.regenerateClip(slug, index - 1, trimStart, trimEnd);
      onProjectChange(r.project);
      setTrimOpen(false);
    } catch (e) {
      setActionError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Remove this clip? Its files on disk go too.")) return;
    setBusy(true);
    try {
      const r = await sidecar.removeClip(slug, index - 1);
      onProjectChange(r.project);
      onClose();
    } catch (e) {
      setActionError(String(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-6" onClick={onClose}>
      <div
        className="flex h-full max-h-[94vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-2xl bg-paper shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3">
          <div className="flex flex-1 items-center gap-3 min-w-0">
            {onNavigate && (
              <button onClick={() => onNavigate(-1)} disabled={index <= 1}
                className="shrink-0 rounded-full border border-line bg-paper px-2.5 py-1.5 font-mono text-[12px] text-text-secondary hover:border-fuchsia hover:text-ink disabled:opacity-30"
                aria-label="Previous (←)" title="Previous (←)">←</button>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-[20px] font-bold italic text-fuchsia">{index.toString().padStart(2, "0")}</span>
                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-tertiary">of {totalClips.toString().padStart(2, "0")}</span>
                <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${viralityClass(clip.virality)}`}>{clip.virality}</span>
                {clip.theme && <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-tertiary">{clip.theme}</span>}
                <span className="font-mono text-[11px] text-text-tertiary">{formatHms(clip.start)} → {formatHms(clip.end)}</span>
              </div>
              <h3 className="mt-1 truncate font-display text-[20px] font-semibold leading-tight tracking-[-0.01em] text-ink">{clip.title}</h3>
            </div>
            {onNavigate && (
              <button onClick={() => onNavigate(1)} disabled={index >= totalClips}
                className="shrink-0 rounded-full border border-line bg-paper px-2.5 py-1.5 font-mono text-[12px] text-text-secondary hover:border-fuchsia hover:text-ink disabled:opacity-30"
                aria-label="Next (→)" title="Next (→)">→</button>
            )}
          </div>
          <button onClick={onClose}
            className="shrink-0 rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] text-text-secondary hover:border-fuchsia hover:text-ink">
            Close · esc
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-0 overflow-hidden lg:flex-row">
          {/* LEFT: video + layout icon row + ratio chips */}
          <div className="flex w-full flex-col gap-3 bg-ink p-5 lg:w-[58%]">
            {/* Layout icons — same vocabulary as feed cards */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-paper">
              <div className="flex items-center gap-1">
                {LAYOUTS.map((l) => {
                  const active = layout === l.key;
                  return (
                    <button key={l.key} onClick={() => void applyLayout(l.key)} disabled={busy}
                      title={l.label}
                      className={`flex items-center justify-center rounded-md p-1.5 transition-colors ${
                        active ? "bg-fuchsia text-white" : "text-white/60 hover:bg-paper/10 hover:text-white"
                      } disabled:opacity-50`}
                      aria-label={l.label} aria-pressed={active}
                    >
                      <LayoutIcon kind={l.key} />
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-1 rounded-full bg-paper/10 p-0.5">
                {RATIOS.map((r) => {
                  const available = !!pathForRatio(clip, r.key);
                  return (
                    <button
                      key={r.key}
                      onClick={() => available && setRatio(r.key)}
                      disabled={!available}
                      title={available ? r.label : `${r.label} not rendered yet`}
                      className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors ${
                        ratio === r.key
                          ? "bg-paper text-ink"
                          : available
                          ? "text-paper/60 hover:text-paper"
                          : "cursor-not-allowed text-paper/25"
                      }`}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Video player */}
            <div className="flex flex-1 items-center justify-center overflow-hidden rounded-xl bg-black">
              {videoSrc ? (
                <video key={videoSrc} controls autoPlay loop muted={!!clip.overlay?.music_bed}
                  src={videoSrc} className="max-h-full max-w-full" />
              ) : (
                <p className="font-mono text-[12px] text-text-tertiary">No video yet for {ratio}.</p>
              )}
            </div>

            {/* Inline status row */}
            <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.08em] text-paper/60">
              <span>{LAYOUT_TOPOLOGY[layout].label}</span>
              {clip.overlay?.source_path && <span className="text-fuchsia-bright">b-roll rendered</span>}
            </div>
          </div>

          {/* RIGHT: cell editor + metadata */}
          <div className="flex w-full flex-col gap-5 overflow-y-auto p-5 lg:w-[42%]">
            {/* Cell editor */}
            <BountyFitChecklist clip={clip} project={project} />

            <section>
              <LayoutCellDiagram
                kind={layout}
                sourcePath={clip.overlay?.source_path ?? null}
              />
              {layout !== "none" && (
                <div className="mt-3 space-y-3 rounded-xl border border-line bg-paper p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                      side-by-side controls
                    </span>
                    <button
                      onClick={() => void applyLayout(layout, { forcePick: true })}
                      disabled={busy}
                      className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary hover:border-fuchsia hover:text-ink disabled:opacity-40"
                    >
                      Change b-roll
                    </button>
                  </div>

                  <label className="block">
                    <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                      <span>B-roll start offset</span>
                      <span>{brollOffset.toFixed(1)}s</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={60}
                      step={0.5}
                      value={brollOffset}
                      onChange={(e) => setBrollOffset(Number(e.target.value))}
                      className="w-full accent-fuchsia"
                    />
                  </label>

                  <div>
                    <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                      Audio
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {([
                        ["main", "Main audio"],
                        ["broll", "B-roll audio"],
                        ["muted", "Muted"],
                      ] as const).map(([key, label]) => (
                        <button
                          key={key}
                          onClick={() => setAudioSource(key)}
                          className={`rounded-full border px-3 py-1 font-sans text-[12px] transition-colors ${
                            audioSource === key
                              ? "border-fuchsia bg-fuchsia text-white"
                              : "border-line bg-paper text-text-secondary hover:border-fuchsia hover:text-ink"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => void applyLayout(layout)}
                      disabled={busy}
                      className="rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[13px] font-medium text-white hover:bg-fuchsia-bright disabled:opacity-50"
                    >
                      {busy ? "Rendering..." : "Render update"}
                    </button>
                    <button
                      onClick={() => void applyLayout("none")}
                      disabled={busy}
                      className="rounded-full border border-line bg-paper px-4 py-1.5 font-sans text-[13px] font-medium text-ink hover:border-[#DC2626] hover:text-[#DC2626] disabled:opacity-50"
                    >
                      Remove b-roll
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Post-ready text Liquid Clips wrote for you. One header, three sub-blocks
                with purpose labels so the user sees WHAT each is for, not just
                a list of jargon fields. Fields are editable — Save commits to
                project.json so edits survive publish + reload. */}
            <section className="space-y-3 rounded-2xl border border-fuchsia-soft bg-fuchsia-soft/15 p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
                  for your post
                </span>
                <CopyButton
                  text={[
                    titleDraft,
                    descDraft,
                    pinDraft ? `\nPin: ${pinDraft}` : "",
                  ].filter(Boolean).join("\n\n").trim()}
                  label="copy all"
                />
              </div>

              <EditableField
                label="Title"
                hint="Shows on YouTube / Reels listing. The hook that earns the click."
                value={titleDraft}
                onChange={setTitleDraft}
                multiline={false}
                maxLength={200}
              />

              <EditableField
                label="Caption"
                hint="The text you paste below the clip on TikTok / Insta / Shorts."
                value={descDraft}
                onChange={setDescDraft}
                multiline
                maxLength={1000}
              />

              <EditableField
                label="Pinned comment"
                hint="Pin this under your post — it drives the comment section (algo signal)."
                value={pinDraft}
                onChange={setPinDraft}
                multiline
                maxLength={500}
                placeholder="Leave blank for no pinned comment"
              />

              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                  {saveState === "saving"
                    ? "saving…"
                    : saveState === "saved"
                    ? "saved"
                    : isDirty
                    ? "unsaved changes"
                    : "saved"}
                </span>
                <div className="flex items-center gap-2">
                  {isDirty && saveState !== "saving" && (
                    <button
                      onClick={() => {
                        setTitleDraft(clip.title);
                        setDescDraft(clip.description);
                        setPinDraft(clip.pinned_comment ?? "");
                      }}
                      className="rounded-full border border-line bg-paper px-4 py-1.5 font-sans text-[12px] font-medium text-text-secondary hover:border-fuchsia hover:text-ink"
                    >
                      Discard
                    </button>
                  )}
                  <button
                    onClick={() => void saveMeta()}
                    disabled={!isDirty || busy}
                    className="rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[13px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[0_8px_24px_rgba(255,26,140,0.25)] disabled:opacity-40"
                  >
                    {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved ✓" : "Save"}
                  </button>
                </div>
              </div>

              {clip.title_variants && clip.title_variants.length > 0 && (
                <details open={showVariants}
                  onToggle={(e) => setShowVariants((e.currentTarget as HTMLDetailsElement).open)}>
                  <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
                    Alternative hooks · {clip.title_variants.length}
                    <span className="ml-2 font-sans normal-case tracking-normal text-text-tertiary">
                      — pick a different one if the first doesn't bite
                    </span>
                  </summary>
                  <ul className="mt-3 space-y-2 font-sans text-[14px] text-ink">
                    {clip.title_variants.map((t, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-fuchsia" />
                        <span className="flex-1">{t}</span>
                        <CopyButton text={t} label="copy" />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>

            <details open={trimOpen} onToggle={(e) => setTrimOpen((e.currentTarget as HTMLDetailsElement).open)}
              className="rounded-xl border border-line p-3">
              <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
                Trim · re-cut bounds
              </summary>
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">Start (s)</span>
                    <input type="number" step={0.1} min={0} value={trimStart.toFixed(2)}
                      onChange={(e) => setTrimStart(parseFloat(e.target.value) || 0)}
                      className="rounded-lg border border-line bg-paper-warm/40 px-3 py-2 font-mono text-[13px] text-ink focus:border-fuchsia focus:outline-none" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">End (s)</span>
                    <input type="number" step={0.1} min={0} value={trimEnd.toFixed(2)}
                      onChange={(e) => setTrimEnd(parseFloat(e.target.value) || 0)}
                      className="rounded-lg border border-line bg-paper-warm/40 px-3 py-2 font-mono text-[13px] text-ink focus:border-fuchsia focus:outline-none" />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => void regenerate()} disabled={busy}
                    className="rounded-full bg-fuchsia px-5 py-2 font-sans text-[13px] font-medium text-white hover:bg-fuchsia-bright disabled:opacity-50">
                    {busy ? "Working…" : "Re-cut"}
                  </button>
                  <button onClick={() => { setTrimStart(clip.start); setTrimEnd(clip.end); }}
                    className="rounded-full border border-line bg-paper px-5 py-2 font-sans text-[13px] font-medium text-ink hover:border-fuchsia">
                    Reset
                  </button>
                </div>
              </div>
            </details>

            {actionError && <p className="font-mono text-[12px] text-[#DC2626]">{actionError}</p>}

            <div className="mt-auto flex items-center gap-2 pt-3">
              <button onClick={() => videoPath && void openExternal(videoPath)}
                disabled={!videoPath}
                className="rounded-full border border-line bg-paper px-4 py-2 font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary hover:border-fuchsia hover:text-ink disabled:opacity-40">
                Open current file
              </button>
              <button onClick={remove} disabled={busy}
                className="ml-auto rounded-full border border-line bg-paper px-4 py-2 font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary hover:border-[#DC2626] hover:text-[#DC2626] disabled:opacity-40">
                Remove
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditableField({
  label,
  hint,
  value,
  onChange,
  multiline,
  maxLength,
  placeholder,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
  multiline: boolean;
  maxLength: number;
  placeholder?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-paper p-3.5 space-y-2 transition-colors focus-within:border-fuchsia hover:border-fuchsia/40">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">{label}</span>
          <InfoTip text={hint} />
        </div>
        <span className="font-mono text-[10px] tracking-[0.08em] text-text-tertiary">
          {value.length}/{maxLength}
        </span>
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
          rows={Math.max(2, Math.min(6, value.split("\n").length + 1))}
          placeholder={placeholder}
          className="w-full resize-y rounded-md bg-transparent font-sans text-[14px] leading-relaxed text-ink placeholder:text-text-tertiary focus:outline-none"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
          placeholder={placeholder}
          className="w-full rounded-md bg-transparent font-sans text-[14px] leading-relaxed text-ink placeholder:text-text-tertiary focus:outline-none"
        />
      )}
    </div>
  );
}
