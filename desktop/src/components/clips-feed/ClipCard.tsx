"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Check, Copy, MessageSquare, MoreVertical, Sparkles, Trash2 } from "lucide-react";
import type { Clip, OverlayType, Project, RatioKey } from "../../lib/sidecar";
import { sidecar, RATIOS } from "../../lib/sidecar";
import { LayoutIcon, LAYOUTS, type LayoutKey } from "./LayoutIcon";
import { pickOverlaySource } from "../OverlaySourcePicker";
import { BountyFitPill } from "../earn/bounty-fit";
import { useCountUp } from "../../lib/useCountUp";
import { InlineScheduler } from "./InlineScheduler";
import { ConfirmDialog } from "../ConfirmDialog";
import { CAPTION_STYLES } from "../../lib/caption-styles";

// Self-contained card. Tap = play preview. Layout icons swap composition in
// place. Copy buttons inline. "..." opens the side-door full editor for the
// rare power case. No modals required for the 90% review-and-ship flow.

function formatHms(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function captionStyleDot(style: string | undefined): string {
  switch (style) {
    case "brand_fuchsia": return "#ff1a8c";
    case "tiktok_stack":  return "#00e5ff";
    case "bold_yellow":   return "#ffff00";
    case "clean_white":   return "#f4f1ea";
    case "subway_surfer": return "linear-gradient(135deg, #00e5ff, #ff1a8c)";
    default:              return "rgba(244, 241, 234, 0.25)";
  }
}

function viralityClass(v: number): string {
  if (v >= 90) return "bg-fuchsia text-white shadow-[var(--glow-sm)]";
  if (v >= 75) return "bg-fuchsia-bright text-white";
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
  onOpenCaptions,
  previewSoundOn = false,
  previewMotionOn = false,
}: {
  clip: Clip;
  index: number;          // 1-based
  slug: string;
  project: Project;        // needed for the overlay picker to list sibling clips
  ratio: RatioKey;
  onProjectChange: (p: Project) => void;
  onOpenEditor: () => void;
  /** Optional — click on the captions chip opens the editor with the
   * captions drawer pre-opened. Falls back to onOpenEditor when undefined. */
  onOpenCaptions?: () => void;
  /** When true, the hover-preview unmutes. Default false so a grid of cards
   *  doesn't blast overlapping audio on cursor drift. Toggle lives in
   *  ClipsBulkToolbar; persisted via useLocalPref under `lc:preview_sound`. */
  previewSoundOn?: boolean;
  /** When true, hovering the thumbnail auto-plays the video. Default false
   *  so static posters render unless the clipper explicitly opts in.
   *  Toggle lives in ClipsBulkToolbar; persisted via useLocalPref under
   *  `lc:preview_motion`. Respects prefers-reduced-motion automatically — the
   *  hook returns false during the first render on motion-reduced systems. */
  previewMotionOn?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  // Cockpit error/feedback chip — live for ~3s on a transient failure
  // (applyLayout, copyAll, remove). Doesn't replace the global toast host
  // because the card-local error is contextual ("THIS clip's reaction
  // didn't bake"); a top-of-window toast would orphan the cause.
  const [cockpitError, setCockpitError] = useState<string | null>(null);
  // Copy caption success → 1.5s "Copied" label flip so the clipper sees
  // their action landed without a system toast. Previously this swallowed
  // its result, so users mashed Copy hoping for a sign of life.
  const [copied, setCopied] = useState(false);
  // Branded confirm primitive replaces native confirm() — the old one
  // blocked the Tauri webview thread + broke brand voice on every remove.
  const [confirmRemove, setConfirmRemove] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const viralityDisplay = useCountUp(clip.virality, { durationMs: 700 });

  const videoPath = useMemo(
    () => pathForRatio(clip, ratio) ?? clip.cut_path,
    [clip, ratio, clip.overlay],
  );
  const videoSrc = videoPath ? convertFileSrc(videoPath) : null;
  const thumb = clip.thumbnails?.[0]?.path;
  const thumbSrc = thumb ? convertFileSrc(thumb) : null;

  const currentLayout: LayoutKey = (clip.overlay?.type as LayoutKey) ?? "none";

  // Tiny hover-to-preview: start playing on pointer enter, pause + rewind on leave.
  // Hover-preview is OPT-IN — `previewMotionOn` defaults false. Without it,
  // hover does nothing and the static poster stays. When the global motion
  // pref is on, hover plays. When the global sound pref is also on, hover
  // unmutes. Leave re-mutes + pauses + rewinds so audio never leaks across
  // cards. Lens fix v0.6.51 — Daniel's "motion on clip is uneeded" finding.
  const onEnter = () => {
    if (!previewMotionOn) return;
    const v = videoRef.current;
    if (!v) return;
    if (previewSoundOn) v.muted = false;
    void v.play().catch(() => undefined);
  };
  const onLeave = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
    v.muted = true;
  };

  async function applyLayout(kind: LayoutKey) {
    if (busy) return;
    setBusy(true);
    setCockpitError(null);
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
    } catch (e) {
      // Lens fix — was silently leaving the user staring at the old layout
      // after a failed bake. Surface the cause so they know to retry vs.
      // pick a different source.
      const msg = e instanceof Error ? e.message : String(e);
      setCockpitError(`Layout swap failed — ${msg.slice(0, 90)}`);
      window.setTimeout(() => setCockpitError(null), 4500);
    } finally {
      setBusy(false);
    }
  }

  // Reaction shortcut — re-pick the b-roll source for the CURRENT layout
  // without forcing a layout change. If no layout is set, default to
  // `pip-bl` (a sensible reaction starter) and open the picker so the
  // clipper sees the source picker immediately. Aligned with the cockpit
  // row's promise: every action visible, no modal dance.
  async function changeReaction() {
    const startingLayout: LayoutKey =
      currentLayout !== "none" ? currentLayout : "pip-bl";
    await applyLayout(startingLayout);
  }

  async function copyAll() {
    const parts: string[] = [clip.title.trim()];
    if (clip.description) parts.push("", clip.description.trim());
    if (clip.pinned_comment) parts.push("", `Pin: ${clip.pinned_comment.trim()}`);
    try {
      await writeText(parts.join("\n"));
      // Lens fix — 1.5s label flip so the user sees the action landed.
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Clipboard write failed";
      setCockpitError(msg.slice(0, 90));
      window.setTimeout(() => setCockpitError(null), 4000);
    }
  }

  // Open the branded confirm modal — the actual delete fires from
  // performRemove() below once the user clicks the destructive button.
  // Replaced the prior native `confirm()` which blocked the Tauri webview
  // thread + broke brand voice.
  function remove() {
    setConfirmRemove(true);
  }

  async function performRemove() {
    setBusy(true);
    setCockpitError(null);
    try {
      const r = await sidecar.removeClip(slug, index - 1);
      onProjectChange(r.project);
      setConfirmRemove(false);
      setShowMenu(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Remove failed";
      setCockpitError(msg.slice(0, 90));
      window.setTimeout(() => setCockpitError(null), 4000);
      // Keep the modal open so the user can retry without re-opening it.
    } finally {
      setBusy(false);
    }
  }

  // ⋮ menu — lens fix for the keyboard trap. The previous version closed
  // only on `onMouseLeave`, stranding keyboard-only users + ignoring Esc.
  // Now: Esc closes, click-outside closes, and the trigger carries
  // aria-expanded so screen readers report state.
  useEffect(() => {
    if (!showMenu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setShowMenu(false);
        menuButtonRef.current?.focus();
      }
    }
    function onPointer(e: PointerEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (menuPanelRef.current?.contains(t)) return;
      if (menuButtonRef.current?.contains(t)) return;
      setShowMenu(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [showMenu]);

  return (
    <article className="library-card relative flex flex-col gap-3 rounded-2xl p-4">
      {/* Cockpit corner brackets — fuchsia HUD frame in lieu of full outline. */}
      <span className="library-card-corner-tl" aria-hidden />
      <span className="library-card-corner-tr" aria-hidden />
      <span className="library-card-corner-bl" aria-hidden />
      <span className="library-card-corner-br" aria-hidden />
      {/* Header: virality + theme + duration */}
      <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.08em]">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 ${viralityClass(clip.virality)}`}>
            {viralityDisplay}
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
        className="relative aspect-[9/16] overflow-hidden rounded-xl bg-paper-warm"
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
        {project.whop_bounty_id && (
          <span className="absolute right-2 top-2">
            <BountyFitPill clip={clip} project={project} />
          </span>
        )}
        {/* Captions chip — bottom-right of the thumbnail. Style colour dot
            shows at-a-glance which style is on this clip. Click → open
            editor with the Captions drawer pre-opened. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            (onOpenCaptions ?? onOpenEditor)();
          }}
          aria-label={
            clip.caption_style
              ? `Edit ${
                  (CAPTION_STYLES as Record<string, { label: string }>)[clip.caption_style]?.label ??
                  clip.caption_style.replace("_", " ")
                } captions`
              : "Add captions"
          }
          title={
            clip.caption_style
              ? `Captions · ${
                  (CAPTION_STYLES as Record<string, { label: string }>)[clip.caption_style]?.label ??
                  clip.caption_style.replace("_", " ")
                }`
              : "Add captions"
          }
          className="group absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-full border border-line/50 bg-black/55 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-paper backdrop-blur transition hover:border-fuchsia hover:bg-black/75"
        >
          <span aria-hidden>▣</span>
          <span>cap</span>
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: captionStyleDot(clip.caption_style) }}
          />
        </button>
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
        {/* Render-status HUD — three ratio glyphs (portrait / square / landscape).
            Filled fuchsia when the render exists on disk, hollow when not yet
            rendered. The active ratio gets an ink ring. Replaces the prior
            text-label row which read as three faint "white lines" on dark cards. */}
        <div className="flex items-center gap-1.5" aria-label="Rendered ratios">
          {RATIOS.map((r) => {
            const baked = !!pathForRatio(clip, r.key);
            const active = r.key === ratio;
            // Glyph dimensions — keep all three the same height so the row reads
            // as a tidy HUD, vary width to telegraph aspect ratio.
            const dims =
              r.key === "vertical"
                ? { w: 7, h: 12 }
                : r.key === "square"
                  ? { w: 11, h: 11 }
                  : { w: 9, h: 12 };
            return (
              <span
                key={r.key}
                title={baked ? `Rendered · ${r.label}` : `Not yet rendered · ${r.label}`}
                aria-label={`${r.label} ${baked ? "rendered" : "not rendered"}${active ? " (active)" : ""}`}
                className={`grid place-items-center ${active ? "ring-1 ring-ink rounded-[3px]" : ""}`}
                style={{ padding: 1 }}
              >
                <svg
                  width={dims.w}
                  height={dims.h}
                  viewBox={`0 0 ${dims.w} ${dims.h}`}
                  aria-hidden="true"
                >
                  <rect
                    x="0.5"
                    y="0.5"
                    width={dims.w - 1}
                    height={dims.h - 1}
                    rx="1.2"
                    fill={baked ? "var(--color-fuchsia, #ff1a8c)" : "transparent"}
                    stroke={baked ? "var(--color-fuchsia, #ff1a8c)" : "var(--color-line, rgba(255,255,255,0.28))"}
                    strokeWidth="1"
                  />
                </svg>
              </span>
            );
          })}
        </div>
      </div>

      {/* Title — readable, copyable */}
      <p className="line-clamp-2 font-display text-[16px] font-semibold leading-snug tracking-[-0.01em] text-ink">
        {clip.title}
      </p>

      {/* Cockpit — under-card edit row. Schedule expands in-place via the
          existing InlineScheduler (no modal). Caption opens the captions
          drawer at the editor. Reaction re-opens the overlay-source picker
          for the current layout. ⋮ holds the secondary actions. */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Schedule — self-managed; renders "Schedule" button when closed
              and the full inline scheduler when expanded. */}
          <InlineScheduler
            clip={clip}
            projectTitle={project.source_filename}
            compact
          />

          {/* Caption — pop the side drawer pre-opened. Visible affordance
              for the most-common edit; mirrors the chip on the thumbnail
              so keyboard users + touch users can both reach it. */}
          <button
            type="button"
            onClick={() => (onOpenCaptions ?? onOpenEditor)()}
            title="Edit captions (C)"
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 font-sans text-[12px] font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia"
          >
            <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
            Caption
          </button>

          {/* Reaction — re-open the b-roll picker for the current layout.
              If no layout is set, defaults to pip_corner_bl + picker so the
              clipper sees the picker immediately (no two-step dance). */}
          <button
            type="button"
            onClick={() => void changeReaction()}
            disabled={busy}
            title={
              currentLayout === "none"
                ? "Add reaction b-roll (R)"
                : "Change reaction source (R)"
            }
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 font-sans text-[12px] font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
            {currentLayout === "none" ? "Reaction" : "Change reaction"}
          </button>

          {/* Copy caption — moved into the cockpit row with a 1.5s
              "Copied" label flip so the action lands without a system toast. */}
          <button
            type="button"
            onClick={() => void copyAll()}
            disabled={busy}
            title="Copy title + description"
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-sans text-[12px] font-medium transition-colors disabled:opacity-50 ${
              copied
                ? "border-fuchsia bg-fuchsia text-white"
                : "border-line bg-paper text-ink hover:border-fuchsia hover:text-fuchsia"
            }`}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" strokeWidth={2.25} />
            ) : (
              <Copy className="h-3.5 w-3.5" strokeWidth={2} />
            )}
            {copied ? "Copied" : "Copy"}
          </button>

          {/* Spacer pushes ⋮ + Editor → to the right edge */}
          <span className="flex-1" />

          <button
            type="button"
            onClick={onOpenEditor}
            className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary transition-colors hover:border-fuchsia hover:text-ink"
            title="Open full editor (Enter)"
          >
            Editor →
          </button>

          <div className="relative">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setShowMenu((s) => !s)}
              className="rounded-full border border-line bg-paper px-2 py-1.5 font-mono text-[12px] text-text-secondary transition-colors hover:border-fuchsia hover:text-ink"
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={showMenu}
            >
              <MoreVertical className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            {showMenu && (
              <div
                ref={menuPanelRef}
                role="menu"
                aria-label="Clip actions"
                className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-line bg-paper shadow-lg"
              >
                <MenuItem
                  onClick={() => {
                    onOpenEditor();
                    setShowMenu(false);
                  }}
                >
                  Open editor
                </MenuItem>
                <MenuItem onClick={remove} destructive>
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  Remove clip
                </MenuItem>
              </div>
            )}
          </div>
        </div>

        {/* Card-local error / status chip — surfaces failed layout swaps,
            failed remove, etc. without orphaning the cause in a global
            toast. Auto-clears after ~4.5s. */}
        {cockpitError && (
          <p
            role="alert"
            className="rounded-md border border-[#DC2626]/30 bg-[#DC2626]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#DC2626]"
          >
            {cockpitError}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        tone="destructive"
        title="Remove this clip?"
        body={
          <>
            <span className="font-medium text-ink">{clip.title}</span> and its
            rendered files on disk will be removed. This can't be undone.
          </>
        }
        confirmLabel="Remove clip"
        busy={busy}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => void performRemove()}
      />
    </article>
  );
}

function MenuItem({
  onClick,
  children,
  destructive = false,
}: {
  onClick: () => void;
  children: React.ReactNode;
  destructive?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left font-sans text-[12px] transition-colors ${
        destructive
          ? "text-[#DC2626] hover:bg-[#DC2626]/10"
          : "text-ink hover:bg-paper-warm"
      }`}
    >
      {children}
    </button>
  );
}
