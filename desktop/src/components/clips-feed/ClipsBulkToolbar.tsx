"use client";

import { useEffect, useRef, useState } from "react";
import { PlayCircle, PauseCircle, Volume2, VolumeX } from "lucide-react";
import { sidecar, RATIOS, type OverlayType, type Project, type RatioKey } from "../../lib/sidecar";
import { LayoutIcon, LAYOUTS, type LayoutKey } from "./LayoutIcon";
import { pickOverlaySource } from "../OverlaySourcePicker";
import { useReactionBakeProgress } from "../../lib/useReactionBakeProgress";
import { globalWaitForBake } from "../../lib/useGlobalBakeEvents";

// Bulk actions that apply across every clip in the project. Lives directly
// above the grid. Stays simple — three actions, no nested submenus.

export function ClipsBulkToolbar({
  project,
  ratio,
  onRatioChange,
  onProjectChange,
  previewSoundOn,
  onPreviewSoundChange,
  previewMotionOn,
  onPreviewMotionChange,
}: {
  project: Project;
  ratio: RatioKey;
  onRatioChange: (r: RatioKey) => void;
  onProjectChange: (p: Project) => void;
  /** Global toggle — when true, the hovered ClipCard plays audio. Default off
   *  so a grid of cards doesn't blast overlapping sound the moment the cursor
   *  drifts across them. */
  previewSoundOn: boolean;
  onPreviewSoundChange: (next: boolean) => void;
  /** Global toggle — when true, ClipCard hover auto-plays the video. Default
   *  off so static posters render by default (less motion = less distracting
   *  + respects users with prefers-reduced-motion). Pairs with the sound
   *  toggle for symmetry. */
  previewMotionOn: boolean;
  onPreviewMotionChange: (next: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [layoutMenu, setLayoutMenu] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);

  // Esc + click-outside on the bulk-layout menu (was mouseLeave-only —
  // keyboard-only users were trapped). Mirrors ClipCard's ⋮ menu fix.
  useEffect(() => {
    if (!layoutMenu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setLayoutMenu(false);
        menuButtonRef.current?.focus();
      }
    }
    function onPointer(e: PointerEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (menuPanelRef.current?.contains(t)) return;
      if (menuButtonRef.current?.contains(t)) return;
      setLayoutMenu(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [layoutMenu]);

  const avg =
    project.clips.length === 0
      ? 0
      : Math.round(project.clips.reduce((a, c) => a + (c.virality ?? 0), 0) / project.clips.length);
  const totalSec = project.clips.reduce((a, c) => a + (c.end - c.start), 0);

  // P1 #11 — per-clip bake progress for the multi-clip applyLayoutToAll loop.
  // N clips × ~10s ffmpeg per clip could spin silently for minutes; this hook
  // surfaces the sidecar's overlay_progress event so the toolbar can render a
  // mono "Baking N of M…" + bar. Also track the N-of-M index ourselves since
  // the sidecar's pct is per-bake, not per-batch.
  const { progress: bakeProgress, start: startBakeProgress, stop: stopBakeProgress } =
    useReactionBakeProgress();
  const [batchCurrent, setBatchCurrent] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);

  async function applyLayoutToAll(kind: LayoutKey) {
    setLayoutMenu(false);
    if (busy) return;
    setBusy(true);
    setLayoutError(null);
    // Track failures per clip so a single bad bake doesn't strand the
    // whole batch — the prior version threw on the first error, lost the
    // already-applied partial state, and surfaced nothing to the user.
    const failures: number[] = [];
    try {
      // For "none" we just strip every clip's overlay. For real layouts the
      // file picker UX is single-shot — same b-roll across the project (which
      // is what a clipper wants 99% of the time).
      let pickedPath: string | null = null;
      if (kind !== "none") {
        // Bulk apply — pick one source and apply it to every clip. No exclude
        // index because the bulk action affects all clips uniformly.
        const pick = await pickOverlaySource({ project });
        if (pick.kind === "cancel") return;
        pickedPath = pick.path;
      }
      // P1 #11 — start listening for sidecar overlay_progress events so the
      // mono progress row below the menu can show per-bake pct alongside the
      // batch counter ("Baking 3 of 12 · 47%"). Stops in finally.
      let current = project;
      const total = current.clips.length;
      setBatchTotal(total);
      setBatchCurrent(0);
      await startBakeProgress();
      for (let i = 0; i < total; i++) {
        setBatchCurrent(i + 1);
        const spec =
          kind === "none"
            ? null
            : { type: kind as OverlayType, source_path: pickedPath!, start_offset_s: 0 };
        try {
          await sidecar.startOverlayBake(current.slug, i, spec);
          const result = await globalWaitForBake(current.slug, i, 300_000);
          if (result.status === "complete") {
            current = result.project;
          } else {
            failures.push(i + 1);
          }
        } catch {
          failures.push(i + 1);
        }
      }
      onProjectChange(current);
      if (failures.length > 0) {
        setLayoutError(
          `Couldn't apply to clip${failures.length === 1 ? "" : "s"} ${failures.join(", ")} — try Editor → for those.`,
        );
        window.setTimeout(() => setLayoutError(null), 6000);
      }
    } finally {
      stopBakeProgress();
      setBatchCurrent(0);
      setBatchTotal(0);
      setBusy(false);
    }
  }

  return (
    <div className="sticky top-0 z-10 -mx-1 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-transparent px-4 py-3 backdrop-blur-md">
      <span className="cockpit-tile-corner-tl" aria-hidden />
      <span className="cockpit-tile-corner-tr" aria-hidden />
      <span className="cockpit-tile-corner-bl" aria-hidden />
      <span className="cockpit-tile-corner-br" aria-hidden />
      {/* v0.6.51 — was three sibling <span> stat rows ({N} clips · avg score · Nm Ns total)
          which read as "three lines above clip" on a dark cockpit background.
          Collapsed into one inline pill that lives on the left of the toolbar
          balanced against the controls on the right. Clip count is already
          shown in the ResultsGrid header strip so it's not lost. */}
      <span
        aria-label={`${project.clips.length} clips, average score ${avg}, ${Math.floor(totalSec / 60)} minutes ${Math.round(totalSec % 60)} seconds total`}
        className="inline-flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary"
      >
        <span><span className="text-ink">{project.clips.length}</span> clips · avg <span className="text-ink">{avg}</span> · <span className="text-ink">{Math.floor(totalSec / 60)}m {Math.round(totalSec % 60)}s</span></span>
      </span>

      <div className="flex items-center gap-2">
        {/* Preview motion — global toggle. Default OFF so static posters render
            by default (less motion = less distracting + respects users with
            prefers-reduced-motion). Pairs with the sound toggle for symmetry. */}
        <button
          type="button"
          onClick={() => onPreviewMotionChange(!previewMotionOn)}
          aria-pressed={previewMotionOn}
          aria-label={previewMotionOn ? "Disable hover preview motion" : "Enable hover preview motion"}
          title={previewMotionOn ? "Preview motion: on" : "Preview motion: off"}
          className={`grid h-7 w-7 place-items-center rounded-full border transition-colors ${
            previewMotionOn
              ? "border-fuchsia bg-fuchsia text-white shadow-[var(--glow-sm)]"
              : "border-fuchsia/30 bg-transparent text-text-tertiary hover:border-fuchsia hover:text-ink"
          }`}
        >
          {previewMotionOn ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
        </button>

        {/* Preview sound — global toggle. Default OFF (auto-mute on hover) so the
            grid doesn't pile audio on every mouseenter. Flip ON to hear the
            moment without opening the full preview modal. */}
        <button
          type="button"
          onClick={() => onPreviewSoundChange(!previewSoundOn)}
          aria-pressed={previewSoundOn}
          aria-label={previewSoundOn ? "Mute hover preview audio" : "Unmute hover preview audio"}
          title={previewSoundOn ? "Preview sound: on" : "Preview sound: off"}
          className={`grid h-7 w-7 place-items-center rounded-full border transition-colors ${
            previewSoundOn
              ? "border-fuchsia bg-fuchsia text-white shadow-[var(--glow-sm)]"
              : "border-fuchsia/30 bg-transparent text-text-tertiary hover:border-fuchsia hover:text-ink"
          }`}
        >
          {previewSoundOn ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
        </button>

        {/* Ratio toggle — applies to whole grid */}
        <div className="flex items-center gap-1 rounded-full border border-fuchsia/30 bg-transparent p-0.5">
          {RATIOS.map((r) => (
            <button
              key={r.key}
              onClick={() => onRatioChange(r.key)}
              className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors ${
                ratio === r.key
                  ? "bg-fuchsia text-white"
                  : "text-text-tertiary hover:text-ink"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Bulk layout */}
        <div className="relative">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setLayoutMenu((s) => !s)}
            disabled={busy}
            aria-haspopup="menu"
            aria-expanded={layoutMenu}
            className="rounded-full border border-fuchsia/30 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary transition-colors hover:border-fuchsia hover:text-ink disabled:opacity-50"
          >
            Apply layout to all ▾
          </button>
          {layoutMenu && (
            <div
              ref={menuPanelRef}
              role="menu"
              aria-label="Apply layout to all clips"
              className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-line bg-paper shadow-lg"
            >
              {LAYOUTS.map((l) => (
                <button
                  key={l.key}
                  role="menuitem"
                  onClick={() => void applyLayoutToAll(l.key)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-paper-warm"
                >
                  <span className="text-text-secondary"><LayoutIcon kind={l.key} /></span>
                  <span className="font-sans text-[13px] text-ink">{l.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* P1 #11 — bulk-bake progress strip. Shows N-of-M index + per-bake pct
          from the sidecar's overlay_progress event so a minutes-long batch
          isn't silent. Hides when no batch in flight. */}
      {batchTotal > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="basis-full space-y-1 rounded-md border border-fuchsia/30 bg-fuchsia-soft/15 px-3 py-1.5"
        >
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">
            <span>
              Baking {batchCurrent} of {batchTotal}
              {bakeProgress?.ratio ? ` · ${bakeProgress.ratio}` : ""}…
            </span>
            <span>{bakeProgress?.pct ?? 0}%</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-paper">
            <div
              className="h-full rounded-full bg-fuchsia transition-all duration-300"
              style={{ width: `${bakeProgress?.pct ?? 0}%` }}
            />
          </div>
        </div>
      )}

      {layoutError && (
        <p
          role="alert"
          className="basis-full rounded-md border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-danger)]"
        >
          {layoutError}
        </p>
      )}
    </div>
  );
}
