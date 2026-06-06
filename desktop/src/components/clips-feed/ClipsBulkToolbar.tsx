"use client";

import { useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { sidecar, RATIOS, type OverlayType, type Project, type RatioKey } from "../../lib/sidecar";
import { LayoutIcon, LAYOUTS, type LayoutKey } from "./LayoutIcon";
import { pickOverlaySource } from "../OverlaySourcePicker";

// Bulk actions that apply across every clip in the project. Lives directly
// above the grid. Stays simple — three actions, no nested submenus.

export function ClipsBulkToolbar({
  project,
  ratio,
  onRatioChange,
  onProjectChange,
  previewSoundOn,
  onPreviewSoundChange,
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
}) {
  const [busy, setBusy] = useState(false);
  const [layoutMenu, setLayoutMenu] = useState(false);

  const avg =
    project.clips.length === 0
      ? 0
      : Math.round(project.clips.reduce((a, c) => a + (c.virality ?? 0), 0) / project.clips.length);
  const totalSec = project.clips.reduce((a, c) => a + (c.end - c.start), 0);

  async function applyLayoutToAll(kind: LayoutKey) {
    setLayoutMenu(false);
    if (busy) return;
    setBusy(true);
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
      let current = project;
      for (let i = 0; i < current.clips.length; i++) {
        const spec =
          kind === "none"
            ? null
            : { type: kind as OverlayType, source_path: pickedPath!, start_offset_s: 0 };
        const r = await sidecar.applyOverlay(current.slug, i, spec);
        current = r.project;
      }
      onProjectChange(current);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sticky top-0 z-10 -mx-1 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-transparent px-4 py-3 backdrop-blur-md">
      <span className="cockpit-tile-corner-tl" aria-hidden />
      <span className="cockpit-tile-corner-tr" aria-hidden />
      <span className="cockpit-tile-corner-bl" aria-hidden />
      <span className="cockpit-tile-corner-br" aria-hidden />
      <div className="flex items-center gap-4 font-mono text-[11px] uppercase tracking-[0.08em] text-text-tertiary">
        <span>
          <span className="text-ink">{project.clips.length}</span> clips
        </span>
        <span>
          avg score <span className="text-ink">{avg}</span>
        </span>
        <span>
          {Math.floor(totalSec / 60)}m {Math.round(totalSec % 60)}s total
        </span>
      </div>

      <div className="flex items-center gap-2">
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
            onClick={() => setLayoutMenu((s) => !s)}
            disabled={busy}
            className="rounded-full border border-fuchsia/30 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary transition-colors hover:border-fuchsia hover:text-ink disabled:opacity-50"
          >
            Apply layout to all ▾
          </button>
          {layoutMenu && (
            <div
              className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-line bg-paper shadow-lg"
              onMouseLeave={() => setLayoutMenu(false)}
            >
              {LAYOUTS.map((l) => (
                <button
                  key={l.key}
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
    </div>
  );
}
