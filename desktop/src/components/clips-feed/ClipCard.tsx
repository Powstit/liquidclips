"use client";

import { useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Clip, OverlayType, Project, RatioKey } from "../../lib/sidecar";
import { sidecar, RATIOS } from "../../lib/sidecar";
import { LayoutIcon, LAYOUTS, type LayoutKey } from "./LayoutIcon";
import { pickOverlaySource } from "../OverlaySourcePicker";

// Self-contained card. Tap = play preview. Layout icons swap composition in
// place. Copy buttons inline. "..." opens the side-door full editor for the
// rare power case. No modals required for the 90% review-and-ship flow.

function formatHms(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function viralityClass(v: number): string {
  if (v >= 90) return "bg-fuchsia text-paper";
  if (v >= 75) return "bg-fuchsia-bright text-paper";
  if (v >= 50) return "bg-fuchsia-glow text-ink";
  return "bg-paper-warm text-text-tertiary";
}

function pathForRatio(clip: Clip, ratio: RatioKey): string | undefined {
  const overlayPath = clip.overlay?.applied_paths?.[ratio];
  if (overlayPath) return overlayPath;
  if (ratio === "vertical") return clip.vertical_path;
  if (ratio === "square") return clip.square_path;
  return clip.portrait_path;
}

export function ClipCard({
  clip,
  index,
  slug,
  project,
  ratio,
  onProjectChange,
  onOpenEditor,
}: {
  clip: Clip;
  index: number;          // 1-based
  slug: string;
  project: Project;        // needed for the overlay picker to list sibling clips
  ratio: RatioKey;
  onProjectChange: (p: Project) => void;
  onOpenEditor: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const videoPath = useMemo(
    () => pathForRatio(clip, ratio) ?? clip.cut_path,
    [clip, ratio, clip.overlay],
  );
  const videoSrc = videoPath ? convertFileSrc(videoPath) : null;
  const thumb = clip.thumbnails?.[0]?.path;
  const thumbSrc = thumb ? convertFileSrc(thumb) : null;

  const currentLayout: LayoutKey = (clip.overlay?.type as LayoutKey) ?? "none";

  // Tiny hover-to-preview: start playing on pointer enter, pause + rewind on leave.
  const onEnter = () => {
    const v = videoRef.current;
    if (!v) return;
    void v.play().catch(() => undefined);
  };
  const onLeave = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
  };

  async function applyLayout(kind: LayoutKey) {
    if (busy) return;
    setBusy(true);
    try {
      if (kind === "none") {
        const r = await sidecar.applyOverlay(slug, index - 1, null);
        onProjectChange(r.project);
      } else {
        const pick = await pickOverlaySource({ project, excludeIdx: index - 1 });
        if (pick.kind === "cancel") return;
        const r = await sidecar.applyOverlay(slug, index - 1, {
          type: kind as OverlayType,
          source_path: pick.path,
          start_offset_s: 0,
        });
        onProjectChange(r.project);
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyAll() {
    const parts: string[] = [clip.title.trim()];
    if (clip.description) parts.push("", clip.description.trim());
    if (clip.pinned_comment) parts.push("", `Pin: ${clip.pinned_comment.trim()}`);
    try {
      await writeText(parts.join("\n"));
    } catch (e) {
      console.warn("copy failed", e);
    }
  }

  async function remove() {
    if (!confirm("Remove this clip? Its files on disk go too.")) return;
    setBusy(true);
    try {
      const r = await sidecar.removeClip(slug, index - 1);
      onProjectChange(r.project);
    } finally {
      setBusy(false);
      setShowMenu(false);
    }
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-4 shadow-[0_2px_12px_rgba(15,15,18,0.04)] transition-shadow hover:shadow-[0_8px_28px_rgba(15,15,18,0.08)]">
      {/* Header: virality + theme + duration */}
      <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.08em]">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 ${viralityClass(clip.virality)}`}>
            {clip.virality}
          </span>
          {clip.theme && (
            <span className="text-text-tertiary">{clip.theme}</span>
          )}
        </div>
        <span className="text-text-tertiary">
          {formatHms(clip.start)} → {formatHms(clip.end)}
        </span>
      </div>

      {/* Video / poster — hover to preview */}
      <div
        className="relative aspect-[9/16] overflow-hidden rounded-xl bg-ink"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        {videoSrc ? (
          <video
            key={videoSrc}
            ref={videoRef}
            src={videoSrc}
            muted
            playsInline
            loop
            preload="metadata"
            poster={thumbSrc ?? undefined}
            className="h-full w-full object-cover"
          />
        ) : thumbSrc ? (
          <img src={thumbSrc} alt={clip.title} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center font-mono text-[11px] text-text-tertiary">
            no preview
          </div>
        )}
        <span className="pointer-events-none absolute left-2 top-2 font-display text-[20px] font-bold italic text-fuchsia drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
          {index.toString().padStart(2, "0")}
        </span>
      </div>

      {/* Layout picker — visual icons */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {LAYOUTS.map((l) => {
            const active = currentLayout === l.key;
            return (
              <button
                key={l.key}
                onClick={() => void applyLayout(l.key)}
                disabled={busy}
                title={l.label}
                className={`flex items-center justify-center rounded-md p-1.5 transition-colors ${
                  active
                    ? "bg-fuchsia-soft/60 text-fuchsia-deep"
                    : "text-text-tertiary hover:bg-paper-warm hover:text-ink"
                } disabled:opacity-50`}
                aria-label={l.label}
                aria-pressed={active}
              >
                <LayoutIcon kind={l.key} />
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
          {RATIOS.map((r) => (
            <span
              key={r.key}
              className={`rounded-full px-2 py-0.5 ${r.key === ratio ? "bg-ink text-paper" : ""}`}
              title={pathForRatio(clip, r.key) ? `Available for ${r.label}` : "Not yet rendered"}
            >
              {r.label}
            </span>
          ))}
        </div>
      </div>

      {/* Title — readable, copyable */}
      <p className="line-clamp-2 font-display text-[16px] font-semibold leading-snug tracking-[-0.01em] text-ink">
        {clip.title}
      </p>

      {/* Inline actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => void copyAll()}
          disabled={busy}
          className="flex-1 rounded-full border border-line bg-paper px-3 py-1.5 font-sans text-[12px] font-medium text-ink hover:border-fuchsia hover:text-fuchsia disabled:opacity-50"
        >
          📋 Copy caption
        </button>
        <button
          onClick={onOpenEditor}
          className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary hover:border-fuchsia hover:text-ink"
          title="Open full editor"
        >
          Editor →
        </button>
        <div className="relative">
          <button
            onClick={() => setShowMenu((s) => !s)}
            className="rounded-full border border-line bg-paper px-2 py-1.5 font-mono text-[12px] text-text-secondary hover:border-fuchsia hover:text-ink"
            aria-label="More actions"
          >
            ⋮
          </button>
          {showMenu && (
            <div
              className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-line bg-paper shadow-lg"
              onMouseLeave={() => setShowMenu(false)}
            >
              <MenuItem onClick={remove}>Remove clip</MenuItem>
              <MenuItem onClick={() => { onOpenEditor(); setShowMenu(false); }}>Open editor</MenuItem>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="block w-full px-3 py-2 text-left font-sans text-[12px] text-ink hover:bg-paper-warm"
    >
      {children}
    </button>
  );
}
