import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Volume2, AudioLines, VolumeX, Captions as CaptionsIcon } from "lucide-react";
import type { Clip, OverlayType, Project, RatioKey } from "../lib/sidecar";
import { sidecar, RATIOS } from "../lib/sidecar";
import { CopyButton } from "./CopyButton";
import { InfoTip } from "./InfoTip";
import { LayoutIcon, LAYOUTS, type LayoutKey } from "./clips-feed/LayoutIcon";
import { pickOverlaySource } from "./OverlaySourcePicker";
import { ReactionCellPreview } from "./clips-feed/ReactionCellPreview";
import { LAYOUT_TOPOLOGY } from "./clips-feed/layout-cells";
import { BountyFitChecklist } from "./earn/bounty-fit";
import { CaptionDrawer, CaptionOverlay } from "./captions/CaptionDrawer";
import { CAPTION_STYLES, type CaptionStyleKey } from "../lib/caption-styles";

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
  initialCaptionsOpen = false,
}: {
  clip: Clip;
  index: number;
  slug: string;
  project: Project;
  totalClips: number;
  onClose: () => void;
  onProjectChange: (p: Project) => void;
  onNavigate?: (direction: -1 | 1) => void;
  /** Open the Captions drawer on mount. Set when the user clicks the
   * captions chip on a ResultsGrid card. */
  initialCaptionsOpen?: boolean;
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
  // Auto-persist for the reaction Audio + Offset controls. These used to be
  // "set local state and hope the user clicks a layout tile again" — silent
  // data loss on modal close. See P0 audit 2026-06-06.
  const [overlaySaveState, setOverlaySaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [overlaySaveError, setOverlaySaveError] = useState<string | null>(null);
  // Microcopy text — separated from the saving/saved beat so we can pick
  // "audio saved" vs "offset saved" based on which field actually changed last.
  const [overlaySaveLabel, setOverlaySaveLabel] = useState<string>("");

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
    setOverlaySaveState("idle");
    setOverlaySaveError(null);
    setOverlaySaveLabel("");
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
  // Captions edit-and-rebake replaces the file in place. Bumping `videoCacheBuster`
  // forces React to recreate the <video> element so the new MP4 plays.
  const [videoCacheBuster, setVideoCacheBuster] = useState(0);
  const videoSrc = videoPath
    ? `${convertFileSrc(videoPath)}${videoCacheBuster ? `?v=${videoCacheBuster}` : ""}`
    : null;
  const layout: LayoutKey = (clip.overlay?.type as LayoutKey) ?? "none";

  // Captions drawer + live overlay state.
  const videoEl = useRef<HTMLVideoElement | null>(null);
  const videoFrameEl = useRef<HTMLDivElement | null>(null);
  const [captionsOpen, setCaptionsOpen] = useState(initialCaptionsOpen);
  const [captionsDirty, setCaptionsDirty] = useState(false);
  // Live preview override from the drawer — when the clipper is dragging
  // colour swatches or switching styles, this carries the in-edit state so
  // the overlay reflects unsaved edits without waiting for Apply.
  const [livePreview, setLivePreview] = useState<{
    style: CaptionStyleKey;
    palette?: import("../lib/caption-styles").CaptionPalette;
    lines: Array<{ start: number; end: number; text: string; words?: Array<{ start: number; end: number; text: string }> }>;
  } | null>(null);
  const [playheadTime, setPlayheadTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const captionStyle = (clip as Clip & { caption_style?: string }).caption_style;
  const overlayStyle: CaptionStyleKey =
    captionStyle && (CAPTION_STYLES as Record<string, unknown>)[captionStyle]
      ? (captionStyle as CaptionStyleKey)
      : "brand_fuchsia";
  const [overlayLines, setOverlayLines] = useState<
    Array<{ start: number; end: number; text: string; words?: Array<{ start: number; end: number; text: string }> }>
  >([]);

  // Hook the video element's timeupdate + loadedmetadata to feed the drawer.
  useEffect(() => {
    const v = videoEl.current;
    if (!v) return;
    const onTime = () => setPlayheadTime(v.currentTime);
    const onMeta = () => setVideoDuration(v.duration || 0);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
    };
  }, [videoSrc]);

  // Track the rendered height of the video frame so CaptionOverlay scales correctly.
  useEffect(() => {
    const el = videoFrameEl.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerHeight(el.clientHeight));
    ro.observe(el);
    setContainerHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // First-open lines fetch so the live overlay reflects current captions even
  // before the user opens the drawer. Cheap RPC; only runs when the clip changes.
  // v0.6.x P0 fix: surface failure when the clip is supposed to have captions
  // but we couldn't load the overlay lines. Was a silent catch — clipper saw
  // no live overlay and no explanation.
  const [captionsFetchFailed, setCaptionsFetchFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setCaptionsFetchFailed(false);
    sidecar
      .getCaptions(slug, index - 1)
      .then((res) => {
        if (cancelled) return;
        setOverlayLines(res.lines);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn(
          `[ClipPreview] getCaptions failed for slug=${slug} idx=${index - 1}:`,
          err,
        );
        setOverlayLines([]);
        setCaptionsFetchFailed(true);
      });
    return () => { cancelled = true; };
  }, [slug, index, clip.vertical_path, videoCacheBuster]);

  // P0 fix (2026-06-06): debounced persistence for Audio + Offset controls.
  // Old behaviour: setAudioSource / setBrollOffset only mutated local React
  // state. The value was sent to the backend on the NEXT layout-tile click via
  // applyLayout's closure capture. If the user changed audio + closed the
  // modal: silently lost. Now we mirror the change to the backend with a 400ms
  // debounce.
  //
  // Loop safety: the effect only fires when local state DIVERGES from the
  // current clip prop (compared on every render). After the RPC succeeds, the
  // parent receives a new project where clip.overlay.audio_source ==
  // audioSource, so the divergence check is false and the effect doesn't re-
  // fire. The sync-from-prop effect above won't refire either because the
  // value is already equal.
  //
  // Precondition: an overlay must already exist (source_path is required by
  // the applyOverlay API). The Audio/Offset UI is only mounted when
  // layout !== "none", which guarantees overlay.source_path — but we still
  // guard here in case clip prop arrives mid-transition.
  useEffect(() => {
    const overlay = clip.overlay;
    if (!overlay || !overlay.source_path) return;
    const audioDiverges = audioSource !== (overlay.audio_source ?? "main");
    const offsetDiverges = Math.abs(brollOffset - (overlay.start_offset_s ?? 0)) > 1e-6;
    if (!audioDiverges && !offsetDiverges) return;
    // Pick the microcopy that reflects whatever changed. If both diverge in
    // the same window, "reaction saved" is more accurate than picking one.
    const label =
      audioDiverges && offsetDiverges
        ? "reaction saved"
        : audioDiverges
        ? "audio saved"
        : "offset saved";
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      setOverlaySaveState("saving");
      setOverlaySaveError(null);
      setOverlaySaveLabel(label);
      try {
        const r = await sidecar.applyOverlay(slug, index - 1, {
          type: overlay.type,
          source_path: overlay.source_path,
          start_offset_s: brollOffset,
          audio_source: audioSource,
        });
        if (cancelled) return;
        onProjectChange(r.project);
        setOverlaySaveState("saved");
        window.setTimeout(() => {
          setOverlaySaveState((s) => (s === "saved" ? "idle" : s));
        }, 1500);
      } catch (e) {
        if (cancelled) return;
        const msg = String(e);
        console.warn("[ClipPreview] applyOverlay (auto-persist) failed:", e);
        setOverlaySaveError(msg);
        setOverlaySaveState("idle");
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
    // Intentionally exclude onProjectChange — the parent passes a fresh ref
    // every render and re-running this effect on parent re-renders would
    // schedule (and immediately cancel) a save on every keystroke elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioSource, brollOffset, slug, index, clip.overlay]);

  // Esc closes, ←/→ navigate.
  // P0 fix (2026-06-06): explicit ownership of Esc so the modal doesn't yank
  // the user out of a dirty Captions drawer. Both this listener and the
  // drawer's listener attach to `window` and event order is not guaranteed —
  // without these guards the modal can close (no dirty-prompt) before the
  // drawer's tryClose runs. The drawer owns Esc when open (its tryClose runs
  // the unsaved-edits confirm); the reaction-source picker owns it when up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.getElementById("__reaction-source-picker")) return;
      if (e.key === "Escape") {
        // Drawer's own keydown handler will run its tryClose (which respects
        // the dirty-state confirm). Bail here so the modal doesn't also close.
        if (captionsOpen) return;
        onClose();
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && /INPUT|TEXTAREA/.test(t.tagName)) return;
      // Don't navigate clips while the captions drawer owns the keyboard —
      // ←/→ may be used inside the drawer's controls.
      if (captionsOpen) return;
      if (e.key === "ArrowLeft" && onNavigate && index > 1) onNavigate(-1);
      if (e.key === "ArrowRight" && onNavigate && index < totalClips) onNavigate(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onNavigate, index, totalClips, captionsOpen]);

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
        // Re-use an existing reaction source when switching layouts. The
        // "Change reaction clip" button is the explicit path to pick a new
        // file/source; layout buttons should feel like layout buttons.
        const existing = clip.overlay?.source_path;
        let source: string | undefined = existing;
        if (opts?.forcePick || !source) {
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
        className="relative flex h-full max-h-[94vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-2xl bg-paper shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <CaptionDrawer
          open={captionsOpen}
          slug={slug}
          clipIdx={index - 1}
          currentTime={playheadTime}
          videoDuration={videoDuration}
          onClose={() => setCaptionsOpen(false)}
          onSeek={(t) => { if (videoEl.current) videoEl.current.currentTime = t; }}
          onApplied={(_path, style) => {
            // Cache-bust the video src so the new MP4 plays in place.
            setVideoCacheBuster(Date.now());
            // Reflect the new style in the live overlay without a reload.
            // (overlayStyle reads from clip.caption_style — bumping the project
            // covers persistent state; cacheBuster forces the lines re-fetch.)
            void style;
          }}
          onDirtyChange={setCaptionsDirty}
          onPreviewChange={setLivePreview}
        />
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
                {/* v0.6.8 — LC Score pill replaces bare virality. Tooltip carries
                    the LLM's score_reason ("Why this clip"). */}
                <span
                  title={clip.score_reason || "LC Score · AI estimate of hook, retention, clarity, and shareability."}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.10em] ${viralityClass(clip.virality)}`}
                >
                  <span className="opacity-80">LC</span>
                  <span className="font-display text-[12px] font-bold leading-none tracking-[-0.02em]">{clip.virality}</span>
                </span>
                {clip.theme && <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-tertiary">{clip.theme}</span>}
                <span className="font-mono text-[11px] text-text-tertiary">{formatHms(clip.start)} → {formatHms(clip.end)}</span>
              </div>
              <h3 className="mt-1 truncate font-display text-[20px] font-semibold leading-tight tracking-[-0.01em] text-ink">{clip.title}</h3>
              {/* v0.6.8 — "Why this clip" line directly under the title.
                  Quiet but visible so the score doesn't feel like a magic number. */}
              {clip.score_reason && (
                <p className="mt-1 line-clamp-2 font-sans text-[12px] leading-snug text-text-secondary">
                  <span className="font-mono uppercase tracking-[0.12em] text-fuchsia">why · </span>
                  {clip.score_reason}
                </p>
              )}
              {clip.score_breakdown && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                  <span>hook <span className="text-ink">{clip.score_breakdown.hook}</span></span>
                  <span>ret <span className="text-ink">{clip.score_breakdown.retention}</span></span>
                  <span>clr <span className="text-ink">{clip.score_breakdown.clarity}</span></span>
                  <span>shr <span className="text-ink">{clip.score_breakdown.shareability}</span></span>
                </div>
              )}
            </div>
            {onNavigate && (
              <button onClick={() => onNavigate(1)} disabled={index >= totalClips}
                className="shrink-0 rounded-full border border-line bg-paper px-2.5 py-1.5 font-mono text-[12px] text-text-secondary hover:border-fuchsia hover:text-ink disabled:opacity-30"
                aria-label="Next (→)" title="Next (→)">→</button>
            )}
          </div>
          <div className="shrink-0 flex flex-col items-end gap-0.5">
            <button
              type="button"
              onClick={() => setCaptionsOpen((open) => !open)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] transition ${
                captionsOpen
                  ? "border-fuchsia bg-fuchsia/20 text-fuchsia"
                  : "border-line bg-paper text-text-secondary hover:border-fuchsia hover:text-ink"
              }`}
              aria-pressed={captionsOpen}
              aria-label="Toggle captions editor"
            >
              <CaptionsIcon size={14} aria-hidden />
              Captions
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${
                  captionsDirty ? "bg-fuchsia" : "bg-cyan"
                }`}
                style={{
                  boxShadow: captionsDirty
                    ? "0 0 6px var(--color-fuchsia, #ff1a8c)"
                    : "0 0 6px var(--color-cyan, #00e5ff)",
                }}
              />
            </button>
            {/* P0 fix (2026-06-06): surface a getCaptions failure when the
                clip was supposed to have captions but we couldn't load the
                overlay lines. Quiet inline hint, not a toast — the chip is
                already a focal point. */}
            {captionsFetchFailed && captionStyle && overlayLines.length === 0 && (
              <span
                className="font-mono text-[10px] tracking-[0.08em] text-[#DC2626]"
                title="getCaptions RPC failed. The MP4 still plays; only the live overlay preview is missing."
              >
                captions overlay unavailable — try Apply again
              </span>
            )}
          </div>
          <button onClick={onClose}
            className="shrink-0 rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] text-text-secondary hover:border-fuchsia hover:text-ink">
            Close · esc
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-0 overflow-hidden lg:flex-row">
          {/* LEFT: final preview + ratio chips */}
          <div className="flex w-full flex-col gap-3 bg-ink p-5 lg:w-[58%]">
            {/* Ratio chips */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-paper">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper/55">
                final preview
              </span>
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
            <div
              ref={videoFrameEl}
              className="relative flex flex-1 items-center justify-center overflow-hidden rounded-xl bg-black"
            >
              {videoSrc ? (
                <>
                  <video
                    key={videoSrc}
                    ref={videoEl}
                    controls
                    autoPlay
                    loop
                    muted={!!clip.overlay?.music_bed}
                    src={videoSrc}
                    className="max-h-full max-w-full"
                  />
                  {/* Live caption overlay — DOM-rendered over the playing video.
                      CRITICAL: only render when the user is actively editing
                      (drawer open + unsaved edits) OR the clip has never been
                      baked with captions. Otherwise the burned-in captions in
                      the MP4 AND the DOM overlay would render together,
                      doubling every line. */}
                  {(() => {
                    // Live edit wins over baked clip data when the drawer is
                    // pushing a preview. Falls back to the baked overlayLines
                    // + clip.caption_style/palette when no live edit is active.
                    const effectiveLines = livePreview?.lines ?? overlayLines;
                    const effectiveStyle = livePreview?.style ?? overlayStyle;
                    const effectivePalette =
                      livePreview?.palette ?? clip.caption_palette;
                    const shouldRender =
                      effectiveLines.length > 0 &&
                      ((captionsOpen && captionsDirty) ||
                        !(clip as Clip & { caption_style?: string }).caption_style);
                    return shouldRender ? (
                      <CaptionOverlay
                        currentTime={playheadTime}
                        lines={effectiveLines}
                        style={effectiveStyle}
                        palette={effectivePalette}
                        containerHeight={containerHeight}
                      />
                    ) : null;
                  })()}
                </>
              ) : (
                <p className="font-mono text-[12px] text-text-tertiary">No video yet for {ratio}.</p>
              )}
            </div>

            {/* Inline status row */}
            <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.08em] text-paper/60">
              <span>{LAYOUT_TOPOLOGY[layout].label}</span>
              {clip.overlay?.source_path && <span className="text-fuchsia-bright">reaction applied</span>}
            </div>
          </div>

          {/* RIGHT: cell editor + metadata */}
          <div className="flex w-full flex-col gap-5 overflow-y-auto p-5 lg:w-[42%]">
            {/* Cell editor */}
            <BountyFitChecklist clip={clip} project={project} />

            <section className="space-y-3">
              {/* Layout strip — reaction layouts as labeled icon tiles */}
              <div className="rounded-2xl border border-fuchsia-soft bg-fuchsia-soft/15 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia-deep">
                      reaction studio
                    </div>
                    <p className="mt-0.5 font-sans text-[12px] leading-snug text-text-secondary">
                      Add a second clip. Stack, split, or PiP.
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                  {LAYOUTS.map((item) => {
                    const active = layout === item.key;
                    return (
                      <button
                        key={item.key}
                        onClick={() => void applyLayout(item.key)}
                        disabled={busy}
                        title={item.label}
                        aria-pressed={active}
                        className={`flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-lg border px-1.5 py-2 transition-all ${
                          active
                            ? "border-fuchsia bg-fuchsia text-white shadow-[var(--glow-sm)]"
                            : "border-line bg-paper text-ink hover:border-fuchsia hover:bg-fuchsia-soft/20"
                        } disabled:opacity-50`}
                      >
                        <LayoutIcon kind={item.key} />
                        <span className="text-center font-sans text-[10px] font-medium leading-tight">
                          {item.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Playable cell preview */}
              <ReactionCellPreview
                kind={layout}
                mainPath={clip.vertical_path || clip.cut_path || null}
                mainTitle={clip.title}
                reactionPath={clip.overlay?.source_path ?? null}
                audioSource={audioSource}
                busy={busy}
                onPick={() => void applyLayout(layout === "none" ? "stack-bottom" : layout, { forcePick: true })}
                onRemove={() => void applyLayout("none")}
                onApply={() => void applyLayout(layout)}
              />

              {/* Audio + timing — only when there's a reaction layout */}
              {layout !== "none" && (
                <div className="space-y-3 rounded-xl border border-line bg-paper p-3.5">
                  <div>
                    <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                      audio
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {([
                        ["main",  "Main",     Volume2],
                        ["broll", "Reaction", AudioLines],
                        ["muted", "Muted",    VolumeX],
                      ] as const).map(([key, label, Icon]) => {
                        const on = audioSource === key;
                        return (
                          <button
                            key={key}
                            onClick={() => setAudioSource(key)}
                            aria-pressed={on}
                            className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 font-sans text-[12px] font-medium transition-colors ${
                              on
                                ? "border-fuchsia bg-fuchsia text-white"
                                : "border-line bg-paper text-text-secondary hover:border-fuchsia hover:text-ink"
                            }`}
                          >
                            <Icon size={13} strokeWidth={2.2} />
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <label className="block">
                    <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                      <span>Reaction starts at {brollOffset.toFixed(1)}s</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setBrollOffset(0)}
                          className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary hover:text-fuchsia"
                        >
                          start at beginning
                        </button>
                        <span className="text-text-tertiary/40">·</span>
                        <button
                          type="button"
                          onClick={() => setBrollOffset(clip.overlay?.start_offset_s ?? 0)}
                          className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary hover:text-fuchsia"
                        >
                          reset
                        </button>
                      </div>
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

                  {/* Auto-save state chip — micro-confirms that the value the
                      clipper just dragged actually landed in project.json. */}
                  {(overlaySaveState !== "idle" || overlaySaveError) && (
                    <div
                      aria-live="polite"
                      className="flex items-center justify-end font-mono text-[10px] uppercase tracking-[0.12em]"
                    >
                      {overlaySaveError ? (
                        <span className="text-[#DC2626]">
                          save failed — try a layout tile to retry
                        </span>
                      ) : overlaySaveState === "saving" ? (
                        <span className="text-text-tertiary">saving…</span>
                      ) : (
                        <span className="text-fuchsia">{overlaySaveLabel || "saved"}</span>
                      )}
                    </div>
                  )}
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
