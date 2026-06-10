import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
// v0.7.45 — `openSmart` replaces direct shell.open: the "Reveal in Finder"
// + "Play in default app" buttons feed `/Users/...` paths that fail
// shell.open's mailto/tel/https regex. The opener plugin handles them.
import { openSmart as openExternal } from "../lib/openSmart";
import {
  Captions as CaptionsIcon,
  Calendar,
  Send,
  FolderOpen,
  Download,
} from "lucide-react";
import type { Clip, Project, RatioKey } from "../lib/sidecar";
import { sidecar, RATIOS, humanError } from "../lib/sidecar";
import { PlatformBadgePicker } from "./PlatformBadge";
import { OverlayTemplateGallery } from "./OverlayTemplateGallery";
import { CopyButton } from "./CopyButton";
import { InfoTip } from "./InfoTip";
import { type LayoutKey } from "./clips-feed/LayoutIcon";
import { ReactionControls } from "./clips-feed/ReactionControls";
import { LAYOUT_TOPOLOGY } from "./clips-feed/layout-cells";
import { BountyFitChecklist } from "./earn/bounty-fit";
import { CaptionDrawer, CaptionOverlay } from "./captions/CaptionDrawer";
import { CAPTION_STYLES, type CaptionStyleKey } from "../lib/caption-styles";
import { ConfirmDialog } from "./ConfirmDialog";

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
  onPublish,
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
  /** Bottom-row Publish button. Parent (ResultsGrid) opens its PublishModal
   * pre-selected to this clip. Optional so unit-tests and other mounts can
   * skip the wiring without breaking. */
  onPublish?: (clipIdx: number) => void;
  /** Open the Captions drawer on mount. Set when the user clicks the
   * captions chip on a ResultsGrid card. */
  initialCaptionsOpen?: boolean;
}) {
  // v0.7.5: ClipPreview is MODAL-ONLY. The former "window" mode lived inside
  // every workbench tile and dumped a 1180-px-wide editor inside a 240-px
  // square — that surface now lives in `workbench/ClipEditDrawer.tsx`.
  // See docs/UI_MAP_workbench.md (Cut list: "ClipPreview header in window mode").
  const [ratio, setRatio] = useState<RatioKey>("vertical");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // ship-lens v0.7.13 F4 (T1.7) — surface <video> errors so corrupt /
  // 0-byte / iCloud-placeholder files don't render as a silent black square.
  const [videoError, setVideoError] = useState<string | null>(null);
  const [trimOpen, setTrimOpen] = useState(false);
  // Branded confirm primitive replaces native confirm() — the old one
  // blocked the Tauri webview thread + broke brand voice on every remove.
  const [confirmRemove, setConfirmRemove] = useState(false);
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
  // v0.7.25 — brollOffset, audioSource, overlaySaveState/Error/Label all
  // live inside ReactionControls now (single source of truth, two surfaces).

  // Bottom-row action state. Schedule popover, save-copy progress, and a
  // local toast that surfaces success/error for any of these actions without
  // leaving the editor (per lens audit: don't strand the user mid-action).
  // Mutually exclusive with the parent's PublishModal — when the parent opens
  // publish, this popover is closed via the schedule button's own onClick.
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [customSchedule, setCustomSchedule] = useState<string>("");
  const [saveCopyBusy, setSaveCopyBusy] = useState(false);
  const [bottomToast, setBottomToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  // v0.7.14 — OverlayTemplateGallery mount. Opens a popover with the 8
  // pre-made reaction layouts; selecting one calls apply_overlay_template on
  // the sidecar so the clip's overlay_template field is persisted.
  const [overlayTplOpen, setOverlayTplOpen] = useState(false);
  const [overlayTplBusy, setOverlayTplBusy] = useState(false);

  // Cancellation token. Every async sidecar handler captures this generation
  // before await and bails on the resolution if the clip context has rolled
  // forward. Without this, a slow save on clip A can resolve after the user
  // has moved to clip B and overwrite B's project snapshot (or pollute B's
  // error/busy UI). The effect below bumps it whenever the rendered clip
  // identity or position changes.
  const rpcGenRef = useRef(0);

  useEffect(() => {
    rpcGenRef.current += 1;
    setTrimStart(clip.start);
    setTrimEnd(clip.end);
    setActionError(null);
    setTitleDraft(clip.title);
    setDescDraft(clip.description);
    setPinDraft(clip.pinned_comment ?? "");
    setSaveState("idle");
    setScheduleOpen(false);
    setCustomSchedule("");
    setBottomToast(null);
  }, [clip.start, clip.end, clip.title, clip.description, clip.pinned_comment, clip.overlay?.start_offset_s, clip.overlay?.audio_source, index]);


  const isDirty =
    titleDraft !== clip.title ||
    descDraft !== clip.description ||
    pinDraft !== (clip.pinned_comment ?? "");

  // v0.7.34 — Beta users typed a title, pressed Esc, lost it silently.
  // Guard every "soft" close (Esc + X button) with a native confirm when
  // there are unsaved metadata drafts. The hard closes (post-remove,
  // explicit save-then-close) bypass this on purpose because there is
  // nothing left to lose. Native confirm is intentional: it's ugly but
  // it blocks the close synchronously, which a toast bus can't.
  function tryClose() {
    if (isDirty) {
      const proceed = window.confirm(
        "You have unsaved title / description / pinned-comment changes. Discard them?",
      );
      if (!proceed) return;
    }
    onClose();
  }

  async function saveMeta() {
    if (!isDirty || busy) return;
    const gen = rpcGenRef.current;
    setBusy(true);
    setActionError(null);
    setSaveState("saving");
    try {
      const r = await sidecar.updateClipMeta(slug, index - 1, {
        title: titleDraft,
        description: descDraft,
        pinned_comment: pinDraft,
      });
      if (gen !== rpcGenRef.current) return;
      onProjectChange(r.project);
      setSaveState("saved");
      window.setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1800);
    } catch (e) {
      if (gen !== rpcGenRef.current) return;
      setActionError(humanError(e));
      setSaveState("idle");
    } finally {
      if (gen === rpcGenRef.current) setBusy(false);
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

  // v0.7.25 — Auto-persist of audio + offset moved into ReactionControls.
  // The component owns the debounced applyOverlay write whether mounted in
  // the cockpit (compact) or here (full studio).

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
        // v0.7.34 — Inline the dirty guard rather than calling tryClose()
        // so the keydown effect's deps stay closure-stable (tryClose is a
        // fresh function each render and would churn the listener).
        if (isDirty) {
          const proceed = window.confirm(
            "You have unsaved title / description / pinned-comment changes. Discard them?",
          );
          if (!proceed) return;
        }
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
  }, [onClose, onNavigate, index, totalClips, captionsOpen, isDirty]);

  // v0.7.25 — applyLayout owned by ReactionControls (the shared per-clip
  // writer for clip.overlay). ClipPreview no longer needs its own copy.

  // v0.7.14 — Persist the picked overlay template via apply_overlay_template.
  // Sidecar accepts a null source_path so the user can park a template choice
  // before they pick a reaction clip; the next reaction-source selection then
  // applies it for real. Refresh project state so clip.overlay_template flips
  // immediately and the gallery's "selected" highlight updates.
  async function applyOverlayTemplateKey(key: import("../lib/sidecar").OverlayTemplateKey) {
    if (overlayTplBusy) return;
    const gen = rpcGenRef.current;
    setOverlayTplBusy(true);
    setActionError(null);
    try {
      const r = await sidecar.applyOverlayTemplate(slug, index - 1, key);
      if (gen !== rpcGenRef.current) return;
      onProjectChange(r.project);
      setOverlayTplOpen(false);
    } catch (e) {
      if (gen !== rpcGenRef.current) return;
      setActionError(humanError(e));
    } finally {
      if (gen === rpcGenRef.current) setOverlayTplBusy(false);
    }
  }

  async function regenerate() {
    const maxStart = Math.max(0, videoDuration - 1);
    const start = Math.min(Math.max(0, trimStart), maxStart);
    const end = Math.min(Math.max(start + 1, trimEnd), videoDuration);
    if (end - start < 30 || end - start > 75) {
      setActionError("Clip must be 30–75 seconds.");
      return;
    }
    const gen = rpcGenRef.current;
    setBusy(true);
    setActionError(null);
    try {
      const r = await sidecar.regenerateClip(slug, index - 1, start, end);
      if (gen !== rpcGenRef.current) return;
      onProjectChange(r.project);
      setTrimOpen(false);
    } catch (e) {
      if (gen !== rpcGenRef.current) return;
      setActionError(humanError(e));
    } finally {
      if (gen === rpcGenRef.current) setBusy(false);
    }
  }

  function remove() {
    setConfirmRemove(true);
  }

  async function performRemove() {
    const gen = rpcGenRef.current;
    setBusy(true);
    try {
      const r = await sidecar.removeClip(slug, index - 1);
      if (gen !== rpcGenRef.current) return;
      onProjectChange(r.project);
      setConfirmRemove(false);
      onClose();
    } catch (e) {
      if (gen !== rpcGenRef.current) return;
      setActionError(humanError(e));
      setBusy(false);
      // Keep the modal open so the user can retry without re-opening it.
    }
  }

  // Bottom-row bus: dismiss the local toast after a beat so it doesn't
  // overstay. Errors stay 5s, success 3s — clipper has time to read either.
  useEffect(() => {
    if (!bottomToast) return;
    const t = window.setTimeout(
      () => setBottomToast(null),
      bottomToast.kind === "err" ? 5000 : 3000,
    );
    return () => window.clearTimeout(t);
  }, [bottomToast]);

  // Publishing + reveal + save-copy all need a finished 9:16 render. Gate the
  // buttons + surface the reason in a tooltip so the disabled state isn't
  // mysterious. cut_path alone won't do — it's the unframed source.
  const canPublish = !!clip.vertical_path;
  const revealPath = clip.vertical_path || clip.cut_path || null;

  async function submitSchedule(whenIso: string) {
    if (!canPublish || !clip.vertical_path) {
      setBottomToast({ kind: "err", msg: "No 9:16 render yet — wait for reframe to finish." });
      return;
    }
    const gen = rpcGenRef.current;
    setScheduleOpen(false);
    try {
      await sidecar.localScheduleAdd([
        {
          project_slug: project.slug,
          clip_idx: index - 1,
          clip_title: clip.title,
          vertical_path: clip.vertical_path,
          // F4 — use the clip's first selected platform instead of hardcoding YouTube.
          // Falls back to youtube for legacy compatibility when no platform is set.
          platform: (clip.platforms?.[0] ?? "youtube") as "youtube" | "tiktok" | "instagram" | "x",
          scheduled_for: whenIso,
          caption: clip.title,
        },
      ]);
      if (gen !== rpcGenRef.current) return;
      setBottomToast({ kind: "ok", msg: "Scheduled — see it in the Upload tab." });
    } catch (e) {
      if (gen !== rpcGenRef.current) return;
      setBottomToast({ kind: "err", msg: `Schedule failed — ${humanError(e)}` });
    }
  }

  function schedulePresetIso(preset: "now" | "1h" | "tomorrow9"): string {
    const now = new Date();
    if (preset === "now") return now.toISOString();
    if (preset === "1h") {
      const d = new Date(now.getTime() + 60 * 60 * 1000);
      return d.toISOString();
    }
    // Tomorrow 9am in the user's local TZ → ISO UTC.
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }

  async function revealInFinder() {
    if (!revealPath) {
      setBottomToast({ kind: "err", msg: "No file on disk yet for this clip." });
      return;
    }
    // Cross-platform "dirname" via string ops — the path is whatever the
    // sidecar emitted (POSIX on macOS, the only target). No node:path in the
    // webview, and importing tauri's path API for one split is overkill.
    const sep = revealPath.includes("\\") ? "\\" : "/";
    const idx = revealPath.lastIndexOf(sep);
    const dir = idx > 0 ? revealPath.slice(0, idx) : revealPath;
    try {
      await openExternal(dir);
    } catch (e) {
      setBottomToast({ kind: "err", msg: `Couldn't open Finder — ${humanError(e)}` });
    }
  }

  async function saveCopyAs() {
    if (saveCopyBusy) return;
    if (!revealPath) {
      setBottomToast({ kind: "err", msg: "No file on disk yet for this clip." });
      return;
    }
    setSaveCopyBusy(true);
    try {
      const [{ save }, { copyFile }] = await Promise.all([
        import("@tauri-apps/plugin-dialog"),
        import("@tauri-apps/plugin-fs"),
      ]);
      // Default filename uses title (sanitised) or falls back to slug. Tauri
      // dialog will append .mp4 if the user types nothing — defaultPath gives
      // them a starting point.
      const baseName = (clip.title || clip.slug || "clip")
        .replace(/[\\/:*?"<>|]+/g, "_")
        .trim()
        .slice(0, 80) || "clip";
      const dest = await save({
        defaultPath: `${baseName}.mp4`,
        filters: [{ name: "Video", extensions: ["mp4"] }],
      });
      if (!dest) {
        // User cancelled the OS dialog — silent return, no toast spam.
        return;
      }
      await copyFile(revealPath, dest);
      setBottomToast({ kind: "ok", msg: "Copy saved." });
    } catch (e) {
      setBottomToast({ kind: "err", msg: `Save failed — ${humanError(e)}` });
    } finally {
      setSaveCopyBusy(false);
    }
  }

  function handlePublishClick() {
    if (!canPublish) {
      setBottomToast({ kind: "err", msg: "Render a 9:16 cut first — publishing needs vertical." });
      return;
    }
    // Mutual exclusion with the schedule popover. Otherwise opening publish
    // leaves an open popover floating in the background once the modal lands.
    setScheduleOpen(false);
    if (onPublish) {
      onPublish(index - 1);
    } else {
      setBottomToast({ kind: "err", msg: "Publish isn't wired in this view yet." });
    }
  }

  const innerCard = (
    <>
      <ConfirmDialog
        open={confirmRemove}
        tone="destructive"
        title="Remove this clip?"
        body={<>Its files on disk go too. This can&apos;t be undone.</>}
        confirmLabel="Remove clip"
        busy={busy}
        onCancel={() => { if (!busy) setConfirmRemove(false); }}
        onConfirm={() => { void performRemove(); }}
      />
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
                className="font-mono text-[10px] tracking-[0.08em] text-[var(--color-danger)]"
                title="getCaptions RPC failed. The MP4 still plays; only the live overlay preview is missing."
              >
                captions overlay unavailable — try Apply again
              </span>
            )}
          </div>
          <button onClick={tryClose}
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
                  {videoError ? (
                    <div className="flex h-full max-h-full max-w-full flex-col items-center justify-center gap-3 bg-ink/95 p-6 text-center">
                      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-fuchsia">
                        can&apos;t play this clip
                      </div>
                      <div className="max-w-[280px] text-[13px] text-paper">
                        {videoError}
                      </div>
                      <div className="text-[11px] text-text-tertiary">
                        File may be corrupt, empty, or still downloading from iCloud.
                      </div>
                    </div>
                  ) : (
                    <video
                      key={videoSrc}
                      ref={videoEl}
                      controls
                      autoPlay
                      loop
                      muted={!!clip.overlay?.music_bed}
                      src={videoSrc}
                      className="max-h-full max-w-full"
                      onError={(e) =>
                        setVideoError(
                          e.currentTarget.error?.message ??
                            "Couldn't decode this video.",
                        )
                      }
                    />
                  )}
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
              {clip.overlay?.source_path && <span className="text-fuchsia">reaction applied</span>}
            </div>
          </div>

          {/* RIGHT: cell editor + metadata */}
          <div className="flex w-full flex-col gap-5 overflow-y-auto p-5 lg:w-[42%]">
            {/* Cell editor */}
            <BountyFitChecklist clip={clip} project={project} />

            {/* v0.7.25 — Reaction Studio uses the shared ReactionControls so
                the modal + cockpit Reaction module emit identical writes.
                #reaction-studio id retained so any external scroll target
                (deep-link, anchor) still resolves. */}
            <section id="reaction-studio" className="scroll-mt-6">
              <ReactionControls
                clip={clip}
                clipIdx={index - 1}
                slug={slug}
                project={project}
                onProjectChange={onProjectChange}
              />
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

              {/* v0.7.14 — OverlayTemplateGallery mount. Sibling sub-section
                  above PlatformBadgePicker. Small "Choose layout" trigger
                  opens the 8-tile gallery in an inline popover; selecting one
                  calls apply_overlay_template on the sidecar and refreshes the
                  project so clip.overlay_template reflects the choice. */}
              <div className="flex flex-col gap-2 pt-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                      Overlay template
                    </span>
                    {clip.overlay_template && (
                      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-fuchsia">
                        {clip.overlay_template.replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setOverlayTplOpen((o) => !o)}
                    disabled={overlayTplBusy}
                    aria-expanded={overlayTplOpen}
                    aria-haspopup="dialog"
                    className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary hover:border-fuchsia hover:text-ink disabled:opacity-50"
                  >
                    {overlayTplOpen ? "Hide layouts" : "Choose layout"}
                  </button>
                </div>
                {overlayTplOpen && (
                  <div className="rounded-xl border border-line bg-paper-warm/30 p-3">
                    <OverlayTemplateGallery
                      selectedId={clip.overlay_template ?? undefined}
                      onSelect={(template) => void applyOverlayTemplateKey(template.key)}
                      onClose={() => setOverlayTplOpen(false)}
                    />
                  </div>
                )}
              </div>

              {/* v0.7.14 — Kimi's PlatformBadgePicker. Selecting platforms
                  here populates `clip.platforms`, which makes the badges
                  light up on ClipCard + ClipWindow. */}
              <div className="flex flex-col gap-2 pt-1">
                <PlatformBadgePicker
                  selected={clip.platforms ?? []}
                  onToggle={async (p) => {
                    const cur = clip.platforms ?? [];
                    const next = cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p];
                    const gen = rpcGenRef.current;
                    try {
                      const r = await sidecar.setClipPlatforms(slug, index - 1, next);
                      if (gen !== rpcGenRef.current) return;
                      onProjectChange(r.project);
                    } catch (e) {
                      if (gen !== rpcGenRef.current) return;
                      setActionError(humanError(e));
                    }
                  }}
                />
              </div>

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

            {actionError && <p className="font-mono text-[12px] text-[var(--color-danger)]">{actionError}</p>}

            {/* Primary action row — schedule + publish on the left (the
                "ship it" beat), reveal + save copy on the right (utility).
                Sits above the legacy Play / Remove row so a clipper can
                ship without closing the editor first. */}
            <div className="mt-auto flex flex-col gap-2 pt-3">
              <div className="flex flex-wrap items-center gap-2">
                {/* Schedule ▾ with quick-pick popover. Disabled until a 9:16
                    render exists — same precondition as publish. */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setScheduleOpen((o) => !o)}
                    disabled={!canPublish}
                    aria-expanded={scheduleOpen}
                    aria-haspopup="menu"
                    title={canPublish ? "Schedule a post reminder" : "Needs a 9:16 render first"}
                    className="inline-flex items-center gap-2 rounded-full bg-fuchsia px-4 py-2 font-sans text-[12px] font-semibold text-white shadow-[0_6px_18px_rgba(255,26,140,0.25)] transition-all hover:bg-fuchsia-bright disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Calendar size={14} strokeWidth={2.2} aria-hidden />
                    Schedule
                    <span aria-hidden className="text-[10px] opacity-80">▾</span>
                  </button>
                  {scheduleOpen && (
                    <div
                      role="menu"
                      aria-label="Schedule presets"
                      className="absolute bottom-full left-0 z-20 mb-2 w-[260px] rounded-xl border border-line bg-paper p-3 shadow-xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                        when
                      </div>
                      <div className="grid grid-cols-1 gap-1.5">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void submitSchedule(schedulePresetIso("now"))}
                          className="rounded-md border border-line bg-paper px-3 py-1.5 text-left font-sans text-[13px] text-ink hover:border-fuchsia hover:bg-fuchsia-soft/20"
                        >
                          Now
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void submitSchedule(schedulePresetIso("1h"))}
                          className="rounded-md border border-line bg-paper px-3 py-1.5 text-left font-sans text-[13px] text-ink hover:border-fuchsia hover:bg-fuchsia-soft/20"
                        >
                          In 1 hour
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void submitSchedule(schedulePresetIso("tomorrow9"))}
                          className="rounded-md border border-line bg-paper px-3 py-1.5 text-left font-sans text-[13px] text-ink hover:border-fuchsia hover:bg-fuchsia-soft/20"
                        >
                          Tomorrow, 9:00am
                        </button>
                      </div>
                      <div className="mt-3 border-t border-line pt-2.5">
                        <label className="block font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                          Pick a time
                        </label>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <input
                            type="datetime-local"
                            value={customSchedule}
                            onChange={(e) => setCustomSchedule(e.target.value)}
                            className="flex-1 rounded-md border border-line bg-paper-warm/40 px-2 py-1.5 font-mono text-[12px] text-ink focus:border-fuchsia focus:outline-none"
                          />
                          <button
                            type="button"
                            disabled={!customSchedule}
                            onClick={() => {
                              if (!customSchedule) return;
                              // datetime-local is a naive local string —
                              // construct a Date so .toISOString shifts it to
                              // UTC, matching the LocalScheduleNew contract.
                              const d = new Date(customSchedule);
                              if (Number.isNaN(d.getTime())) {
                                setBottomToast({ kind: "err", msg: "Pick a valid time." });
                                return;
                              }
                              void submitSchedule(d.toISOString());
                            }}
                            className="rounded-md bg-fuchsia px-3 py-1.5 font-sans text-[12px] font-medium text-white hover:bg-fuchsia-bright disabled:opacity-40"
                          >
                            Set
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setScheduleOpen(false)}
                        className="mt-2 w-full rounded-md border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary hover:border-fuchsia hover:text-ink"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {/* Publish now — delegates to ResultsGrid's PublishModal. */}
                <button
                  type="button"
                  onClick={handlePublishClick}
                  disabled={!canPublish}
                  title={canPublish ? "Open Publish for this clip" : "Needs a 9:16 render first"}
                  className="inline-flex items-center gap-2 rounded-full border border-fuchsia bg-paper px-4 py-2 font-sans text-[12px] font-semibold text-fuchsia transition-all hover:bg-fuchsia-soft/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send size={14} strokeWidth={2.2} aria-hidden />
                  Publish now
                </button>

                {/* Utility actions live on the right. */}
                <button
                  type="button"
                  onClick={() => void revealInFinder()}
                  disabled={!revealPath}
                  title={revealPath ? "Reveal containing folder in Finder" : "No file on disk yet"}
                  className="ml-auto inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3.5 py-2 font-sans text-[12px] font-medium text-text-secondary hover:border-fuchsia hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <FolderOpen size={14} strokeWidth={2.2} aria-hidden />
                  Reveal in Finder
                </button>
                <button
                  type="button"
                  onClick={() => void saveCopyAs()}
                  disabled={!revealPath || saveCopyBusy}
                  title={revealPath ? "Save a copy to another location" : "No file on disk yet"}
                  className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3.5 py-2 font-sans text-[12px] font-medium text-text-secondary hover:border-fuchsia hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Download size={14} strokeWidth={2.2} aria-hidden />
                  {saveCopyBusy ? "Saving…" : "Save copy as…"}
                </button>
              </div>

              {/* Bottom toast — non-blocking, auto-dismissing micro-confirm
                  so the clipper sees outcomes without leaving the editor. */}
              {bottomToast && (
                <div
                  role="status"
                  aria-live="polite"
                  className={`font-mono text-[11px] tracking-[0.04em] ${
                    bottomToast.kind === "err" ? "text-[var(--color-danger)]" : "text-fuchsia"
                  }`}
                >
                  {bottomToast.msg}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button onClick={() => videoPath && void openExternal(videoPath)}
                  disabled={!videoPath}
                  className="rounded-full border border-line bg-paper px-4 py-2 font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary hover:border-fuchsia hover:text-ink disabled:opacity-40">
                  Play in default app
                </button>
                <button onClick={remove} disabled={busy}
                  className="ml-auto rounded-full border border-line bg-paper px-4 py-2 font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary hover:border-[var(--color-danger)] hover:text-[var(--color-danger)] disabled:opacity-40">
                  Remove
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-6" onClick={onClose}>
      {innerCard}
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
