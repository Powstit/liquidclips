"use client";

// ───── IRON GATE IG-007 (v0.7.32) — see desktop/docs/IRON_GATES.md ─────
// ClipCard structure is a literal copy of the LibraryCard pattern (per
// Daniel's directive after the "lines" regression took an entire day to
// diagnose). The outer <article> uses ONLY `library-card relative` —
// adding `p-4`, `gap-3`, `rounded-2xl`, `flex flex-col` to it reintroduces
// the workbench-background-bleed-through gap where horizontal "lines" appear.
// HUD corner spans use TWO classes (base `library-card-corner` + side-
// specific). The thumbnail uses `aspect-[9/16] overflow-hidden rounded-2xl`
// with no bg-paper-warm fallback. Below-thumb meta uses `mt-3 px-1.5`.
// No tilt transform on the library-card class (removed in same turn).
// Don't restructure without explicit Daniel sign-off — the regression cost
// hours of debugging.
//
// ship-lens v0.7.13: select + onError. Selection state lifted to parent via onSelectClick — the grid manages a Set<number>. onError plate replaces the silent-black-square strand for corrupt / iCloud-placeholder / 0-byte files.

import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
// v0.7.45 — `openSmart` replaces shell.open in `revealBrokenFile` below.
// The broken-file plate's Reveal-in-Finder button feeds the file's parent
// directory (a `/Users/...` path) to the opener — shell.open's URL regex
// rejected the path and the surrounding error UI swallowed the error,
// so the user saw the plate but Finder never opened. IG-007 locks the
// outer <article>; this swap is import-only.
import { openSmart as openExternal } from "../../lib/openSmart";
import { AlertTriangle, Check, Copy, Edit3, MessageSquare, Sparkles, Trash2 } from "lucide-react";
import { RingButton } from "../cockpit/LibraryCard";
import { useTier } from "../../lib/useTier";
import { openAuthPanel } from "../auth/useAuthPanel";
import type { Clip, OverlayType, Project, RatioKey } from "../../lib/sidecar";
import { sidecar } from "../../lib/sidecar";
import { useReactionBakeProgress } from "../../lib/useReactionBakeProgress";
import { type LayoutKey } from "./LayoutIcon";
import { pickOverlaySource } from "../OverlaySourcePicker";
import { BountyFitPill } from "../earn/bounty-fit";
import { PlatformBadge } from "../PlatformBadge";
// v0.7.32 — useCountUp removed alongside the virality count-up pill that
// lived in the above-thumb header row (cut per the mockup).
// import { useCountUp } from "../../lib/useCountUp";
import { ConfirmDialog } from "../ConfirmDialog";

// Self-contained card. Tap = play preview. Layout icons swap composition in
// place. Copy buttons inline. "..." opens the side-door full editor for the
// rare power case. No modals required for the 90% review-and-ship flow.

// v0.7.32 — formatHms() + viralityClass() removed. They were used by the
// pre-mockup above-thumbnail header row (time-range + virality pill) that
// was cut per docs/clipcard-v0732-target.html. Time + score now render in
// the below-thumb meta line via formatCardDur(); virality intensity is
// implied by the HOT badge (≥78) and the literal "score N" text.

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
  selected,
  onSelectClick,
  focused = false,
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
  /** Multi-select state — when true, the card renders a fuchsia HUD ring +
   *  ticked checkbox. Only meaningful when `onSelectClick` is also provided. */
  selected?: boolean;
  /** v0.7.25 — Focused (cockpit-target) state. Plain card click sets this;
   *  the cockpit's Reaction / Caption / etc. modules operate on this clip.
   *  Visually distinct from `selected` — pulsing brighter ring + corner glow.
   *  Coexists with `selected` (a focused clip can also be part of a bulk set
   *  when shift/cmd-clicked on top). */
  focused?: boolean;
  /** Multi-select click handler. When provided (parent grid is managing a
   *  Set<number> of selected indices), the card surfaces a checkbox and the
   *  primary background click forwards meta/shift to the parent so it can
   *  toggle / range-select / additive-select. When undefined (legacy
   *  callers), the card is byte-identical to v0.7.12: no checkbox, no ring,
   *  no background click handler. */
  onSelectClick?: (e: { meta: boolean; shift: boolean }) => void;
}) {
  const [busy, setBusy] = useState(false);
  // v0.7.49 — Tier gate. ClipCard's "R" Sparkles button was a live bypass
  // around ReactionControls' Solo+ moat; mirroring the gate here closes
  // that surface so the conversion offer stays consistent everywhere.
  const clipCardTier = useTier();
  // v0.7.46 — kebab menu retired in favour of the inline RingButton row
  // (Caption / Reaction / Copy / Editor / Remove). Removing the showMenu
  // state + refs and the dead MenuItem helper.
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
  // <video> onError plate — when the file is corrupt / 0-byte / an iCloud
  // dataless placeholder, the element used to render as a silent black square.
  // Now we surface the message + a Reveal-in-Finder button so the clipper
  // can act. Null while the video is healthy.
  const [videoError, setVideoError] = useState<string | null>(null);
  // P1 #12 — sidecar overlay_progress wired into the card so the fast-path
  // applyLayout (which kicks off a ~5-30s ffmpeg bake) is no longer silent.
  // Mirrors ReactionControls' pattern: start before applyOverlay, stop in
  // finally. The inline strip renders below the existing cockpitError slot.
  const { progress: bakeProgress, start: startBakeProgress, stop: stopBakeProgress } =
    useReactionBakeProgress();
  const videoRef = useRef<HTMLVideoElement>(null);

  const videoPath = useMemo(
    () => pathForRatio(clip, ratio) ?? clip.cut_path,
    [clip, ratio, clip.overlay],
  );
  const videoSrc = videoPath ? convertFileSrc(videoPath) : null;
  const thumb = clip.thumbnails?.[0]?.path;
  const thumbSrc = thumb ? convertFileSrc(thumb) : null;

  // Reset the error plate whenever the underlying file changes — picking a
  // different ratio or rebaking an overlay should give the new render a
  // fresh chance to load before we surface another failure.
  useEffect(() => {
    setVideoError(null);
  }, [videoSrc]);

  // Reveal the broken file's parent folder in Finder so the clipper can
  // confirm / restore the iCloud placeholder / re-render. Matches the
  // pattern used in ClipPreview.revealInFinder.
  async function revealBrokenFile() {
    if (!videoPath) return;
    const sep = videoPath.includes("\\") ? "\\" : "/";
    const idx = videoPath.lastIndexOf(sep);
    const dir = idx > 0 ? videoPath.slice(0, idx) : videoPath;
    try {
      await openExternal(dir);
    } catch {
      // Swallow — the plate is informational. A failed Finder open isn't
      // worth a second nested error UI inside the fallback overlay.
    }
  }

  const currentLayout: LayoutKey = (clip.overlay?.type as LayoutKey) ?? "none";

  // Tiny hover-to-preview: start playing on pointer enter, pause + rewind on leave.
  // Hover-preview is OPT-IN — `previewMotionOn` defaults false. Without it,
  // hover does nothing and the static poster stays. When the global motion
  // pref is on, hover plays. When the global sound pref is also on, hover
  // unmutes. Leave re-mutes + pauses + rewinds so audio never leaks across
  // cards. Lens fix v0.6.51 — Daniel's "motion on clip is uneeded" finding.
  // K2 enhancement — 200ms hover delay prevents thrash on rapid cursor drift;
  // skip autoplay when the card is selected (avoids drawing attention away
  // from selection state).
  // v0.7.32 — Variant B rest-state. At rest, the card shows the static
  // thumbnail image when available, else a brand fuchsia/purple gradient
  // placeholder. The <video> element only mounts on hover (after a 200ms
  // delay) AND only when previewMotionOn is on. This removes the "lines"
  // issue where imported clips render the source video's raw first frame
  // (intro chrome / title-card bars) as their poster — imported packs
  // never write `clip.thumbnails` so the prior <video preload="metadata">
  // fell through to show whatever the first decoded frame happened to be.
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimerRef = useRef<number | null>(null);
  const onEnter = () => {
    setIsHovered(true);
    if (!previewMotionOn || selected) return;
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
    }
    hoverTimerRef.current = window.setTimeout(() => {
      const v = videoRef.current;
      if (!v) return;
      if (previewSoundOn) v.muted = false;
      void v.play().catch(() => undefined);
    }, 200);
  };
  const onLeave = () => {
    setIsHovered(false);
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
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
    // P1 #12 — start the overlay_progress listener so the inline strip can
    // render per-bake pct + ratio while ffmpeg runs. Pickers run BEFORE the
    // bake starts so it's safe to attach now and stop in finally.
    await startBakeProgress();
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
      stopBakeProgress();
      setBusy(false);
    }
  }

  // Reaction shortcut — re-pick the b-roll source for the CURRENT layout
  // without forcing a layout change. If no layout is set, default to
  // `pip-bl` (a sensible reaction starter) and open the picker so the
  // clipper sees the source picker immediately. Aligned with the cockpit
  // row's promise: every action visible, no modal dance.
  async function changeReaction() {
    // v0.7.49 — Bypass path closed. The ClipCard "R" Sparkles button used
    // to skip the tier gate that lives on the cockpit's layout-tile grid,
    // letting free users bake paid layouts from any card. Match the same
    // Solo+ guard that ReactionControls enforces.
    if (clipCardTier.tier === "free") {
      openAuthPanel("upgrade");
      return;
    }
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Remove failed";
      setCockpitError(msg.slice(0, 90));
      window.setTimeout(() => setCockpitError(null), 4000);
      // Keep the modal open so the user can retry without re-opening it.
    } finally {
      setBusy(false);
    }
  }

  // Multi-select wiring — only active when the parent grid passed
  // `onSelectClick`. The handler forwards meta/shift so the grid can
  // implement toggle / range / additive selection without the card
  // needing to know the rules. Legacy callers (no onSelectClick) get
  // the same `<article>` they had in v0.7.12 — no extra wrapper, no
  // background click handler, no ring, no checkbox.
  const selectable = typeof onSelectClick === "function";
  const handleCardClick = selectable
    ? (e: React.MouseEvent<HTMLElement>) => {
        onSelectClick?.({ meta: e.metaKey, shift: e.shiftKey });
      }
    : undefined;
  // Selection ring is the bulk-target ring (kept). Focus ring is brighter
  // and offset less — distinct visually so a focused-AND-selected clip
  // shows both bands.
  const selectedRingClass = selectable && selected
    ? " ring-2 ring-fuchsia ring-offset-2 ring-offset-ink"
    : "";
  const focusedRingClass = focused
    ? " outline outline-2 outline-offset-[3px] outline-fuchsia/70 shadow-[0_0_24px_rgba(255,26,140,0.32)]"
    : "";
  const ringClass = selectedRingClass + focusedRingClass;

  return (
    <article
      className={`group/clipcard library-card relative${ringClass}`}
      onClick={handleCardClick}
      aria-selected={selectable ? !!selected : undefined}
    >
      {/* v0.7.32 FINAL — literal copy of the LibraryCard structure (which
          renders the clean Library wall per Daniel's image #11) + the
          docs/clipcard-v0732-target.html mockup. Outer = `library-card
          relative` (no extra padding, no rounded-2xl, no flex). HUD corners
          use the TWO-class pattern (base `library-card-corner` + side-
          specific class) so the dashed-fuchsia styles cascade properly.
          Inner thumbnail = `aspect-[9/16] overflow-hidden rounded-2xl`.
          Below = title + dur·score in plain wrapper. Removes the p-4 gap
          between HUD corners and thumbnail where the workbench background
          could bleed through. */}

      {/* HUD bracket corners — fuchsia dashed, two-class pattern (base
          + side) matches LibraryCard exactly. */}
      <span className="library-card-corner library-card-corner-tl" aria-hidden />
      <span className="library-card-corner library-card-corner-tr" aria-hidden />
      <span className="library-card-corner library-card-corner-bl" aria-hidden />
      <span className="library-card-corner library-card-corner-br" aria-hidden />

      {/* Video / poster — hover to preview. rounded-2xl + no bg so the
          thumbnail fills cleanly, matches demo's `.lc-thumb`. */}
      <div
        className="relative aspect-[9/16] overflow-hidden rounded-2xl"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        {/* v0.7.32 — Variant B rest-state. Render priority:
            1. Hover + previewMotionOn + videoSrc + no error → mount <video>
               (autoplay muted to avoid the first-frame-as-poster issue).
            2. thumbSrc available → static <img> poster.
            3. Else → brand fuchsia/purple gradient placeholder.
            The <video> NEVER mounts at rest, so imported clips' first-frame
            chrome (title cards, intro bars, lower-thirds) never shows. */}
        {isHovered && previewMotionOn && videoSrc && videoError === null ? (
          <video
            key={videoSrc}
            ref={videoRef}
            src={videoSrc}
            autoPlay
            muted
            playsInline
            loop
            preload="auto"
            poster={thumbSrc ?? undefined}
            className="h-full w-full object-cover"
            onError={(e) =>
              setVideoError(
                e.currentTarget.error?.message ?? "couldn't play this clip",
              )
            }
          />
        ) : thumbSrc && videoError === null ? (
          <img src={thumbSrc} alt={clip.title} className="h-full w-full object-cover" />
        ) : videoError === null ? (
          // Brand-aligned gradient fallback for clips with no thumbnail
          // (typically imported packs). Mirrors the docs/clipcard-v0732-
          // target.html mockup's Variant B placeholder + brand-kit OASIS
          // chrome aesthetic. Matches the Library wall's bug-sprite slot
          // semantically — "this clip exists but has no static poster yet".
          <div
            className="h-full w-full"
            style={{
              background:
                "radial-gradient(circle at 30% 40%, rgba(255,26,140,0.18), transparent 45%), radial-gradient(circle at 70% 60%, rgba(140,80,200,0.22), transparent 50%), linear-gradient(135deg, #3a2233, #1a1a22 50%, #2a1a2a)",
            }}
            aria-hidden
          />
        ) : null}
        {/* onError fallback plate — replaces the silent black square for
            corrupt / 0-byte / iCloud-placeholder files. */}
        {videoError !== null && (
          <div
            role="alert"
            className="absolute inset-0 grid place-items-center bg-ink/95 p-4 text-paper"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex max-w-[220px] flex-col items-center gap-2 text-center">
              <AlertTriangle
                className="h-6 w-6 text-[var(--color-danger)]"
                strokeWidth={2.25}
                aria-hidden
              />
              <p className="font-sans text-[12px] leading-snug text-paper">
                This clip can't play, {videoError}
              </p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void revealBrokenFile();
                }}
                disabled={!videoPath}
                className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-fuchsia bg-fuchsia px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-white transition-colors hover:bg-fuchsia-bright disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reveal in Finder
              </button>
            </div>
          </div>
        )}

        {/* TL — selection checkbox INSIDE thumbnail (was above-thumb row). */}
        {selectable && (
          <button
            type="button"
            role="checkbox"
            aria-checked={!!selected}
            aria-label={selected ? "Deselect clip" : "Select clip"}
            onClick={(e) => {
              e.stopPropagation();
              onSelectClick?.({ meta: e.metaKey, shift: e.shiftKey });
            }}
            className={`absolute left-2.5 top-2.5 grid h-[22px] w-[22px] place-items-center rounded-md border backdrop-blur-sm transition-all ${
              selected
                ? "border-fuchsia bg-fuchsia text-white shadow-[0_0_12px_rgba(255,26,140,0.5)]"
                : "border-line-strong bg-paper/70 text-transparent hover:border-fuchsia"
            }`}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        )}

        {/* TR — social pips. Three states:
            1. Clip routed → bright PlatformBadge of the routed platforms.
            2. Bounty attached + no platforms → BountyFit pill.
            3. Neither → low-opacity placeholder of the 4 default platforms
               as a routing affordance hint (per Daniel: "add the social
               media icons"). Hint state mirrors the demo mockup's visible
               pips for cards that haven't been routed yet. */}
        {clip.platforms && clip.platforms.length > 0 ? (
          <span className="absolute right-2.5 top-2.5">
            <PlatformBadge
              platforms={clip.platforms}
              size="sm"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("lc:settings-open-tab", { detail: { tab: "channels" } })
                );
              }}
            />
          </span>
        ) : project.whop_bounty_id ? (
          <span className="absolute right-2.5 top-2.5">
            <BountyFitPill clip={clip} project={project} />
          </span>
        ) : (
          <span
            className="pointer-events-none absolute right-2.5 top-2.5 opacity-45"
            title="Route this clip via the cockpit's Channels module to publish to these platforms"
          >
            <PlatformBadge
              platforms={["tiktok", "instagram", "youtube", "x"]}
              size="sm"
            />
          </span>
        )}

        {/* BL — ratio pill. Liquid Clips outputs 9:16 vertical by default
            (per CLAUDE.md "reframe to 9:16"); this is a brand-standard
            indicator, not a per-clip variable until non-9:16 ratios ship. */}
        <span className="pointer-events-none absolute bottom-2.5 left-2.5 rounded-full bg-paper/72 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink backdrop-blur-sm">
          9:16
        </span>

        {/* BR — HOT badge, conditional on virality ≥ 78 per the demo. */}
        {clip.virality >= 78 && (
          <span className="pointer-events-none absolute bottom-2.5 right-2.5 rounded-full border border-fuchsia/50 bg-fuchsia/18 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-fuchsia backdrop-blur-sm">
            hot
          </span>
        )}
      </div>

      {/* Below-thumb meta — title + dur · score. mt-3 matches the demo
          mockup's `.lc-meta { padding: 12px 6px 0 }` spacing. No "TITLE"
          eyebrow (impeccable AI-grammar tell; the title is its own header). */}
      <div className="mt-3 px-1.5">
        <p className="line-clamp-2 font-display text-[14px] font-semibold leading-snug tracking-[-0.01em] text-ink">
          {clip.title}
        </p>
        <div className="mt-2 flex items-center gap-2 font-mono text-[11px] text-text-secondary opacity-80">
          <span>{formatCardDur(clip.end - clip.start)}</span>
          <span className="opacity-40">·</span>
          <span>score {clip.virality ?? 0}</span>
        </div>
      </div>

      {/* v0.7.46 — Library-card visual parity: replace the old text-pill
          row (Caption / Reaction / Copy / Editor / ⋮) with the same
          RingButton icon row LibraryCard uses, so URL-created and imported
          clips share one vocabulary. Hover-reveal opacity, fuchsia hover
          state, destructive accent on Remove. 5 distinct actions, 1
          consistent button shape. */}
      <div
        className="opacity-55 group-hover/clipcard:opacity-100 transition-opacity"
        onClick={selectable ? (e) => e.stopPropagation() : undefined}
      >
        <div className="flex items-center justify-end gap-1">
          <RingButton
            onClick={() => (onOpenCaptions ?? onOpenEditor)()}
            title="Edit captions (C)"
            ariaLabel="Edit captions"
          >
            <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
          </RingButton>
          <RingButton
            onClick={() => void changeReaction()}
            disabled={busy}
            title={currentLayout === "none" ? "Add reaction b-roll (R)" : "Change reaction source (R)"}
            ariaLabel={currentLayout === "none" ? "Add reaction" : "Change reaction"}
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
          </RingButton>
          <RingButton
            onClick={() => void copyAll()}
            disabled={busy}
            active={copied}
            title="Copy title + description"
            ariaLabel={copied ? "Copied" : "Copy title + description"}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" strokeWidth={2.25} />
            ) : (
              <Copy className="h-3.5 w-3.5" strokeWidth={2} />
            )}
          </RingButton>
          <RingButton
            onClick={onOpenEditor}
            title="Open full editor (Enter)"
            ariaLabel="Open editor"
          >
            <Edit3 className="h-3.5 w-3.5" strokeWidth={2} />
          </RingButton>
          <RingButton
            onClick={remove}
            disabled={busy}
            destructive
            title="Remove clip"
            ariaLabel="Remove clip"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          </RingButton>
        </div>

        {/* Card-local error / status chip — surfaces failed layout swaps,
            failed remove, etc. without orphaning the cause in a global
            toast. Auto-clears after ~4.5s. */}
        {cockpitError && (
          <p
            role="alert"
            className="rounded-md border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-danger)]"
          >
            {cockpitError}
          </p>
        )}

        {/* P1 #12 — fast-path applyLayout bake progress. Inline tiny strip so
            the user sees the ffmpeg pass instead of a spinning Reaction
            button. Hides when no bake in flight or after the sidecar emits
            stage "done". */}
        {bakeProgress && bakeProgress.stage !== "done" && (
          <div
            role="status"
            aria-live="polite"
            className="mt-1 space-y-1 rounded-md border border-fuchsia/30 bg-fuchsia-soft/15 px-2.5 py-1"
          >
            <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.12em] text-fuchsia-deep">
              <span>
                {bakeProgress.stage === "starting"
                  ? "Starting bake…"
                  : bakeProgress.ratio
                  ? `Baking ${bakeProgress.ratio}…`
                  : "Baking…"}
              </span>
              <span>{bakeProgress.pct}%</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-paper">
              <div
                className="h-full rounded-full bg-fuchsia transition-all duration-300"
                style={{ width: `${bakeProgress.pct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ConfirmDialog. When the parent grid enabled multi-select, we wrap
          in a propagation-stop div so dialog clicks don't bubble into the
          article's selection handler. When `selectable` is false we render
          the dialog directly — no wrapper — so the no-selection codepath
          is byte-identical to v0.7.12 (no extra empty flex child). */}
      {selectable ? (
        <div onClick={(e) => e.stopPropagation()}>
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
        </div>
      ) : (
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
      )}
    </article>
  );
}

function formatCardDur(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

