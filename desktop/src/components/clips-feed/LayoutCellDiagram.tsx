"use client";

import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  LAYOUT_TOPOLOGY,
  type Cell,
  type CellRole,
  type CellsMap,
} from "./layout-cells";
import type { LayoutKey } from "./LayoutIcon";
import { InfoTip } from "../InfoTip";
import { pickOverlaySource } from "../OverlaySourcePicker";
import type { Project } from "../../lib/sidecar";

// Visual rep of the chosen layout. Each cell is clickable → drill into the
// cell editor (change source video, set audio role). One cell's audio wins;
// music bed (if set) supersedes both. Renders inside the editor modal.

export function LayoutCellDiagram({
  kind,
  cells,
  musicBedSet,
  project,
  excludeIdx,
  onChangeCellSource,
  onChangeCellAudio,
  onClearMusicBed,
  onSetMusicBed,
}: {
  kind: LayoutKey;
  cells: CellsMap;
  musicBedSet: boolean;
  project: Project;
  excludeIdx?: number;
  onChangeCellSource: (role: CellRole, path: string) => void;
  onChangeCellAudio: (role: CellRole, audio: "this" | "muted") => void;
  onClearMusicBed: () => void;
  onSetMusicBed: (path: string) => void;
}) {
  const topology = LAYOUT_TOPOLOGY[kind];
  const [activeCell, setActiveCell] = useState<CellRole | null>(null);

  async function pickSource(): Promise<string | null> {
    const pick = await pickOverlaySource({ project, excludeIdx });
    if (pick.kind === "cancel") return null;
    return pick.path;
  }

  async function pickMusic(): Promise<string | null> {
    // Accepts both audio and video files. ffmpeg pulls just the audio stream
    // when a video is dropped here, so a music video / podcast / any mp4
    // works as a bed source.
    const picked = await openDialog({
      multiple: false,
      filters: [
        { name: "Audio or video", extensions: ["mp3", "wav", "m4a", "aac", "flac", "ogg", "mp4", "mov", "mkv", "webm", "m4v"] },
      ],
    });
    if (!picked || Array.isArray(picked)) return null;
    return picked;
  }

  // Single audio rule — only one cell can be the source. Picking a cell as
  // the audio source mutes all others. Music-bed (if set) overrides this for
  // playback but we keep the cell radio visible so the user can switch back.
  const audioOwner: CellRole | "music" | "none" = musicBedSet
    ? "music"
    : (topology.cells.find((c) => cells[c.role]?.audio === "this")?.role ?? "none");

  function setAudioOwner(role: CellRole) {
    // Caller will sweep — we just emit the role-flip event for the chosen one.
    topology.cells.forEach((c) => onChangeCellAudio(c.role, c.role === role ? "this" : "muted"));
    onClearMusicBed();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        <span>cells in {topology.label}</span>
        {topology.cells.length > 1 && (
          <span title="Click a cell to edit its source and audio">tap to edit ↓</span>
        )}
      </div>

      {/* Aspect-9:16 diagram. Cells are positioned via the unit-rect from topology. */}
      <div className="relative mx-auto aspect-[9/16] w-full max-w-[260px] overflow-hidden rounded-xl border border-line bg-ink">
        {topology.cells.map((cell) => (
          <CellTile
            key={cell.role}
            cell={cell}
            state={cells[cell.role]}
            isAudioOwner={audioOwner === cell.role}
            isActive={activeCell === cell.role}
            onClick={() => setActiveCell((prev) => (prev === cell.role ? null : cell.role))}
          />
        ))}
      </div>

      {/* Drill-in editor for the active cell */}
      {activeCell && (
        <CellEditor
          cell={topology.cells.find((c) => c.role === activeCell)!}
          state={cells[activeCell]}
          isAudioOwner={audioOwner === activeCell}
          onPickSource={async () => {
            const path = await pickSource();
            if (path) onChangeCellSource(activeCell, path);
          }}
          onMakeAudioOwner={() => setAudioOwner(activeCell)}
          onMuteAll={() => topology.cells.forEach((c) => onChangeCellAudio(c.role, "muted"))}
        />
      )}

      {/* Music bed slot — supersedes per-cell audio when set */}
      <div className="rounded-xl border border-line bg-paper p-3.5 transition-colors hover:border-fuchsia/40">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                music bed
              </span>
              <InfoTip text="An mp3/wav or any video (we pull just the audio). Plays under everything and overrides per-cell audio choices." />
            </div>
            <span className="mt-1 font-sans text-[12px] text-ink">
              {musicBedSet ? "Playing under all cells" : "None set"}
            </span>
          </div>
          {musicBedSet ? (
            <button
              onClick={onClearMusicBed}
              className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary hover:border-[#DC2626] hover:text-[#DC2626]"
            >
              Remove
            </button>
          ) : (
            <button
              onClick={async () => {
                const path = await pickMusic();
                if (path) onSetMusicBed(path);
              }}
              className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary hover:border-fuchsia hover:text-ink"
            >
              + Add music
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CellTile({
  cell,
  state,
  isAudioOwner,
  isActive,
  onClick,
}: {
  cell: Cell;
  state?: { source_path: string | null; audio: "this" | "muted" } | undefined;
  isAudioOwner: boolean;
  isActive: boolean;
  onClick: () => void;
}) {
  const style: React.CSSProperties = {
    left: `${cell.rect.x * 100}%`,
    top: `${cell.rect.y * 100}%`,
    width: `${cell.rect.w * 100}%`,
    height: `${cell.rect.h * 100}%`,
  };
  const filled = cell.isMain || (state?.source_path != null);
  return (
    <button
      onClick={onClick}
      style={style}
      className={`absolute flex flex-col justify-between p-2 transition-all ${
        isActive
          ? "ring-2 ring-fuchsia ring-offset-1 ring-offset-ink"
          : "ring-1 ring-paper/30"
      } ${filled ? "bg-paper-warm/95" : "bg-ink"} ${cell.isMain ? "" : "hover:ring-fuchsia/60"}`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className={`font-mono text-[9px] uppercase tracking-[0.12em] ${filled ? "text-ink" : "text-paper/60"}`}>
          {cell.isMain ? "main" : cell.role}
        </span>
        {isAudioOwner && (
          <span title="Audio source for this clip" className="rounded-full bg-fuchsia px-1.5 py-0.5 font-mono text-[8px] uppercase text-paper">
            🔊
          </span>
        )}
      </div>
      <span className={`truncate text-left font-sans text-[10px] ${filled ? "text-text-secondary" : "text-paper/60"}`}>
        {cell.isMain
          ? "from this clip"
          : state?.source_path
          ? state.source_path.split("/").pop()
          : "tap to add"}
      </span>
    </button>
  );
}

function CellEditor({
  cell,
  state,
  isAudioOwner,
  onPickSource,
  onMakeAudioOwner,
  onMuteAll,
}: {
  cell: Cell;
  state?: { source_path: string | null; audio: "this" | "muted" } | undefined;
  isAudioOwner: boolean;
  onPickSource: () => void | Promise<void>;
  onMakeAudioOwner: () => void;
  onMuteAll: () => void;
}) {
  return (
    <div className="rounded-xl border border-fuchsia-soft bg-fuchsia-soft/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
          editing · {cell.label}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 truncate font-sans text-[13px] text-ink">
          {cell.isMain
            ? "Source: the clip itself (can't be changed here — re-cut to change)"
            : state?.source_path
            ? state.source_path.split("/").pop()
            : "No source set"}
        </div>
        {!cell.isMain && (
          <button
            onClick={onPickSource}
            className="shrink-0 rounded-full bg-ink px-4 py-1.5 font-sans text-[12px] font-medium text-paper hover:bg-fuchsia"
          >
            {state?.source_path ? "Change" : "Pick source"}
          </button>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            audio
          </span>
          <InfoTip text="Only one source can play. Picking another mutes this one. A music bed (below) overrides both." />
        </div>
        <div className="flex flex-wrap gap-2">
          <AudioPill
            active={isAudioOwner}
            onClick={onMakeAudioOwner}
            label={cell.isMain ? "Play main audio" : "Play b-roll audio"}
          />
          <AudioPill
            active={!isAudioOwner}
            onClick={onMuteAll}
            label="Mute this clip"
          />
        </div>
      </div>
    </div>
  );
}

function AudioPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 font-sans text-[12px] transition-colors ${
        active
          ? "border-fuchsia bg-fuchsia text-paper"
          : "border-line bg-paper text-text-secondary hover:border-fuchsia hover:text-ink"
      }`}
    >
      {active ? "● " : ""}{label}
    </button>
  );
}
