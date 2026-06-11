// ───── IRON GATE IG-005 (v0.7.30) — see desktop/docs/IRON_GATES.md ─────
// SHARED-WRITE component. The single source of truth for clip.overlay.
// Mounted in EXACTLY ONE place at a time (modalOpen suppression in
// BottomCockpit gates the second mount). The pendingFlushRef + empty-deps
// unmount effect handle the dual-mount-during-debounce data loss class.
// Don't mount this in two surfaces concurrently. Don't remove the unmount
// flush. Don't default a layout from a source-only pick.
//
// ───── IRON GATE IG-006 (v0.7.30) — see desktop/docs/IRON_GATES.md ─────
// onBusyChange callback is load-bearing. The cockpit's pending strip
// reads from this signal because the apply_overlay RPC is synchronous
// (sidecar can't write bake_status until ffmpeg finishes). Don't remove
// the wrapped setBusy that fires onBusyChange on every transition.
//
// v0.7.25 — Reaction Studio controls extracted from ClipPreview so the
// BottomCockpit can mount the SAME widget directly on the main clipping
// view (per ship-lens integration phase: one writer for clip.overlay, two
// surfaces consuming). Compact mode strips the playable cell preview so
// the cockpit's vertical budget stays narrow.

import { useEffect, useRef, useState } from "react";
import { AudioLines, Lock, Volume2, VolumeX } from "lucide-react";
import { sidecar, humanError, type Clip, type OverlayType, type Project } from "../../lib/sidecar";
import { useReactionBakeProgress } from "../../lib/useReactionBakeProgress";
import { useTier } from "../../lib/useTier";
import { openAuthPanel } from "../auth/useAuthPanel";
import { pickOverlaySource } from "../OverlaySourcePicker";
import { LAYOUTS, LayoutIcon, type LayoutKey } from "./LayoutIcon";
import { ReactionCellPreview } from "./ReactionCellPreview";

export type ReactionControlsProps = {
  clip: Clip;
  /** 0-based clip index used by sidecar.applyOverlay. */
  clipIdx: number;
  slug: string;
  project: Project;
  onProjectChange: (p: Project) => void;
  /** Compact: cockpit mount. Hides ReactionCellPreview + tightens spacing.
   *  Default false renders the full studio (ClipPreview's right rail). */
  compact?: boolean;
  /** v0.7.30 (IG-006 Bug 3 fix) — Notify parent when the bake is in flight
   *  so the cockpit can mount the teal pending strip during the synchronous
   *  apply_overlay RPC. Without this the strip would never show because
   *  the sidecar can't write bake_status until after ffmpeg finishes. */
  onBusyChange?: (busy: boolean) => void;
};

export function ReactionControls({
  clip,
  clipIdx,
  slug,
  project,
  onProjectChange,
  compact = false,
  onBusyChange,
}: ReactionControlsProps): JSX.Element {
  const layout: LayoutKey = (clip.overlay?.type as LayoutKey) ?? "none";
  const hasSource = !!clip.overlay?.source_path;
  // v0.7.49 — Reaction layouts (Stack / Split / PiP / Circle) are a Solo+
  // moat for monetisation. Free tier sees every tile (concrete preview of
  // what unlocks) but clicking a locked tile opens the upgrade panel
  // instead of firing a bake. "Full" (none) stays free — base state.
  const tier = useTier();
  const isFreeTier = tier.tier === "free";

  // State owned by this component — reset whenever the focused clip changes
  // (clipIdx) or the underlying overlay shape mutates externally.
  const [busy, _setBusyInternal] = useState(false);
  // v0.7.30 — wrap setBusy so every transition fires onBusyChange. This is
  // load-bearing: the cockpit's pending strip reads from this signal.
  const setBusy = (next: boolean | ((prev: boolean) => boolean)) => {
    _setBusyInternal((prev) => {
      const resolved = typeof next === "function" ? (next as (p: boolean) => boolean)(prev) : next;
      if (onBusyChange) onBusyChange(resolved);
      return resolved;
    });
  };
  // v0.7.48 — Optimistic-active layout tile.
  //
  // Smoothness fix: before this, tapping a layout tile dimmed the entire
  // strip (`disabled={busy}` + `disabled:opacity-50`) for the full 5-30s
  // ffmpeg bake, then the new tile flipped fuchsia only AFTER the RPC
  // returned. The dim-then-eventually-light pattern reads as "I clicked
  // nothing happened" — the most common clunky-feel complaint.
  //
  // pendingLayout = the layout the user JUST tapped, held until the bake
  // resolves (success or failure). The render compares `(pendingLayout
  // ?? layout) === item.key` so the tapped tile instantly looks active,
  // even while busy. Cleared in applyLayout's finally + on cancel from
  // the source picker + on clip switch (the cockpit reuses this mount
  // across clipIdx changes, so a stale pendingLayout would survive).
  const [pendingLayout, setPendingLayout] = useState<LayoutKey | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [brollOffset, setBrollOffset] = useState(clip.overlay?.start_offset_s ?? 0);
  const [audioSource, setAudioSource] = useState<"main" | "broll" | "muted">(
    clip.overlay?.audio_source ?? "main",
  );
  const [overlaySaveState, setOverlaySaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [overlaySaveError, setOverlaySaveError] = useState<string | null>(null);
  const [overlaySaveLabel, setOverlaySaveLabel] = useState<string>("");
  const { progress: bakeProgress, start: startBakeProgress, stop: stopBakeProgress } =
    useReactionBakeProgress();

  // Re-sync local controls when the focused clip switches under us — the
  // cockpit mount swaps clipIdx without unmounting; without this sync the
  // sliders would keep the previous clip's values.
  useEffect(() => {
    setBrollOffset(clip.overlay?.start_offset_s ?? 0);
    setAudioSource(clip.overlay?.audio_source ?? "main");
    setActionError(null);
    setOverlaySaveState("idle");
    setOverlaySaveError(null);
    setOverlaySaveLabel("");
    // v0.7.48 — Clear optimistic pendingLayout on clip switch. The cockpit
    // mount reuses this instance across clipIdx changes; a stale tap on
    // clip A would otherwise paint a wrong tile fuchsia on clip B for the
    // remainder of clip B's session.
    setPendingLayout(null);
  }, [clipIdx, clip.overlay?.source_path, clip.overlay?.type]);

  // Auto-persist audio + offset edits (mirrors the prior ClipPreview effect).
  // Only runs when an overlay with a source already exists — applyOverlay
  // requires source_path.
  //
  // user-journey-lens fix: pendingFlushRef tracks the latest dirty state so
  // we can fire a best-effort save on UNMOUNT (not on every dep change).
  // Without this, user drags the slider then clicks "Open captions ▸"
  // within 400ms → cleanup cancels the timer → the dragged value is gone.
  type PendingFlush = {
    slug: string;
    clipIdx: number;
    type: string;
    sourcePath: string;
    offset: number;
    audio: "main" | "broll" | "muted";
  } | null;
  const pendingFlushRef = useRef<PendingFlush>(null);
  useEffect(() => {
    const overlay = clip.overlay;
    if (!overlay || !overlay.source_path) {
      pendingFlushRef.current = null;
      return;
    }
    const audioDiverges = audioSource !== (overlay.audio_source ?? "main");
    const offsetDiverges = Math.abs(brollOffset - (overlay.start_offset_s ?? 0)) > 1e-6;
    if (!audioDiverges && !offsetDiverges) {
      pendingFlushRef.current = null;
      return;
    }
    pendingFlushRef.current = {
      slug,
      clipIdx,
      type: overlay.type,
      sourcePath: overlay.source_path,
      offset: brollOffset,
      audio: audioSource,
    };
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
      // v0.7.45 — debounced audio/offset edits also trigger a real ffmpeg
      // bake. Without progress wrapping, the user drags the slider and
      // sees "saving…" with no actual progress feedback for the 5-30s
      // ffmpeg pass — looks like a hang. Mirror applyLayout's pattern.
      await startBakeProgress();
      try {
        const r = await sidecar.applyOverlay(slug, clipIdx, {
          type: overlay.type,
          source_path: overlay.source_path,
          start_offset_s: brollOffset,
          audio_source: audioSource,
        });
        if (cancelled) return;
        onProjectChange(r.project);
        pendingFlushRef.current = null;
        setOverlaySaveState("saved");
        window.setTimeout(() => {
          setOverlaySaveState((s) => (s === "saved" ? "idle" : s));
        }, 1500);
      } catch (e) {
        if (cancelled) return;
        setOverlaySaveError(humanError(e));
        setOverlaySaveState("idle");
      } finally {
        stopBakeProgress();
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioSource, brollOffset, slug, clipIdx, clip.overlay]);

  // user-journey-lens fix: unmount-only flush of any pending dirty state.
  // Fires fire-and-forget so unmount-during-debounce can't silently drop a
  // drag. Empty deps → cleanup runs exactly once, on unmount.
  useEffect(() => {
    return () => {
      const p = pendingFlushRef.current;
      if (!p) return;
      void sidecar
        .applyOverlay(p.slug, p.clipIdx, {
          type: p.type as never,
          source_path: p.sourcePath,
          start_offset_s: p.offset,
          audio_source: p.audio,
        })
        .then((r) => onProjectChange(r.project))
        .catch(() => {
          // Best-effort: the user already navigated away. The next mount
          // will re-read the (now-stale-from-this-edit) clip.overlay.
        });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyLayout(kind: LayoutKey, opts?: { forcePick?: boolean }) {
    if (busy) return;
    // v0.7.48 — Optimistic-active: paint the tapped tile fuchsia immediately
    // so the user gets instant visual feedback during the 5-30s bake. Cleared
    // in finally (success + error) and on picker cancel below.
    setPendingLayout(kind);
    setBusy(true);
    setActionError(null);
    await startBakeProgress();
    try {
      if (kind === "none") {
        const r = await sidecar.applyOverlay(slug, clipIdx, null);
        onProjectChange(r.project);
      } else {
        const existing = clip.overlay?.source_path;
        let source: string | undefined = existing;
        if (opts?.forcePick || !source) {
          const pick = await pickOverlaySource({ project, excludeIdx: clipIdx });
          if (pick.kind === "cancel") {
            stopBakeProgress();
            setPendingLayout(null);
            setBusy(false);
            return;
          }
          source = pick.path;
        }
        const r = await sidecar.applyOverlay(slug, clipIdx, {
          type: kind as OverlayType,
          source_path: source,
          start_offset_s: brollOffset,
          audio_source: audioSource,
        });
        onProjectChange(r.project);
      }
    } catch (e) {
      setActionError(humanError(e));
    } finally {
      stopBakeProgress();
      setBusy(false);
      setPendingLayout(null);
    }
  }

  // Public API: cockpit calls this when a layout tile is clicked.
  // Exposed via parent — see useImperativeHandle alternative; we use a
  // simpler ref-less pattern by passing the bake call back through props
  // is unnecessary because Frame module mounts its own tiles. ReactionControls
  // owns the source + audio + offset + per-clip layout tiles in both modes.

  const tileGridCols = compact ? "grid-cols-4" : "grid-cols-3 sm:grid-cols-4";

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {/* Layout strip */}
      <div
        className={
          compact
            ? "rounded-xl border border-fuchsia-soft bg-fuchsia-soft/15 p-2.5"
            : "rounded-2xl border border-fuchsia-soft bg-fuchsia-soft/15 p-4"
        }
      >
        {!compact && (
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
        )}

        <div className={`${compact ? "mt-0" : "mt-3"} grid ${tileGridCols} gap-1.5`}>
          {LAYOUTS.map((item) => {
            // v0.7.48 — Optimistic-active. While a bake is in flight,
            // pendingLayout wins so the tapped tile lights up immediately.
            // Falls back to the committed `layout` from clip.overlay once
            // the RPC resolves (and pendingLayout is cleared in finally).
            const active = (pendingLayout ?? layout) === item.key;
            // v0.7.49 — Solo+ moat on every reaction layout. "Full" (none)
            // stays free as the no-overlay base state. Free tier sees the
            // tile + concrete preview but clicking opens the upgrade panel.
            const isLocked = isFreeTier && item.key !== "none";
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  if (isLocked) {
                    openAuthPanel("upgrade");
                    return;
                  }
                  void applyLayout(item.key);
                }}
                disabled={busy && !isLocked}
                title={isLocked ? `${item.label} — unlocks at Solo` : item.label}
                aria-pressed={active}
                className={`relative flex ${
                  compact ? "min-h-[44px]" : "min-h-[58px]"
                } flex-col items-center justify-center gap-1 rounded-lg border px-1.5 py-2 transition-all ${
                  isLocked
                    ? "border-fuchsia-soft bg-fuchsia-soft/15 text-fuchsia-deep hover:border-fuchsia hover:bg-fuchsia-soft/30"
                    : active
                    ? "border-fuchsia bg-fuchsia text-white shadow-[var(--glow-sm)]"
                    : "border-line bg-paper text-ink hover:border-fuchsia hover:bg-fuchsia-soft/20"
                } disabled:opacity-50`}
              >
                {isLocked && (
                  <Lock
                    className="absolute right-1 top-1 h-2.5 w-2.5 text-fuchsia"
                    strokeWidth={2.4}
                    aria-hidden
                  />
                )}
                <LayoutIcon kind={item.key} />
                <span
                  className={`text-center font-sans ${
                    compact ? "text-[9px]" : "text-[10px]"
                  } font-medium leading-tight`}
                >
                  {compact ? (item.short ?? item.label) : item.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* v0.7.32 — Reaction bake progress bar. Mirrors lift-transcript
            pattern: the sidecar emits ratio-level pct via stdout → Tauri
            event while ffmpeg runs. */}
        {bakeProgress && bakeProgress.stage !== "done" && (
          <div className="mt-2 space-y-1">
            <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.12em] text-text-tertiary">
              <span>
                {bakeProgress.stage === "starting"
                  ? "Starting bake…"
                  : bakeProgress.ratio
                  ? `Baking ${bakeProgress.ratio}…`
                  : "Baking…"}
              </span>
              <span>{bakeProgress.pct}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper">
              <div
                className="h-full rounded-full bg-fuchsia transition-all duration-300"
                style={{ width: `${bakeProgress.pct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Playable preview — only in full mode (ClipPreview right rail). */}
      {!compact && (
        <ReactionCellPreview
          kind={layout}
          mainPath={clip.vertical_path || clip.cut_path || null}
          mainTitle={clip.title}
          reactionPath={clip.overlay?.source_path ?? null}
          audioSource={audioSource}
          busy={busy}
          onPick={() =>
            void applyLayout(layout === "none" ? "stack-bottom" : layout, { forcePick: true })
          }
          onRemove={() => void applyLayout("none")}
          onApply={() => void applyLayout(layout)}
        />
      )}

      {/* Compact-mode source row. user-journey-lens fix: "Pick ▸" with no
          layout set used to silently commit stack-bottom. Now the picker
          opens with NO default layout — the user picks a tile above
          themselves to commit composition. When a layout IS already set,
          "Change" re-runs the picker against that layout (no surprise). */}
      {compact && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-paper-warm px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
          <span className="truncate">
            {hasSource
              ? `src: ${(clip.overlay?.source_path ?? "").split("/").pop()}`
              : layout === "none"
              ? "pick a layout above, then a source"
              : "no reaction source yet"}
          </span>
          <button
            type="button"
            onClick={() => {
              // Only fire the picker when a layout is set. When layout is
              // "none" the button is a non-action — explicit consent for
              // composition has to come from a tile click.
              if (layout === "none") return;
              void applyLayout(layout, { forcePick: true });
            }}
            disabled={busy || layout === "none"}
            title={
              layout === "none"
                ? "Pick a layout tile first, then choose a source"
                : hasSource
                ? "Replace the current reaction source"
                : "Pick a reaction source for this layout"
            }
            className="shrink-0 rounded-full border border-fuchsia/40 bg-fuchsia-soft/20 px-2 py-0.5 font-display text-[10px] font-semibold text-fuchsia hover:bg-fuchsia-soft/30 disabled:opacity-40"
          >
            {hasSource ? "Change" : "Pick ▸"}
          </button>
        </div>
      )}

      {/* Audio + offset — only when a layout is set */}
      {layout !== "none" && (
        <div
          className={
            compact
              ? "space-y-2 rounded-lg border border-line bg-paper p-2.5"
              : "space-y-3 rounded-xl border border-line bg-paper p-3.5"
          }
        >
          <div>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              audio
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  ["main", "Main", Volume2],
                  ["broll", "Reaction", AudioLines],
                  ["muted", "Muted", VolumeX],
                ] as const
              ).map(([key, label, Icon]) => {
                const on = audioSource === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAudioSource(key)}
                    aria-pressed={on}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-lg border ${
                      compact ? "px-2 py-1" : "px-3 py-2"
                    } font-sans ${compact ? "text-[11px]" : "text-[12px]"} font-medium transition-colors ${
                      on
                        ? "border-fuchsia bg-fuchsia text-white"
                        : "border-line bg-paper text-text-secondary hover:border-fuchsia hover:text-ink"
                    }`}
                  >
                    <Icon size={compact ? 12 : 13} strokeWidth={2.2} />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block">
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              <span>Reaction starts at {brollOffset.toFixed(1)}s</span>
              {!compact && (
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
              )}
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

          {(overlaySaveState !== "idle" || overlaySaveError) && (
            <div
              aria-live="polite"
              className="flex items-center justify-end font-mono text-[10px] uppercase tracking-[0.12em]"
            >
              {overlaySaveError ? (
                <span className="text-[var(--color-danger)]">save failed — try a layout tile to retry</span>
              ) : overlaySaveState === "saving" ? (
                <span className="text-text-tertiary">saving…</span>
              ) : (
                <span className="text-fuchsia">{overlaySaveLabel || "saved"}</span>
              )}
            </div>
          )}
        </div>
      )}

      {actionError && (
        <p
          role="alert"
          className={`rounded-md border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 ${
            compact ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-[11px]"
          } font-mono uppercase tracking-[0.08em] text-[var(--color-danger)]`}
        >
          {actionError}
        </p>
      )}
    </div>
  );
}
