// ───── IRON GATE IG-005 (v0.7.30) — see desktop/docs/IRON_GATES.md ─────
// Workspace UI design v7: dashed-corner panel shell, single-row status,
// inline Caption, ReactionControls as the panel body, side-column CTA.
// Collapses to a 54px row via `\` chord (persisted to useLocalPref).
// `modalOpen` prop is still load-bearing: when true the Reaction module
// becomes a tombstone so ReactionControls mounts in exactly ONE place.
// Plain card click = focus; shift/cmd = multi-select; focus follows every
// click. Caption pin onBlur fans out via updateClipMeta(pinned_comment).
// Don't reintroduce per-card schedulers, per-card layout pickers, the old
// 5-module row, ClipsBulkToolbar, or display-style tile headlines.
//
// ───── IRON GATE IG-006 (v0.7.30) — see desktop/docs/IRON_GATES.md ─────
// Handoff contract + bake-state contract. See desktop/docs/cockpit-handoffs.md.
// Per-action ownership: OWN / DELEGATE / WATCH / AVOID.
//   OWN     — layout, audio, offset, schedule whenKey, caption pin draft,
//             Master CTA (publish/schedule), focus prev/next.
//   DELEGATE — Caption Edit → CaptionDrawer (onOpenCaptions),
//              Source Change → pickOverlaySource (inside ReactionControls),
//              Publish/Schedule popover empty state → onConnectChannels →
//                Settings → Connections (DON'T inline channel CRUD here),
//              Routes alt → schedule popover, ⋮ menu items → modals/routes.
//   WATCH   — clip.overlay.bake_status (server writes "error" on ffmpeg
//             fail; pending phase is client-side via reactionBakingAt
//             because applyOverlay is a synchronous RPC), channel health,
//             project counters.
// Don't reintroduce the legacy "TAKE ACTION · Drip across · Publish now ·
// Schedule one" header above the cards (integration-lens violation: that
// duplicated cockpit Publish/Schedule).

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronUp,
  Flame,
  Loader2,
  MoreVertical,
  Send,
  SkipBack,
  SkipForward,
  X,
  Zap,
} from "lucide-react";
import { humanError, sidecar, type Project } from "../../lib/sidecar";
import {
  CAPTION_STYLES,
  CAPTION_STYLE_KEYS,
  type CaptionStyleKey,
} from "../../lib/caption-styles";
import { listChannels, type Channel } from "../../lib/backend";
import { LAYOUTS, type LayoutKey } from "../clips-feed/LayoutIcon";
import { ReactionControls } from "../clips-feed/ReactionControls";
import {
  publishClipsNow,
  scheduleClips,
  summarize,
  type ClipActionResult,
  type ScheduleWhen,
} from "../clips-feed/masterClipActions";
import { useLocalPref } from "../../lib/useLocalPref";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Props = {
  selectedIdxs: number[];
  focusedIdx: number;
  project: Project;
  onProjectChange: (p: Project) => void;
  onClear: () => void;
  onChangeFocus: (idx: number) => void;
  onOpenSettings?: () => void;
  onOpenEditor?: (clipIdx: number, scrollTo?: "reaction" | "captions") => void;
  onOpenCaptions?: (clipIdx: number) => void;
  modalOpen?: boolean;
};

type Popover =
  | { kind: "none" }
  | { kind: "schedule" }
  | { kind: "publish" }
  | { kind: "caption-style" };

type WhenKey = "now" | "+1h" | "+24h" | "custom";

export function BottomCockpit({
  selectedIdxs,
  focusedIdx,
  project,
  onProjectChange,
  onClear,
  onChangeFocus,
  onOpenSettings,
  onOpenEditor,
  onOpenCaptions,
  modalOpen = false,
}: Props): JSX.Element {
  const [popover, setPopover] = useState<Popover>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  // v0.7.30 (IG-006 Bug 3 fix) — Reaction bake in flight (client-side).
  // Synchronous RPC means the sidecar can't write bake_status until after
  // ffmpeg finishes. We mirror the local busy from ReactionControls so the
  // teal pending strip mounts during the await. `reactionBakingAt` records
  // when the bake started (for the elapsed timer).
  const [reactionBakingAt, setReactionBakingAt] = useState<string | null>(null);
  const [whenKey, setWhenKey] = useState<WhenKey>("now");
  const [captionDrafts, setCaptionDrafts] = useState<Record<number, string>>({});
  // v0.7.29 — collapsed cockpit state, persisted so the user's preference
  // survives reloads. Toggle via the `\` chord or the chevron in the status
  // strip. Auto-collapse on bake start is intentional; auto-expand on bake
  // error so the user sees the message inline.
  const [collapsed, setCollapsed] = useLocalPref<boolean>("lc:cockpit_collapsed", false);

  // Target resolution: multi-select wins, otherwise focused clip.
  const hasClips = project.clips.length > 0;
  const isBulkMode = selectedIdxs.length >= 1;
  const safeFocusedIdx = Math.max(0, Math.min(focusedIdx, Math.max(0, project.clips.length - 1)));
  const focusedClip = hasClips ? project.clips[safeFocusedIdx] : undefined;
  const effectiveIdxs = !hasClips ? [] : isBulkMode ? selectedIdxs : [safeFocusedIdx];
  const selectionSize = effectiveIdxs.length;

  // Derived state: layout, bake status, etc.
  const activeLayout: LayoutKey | "mixed" = useMemo(() => {
    const targets = effectiveIdxs.map((i) => project.clips[i]).filter(Boolean);
    if (targets.length === 0) return "none";
    const s = new Set(targets.map((c) => (c!.overlay?.type ?? "none") as LayoutKey));
    if (s.size > 1) return "mixed";
    return [...s][0] ?? "none";
  }, [effectiveIdxs, project.clips]);

  const activeCaptionStyle: CaptionStyleKey | "mixed" | null = useMemo(() => {
    const targets = effectiveIdxs.map((i) => project.clips[i]).filter(Boolean);
    if (targets.length === 0) return null;
    const s = new Set(targets.map((c) => (c!.caption_style as CaptionStyleKey | undefined) ?? null));
    if (s.size > 1) return "mixed";
    return [...s][0] ?? null;
  }, [effectiveIdxs, project.clips]);

  // Bake state — WATCH-bucket per IG-006. Server-side bake_status only
  // surfaces "error" (the synchronous RPC can't write pending while
  // running). Client-side reactionBakingAt fills the pending phase during
  // the await so the user sees feedback immediately.
  const bakeState = useMemo(() => {
    if (reactionBakingAt) {
      return { phase: "pending" as const, startedAt: reactionBakingAt };
    }
    if (!focusedClip?.overlay) return { phase: "idle" as const };
    const s = focusedClip.overlay.bake_status;
    if (s === "error") return { phase: "error" as const, message: focusedClip.overlay.bake_error };
    return { phase: "idle" as const };
  }, [focusedClip, reactionBakingAt]);

  // Auto-collapse on bake start; auto-expand on bake error.
  useEffect(() => {
    if (bakeState.phase === "error" && collapsed) setCollapsed(false);
  }, [bakeState.phase, collapsed, setCollapsed]);

  // `\` chord toggles collapse. Bail when focus is in an input.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "\\") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      setCollapsed((c) => !c);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCollapsed]);

  // Project whenKey → ScheduleWhen for the popover prefill.
  // v0.7.45 — Memoized so the object reference is stable between renders.
  // Without this, SchedulePopoverInline's useEffect resets internal `when`
  // state on every parent render, clobbering the user's channel/time picks.
  const whenKeyAsScheduleWhen: ScheduleWhen = useMemo(
    () =>
      whenKey === "now"
        ? { kind: "now" }
        : whenKey === "+1h"
        ? { kind: "preset", offsetHours: 1 }
        : whenKey === "+24h"
        ? { kind: "preset", offsetHours: 24 }
        : { kind: "now" },
    [whenKey],
  );

  // Master CTA label morphs based on whenKey.
  const ctaLabel =
    whenKey === "now"
      ? "Publish now"
      : whenKey === "custom"
      ? "Schedule…"
      : `Schedule ${whenKey}`;
  const ctaIsPublish = whenKey === "now";

  // ── Toast plumbing ─────────────────────────────────────────────
  function pushToast(label: string, kind: "success" | "error" = "success") {
    window.dispatchEvent(
      new CustomEvent("lc:toast", { detail: { kind, message: label } }),
    );
  }

  async function runSideEffect(label: string, fn: () => Promise<ClipActionResult>) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await fn();
      pushToast(summarize(label, result, selectionSize), result.failed.length > 0 ? "error" : "success");
      setPopover({ kind: "none" });
    } catch (e) {
      pushToast(`${label} failed — ${humanError(e).slice(0, 120)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  // Channel count derived from focused clip's platforms (single mode) or union (bulk).
  const channelsRouted = useMemo(() => {
    const targets = effectiveIdxs.map((i) => project.clips[i]).filter(Boolean);
    const all = new Set<string>();
    targets.forEach((c) => (c!.platforms ?? []).forEach((p) => all.add(p)));
    return [...all];
  }, [effectiveIdxs, project.clips]);

  // v0.7.45 — Bulk caption consensus: show the common pinned_comment if
  // every selected clip shares it; show empty + "Mixed" placeholder if they
  // differ. Prevents the old bug where the focused clip's caption was silently
  // fanned out across all selected clips.
  const captionConsensus = useMemo(() => {
    if (!isBulkMode || selectionSize <= 1) return null;
    const comments = effectiveIdxs
      .map((i) => project.clips[i]?.pinned_comment)
      .filter((c): c is string => typeof c === "string" && c.length > 0);
    const unique = Array.from(new Set(comments));
    if (unique.length === 1) return unique[0];
    return "";
  }, [isBulkMode, selectionSize, effectiveIdxs, project.clips]);

  const captionDraftValue = useMemo(() => {
    if (captionDrafts[safeFocusedIdx] !== undefined) return captionDrafts[safeFocusedIdx];
    if (captionConsensus !== null) return captionConsensus;
    return focusedClip?.pinned_comment ?? "";
  }, [captionDrafts, safeFocusedIdx, captionConsensus, focusedClip]);

  const isMixedCaption = isBulkMode && selectionSize > 1 && captionConsensus === "";
  const activeCaptionStyleLabel =
    activeCaptionStyle === "mixed"
      ? "MIXED"
      : activeCaptionStyle && CAPTION_STYLES[activeCaptionStyle]
      ? CAPTION_STYLES[activeCaptionStyle]?.label.toUpperCase()
      : null;
  const activeCaptionStylePrimary =
    activeCaptionStyle === "mixed"
      ? "var(--color-cyan-cool)"
      : activeCaptionStyle
      ? CAPTION_STYLES[activeCaptionStyle]?.primary
      : "#ff66b8";

  // ── Render ────────────────────────────────────────────────────
  return createPortal(
    <TooltipProvider delayDuration={200}>
      <div
        role="toolbar"
        aria-label="Cockpit"
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 px-4 pb-3 pt-1 transition-[max-height] duration-200",
        )}
        data-collapsed={collapsed ? "true" : "false"}
      >
        <div className="relative mx-auto max-w-[1280px]">
          {/* dashed corner brackets — the ONLY ornamentation per v7 */}
          <CockpitCorners />

          <div className="relative bg-black border border-line/40 rounded-md overflow-hidden">
            {/* ───── STATUS STRIP ───── */}
            <StatusStrip
              clipIdx={safeFocusedIdx}
              totalClips={project.clips.length}
              hasClips={hasClips}
              isBulkMode={isBulkMode}
              selectionSize={selectionSize}
              collapsed={collapsed}
              onToggleCollapse={() => setCollapsed((c) => !c)}
              focusedClip={focusedClip}
              whenKey={whenKey}
              onPrev={() => onChangeFocus(Math.max(0, safeFocusedIdx - 1))}
              onNext={() => onChangeFocus(Math.min(project.clips.length - 1, safeFocusedIdx + 1))}
              onScheduleClick={() => {
                if (whenKey === "now") setPopover({ kind: "publish" });
                else setPopover({ kind: "schedule" });
              }}
              onClearSelection={onClear}
              onOpenSettings={onOpenSettings}
              onOpenCaptions={onOpenCaptions ? () => onOpenCaptions(safeFocusedIdx) : undefined}
              onOpenEditor={onOpenEditor ? () => onOpenEditor(safeFocusedIdx, "reaction") : undefined}
              project={project}
            />

            {/* Collapsed-mode body: just the inline quick caption + reaction + CTA */}
            {collapsed && (
              <CollapsedBody
                focusedClip={focusedClip}
                hasClips={hasClips}
                activeLayout={activeLayout}
                ctaLabel={ctaLabel}
                ctaIsPublish={ctaIsPublish}
                busy={busy || selectionSize === 0}
                onCtaClick={() => {
                  if (whenKey === "now") setPopover({ kind: "publish" });
                  else setPopover({ kind: "schedule" });
                }}
              />
            )}

            {/* Expanded body */}
            {!collapsed && (
              <div className="grid grid-cols-[1fr_220px] gap-0">
                {/* MAIN COLUMN */}
                <div className="flex flex-col gap-2.5 px-5 py-3 min-w-0">
                  {/* Caption row (inline, with style chip + edit handoff) */}
                  <CaptionRow
                    value={captionDraftValue}
                    isBulkMode={isBulkMode}
                    isMixedCaption={isMixedCaption}
                    hasClips={hasClips}
                    busy={busy}
                    stylePrimary={activeCaptionStylePrimary}
                    styleLabel={activeCaptionStyleLabel}
                    onChange={(v) =>
                      setCaptionDrafts((p) => ({ ...p, [safeFocusedIdx]: v }))
                    }
                    onBlur={async (next) => {
                      if (!hasClips) return;
                      // v0.7.45 — In "Mixed" bulk mode, an empty input means
                      // the user didn't type anything. Don't clear every
                      // selected clip's caption.
                      if (isMixedCaption && next === "") return;
                      let latest = project;
                      for (const idx of effectiveIdxs) {
                        const target = latest.clips[idx];
                        if (!target) continue;
                        if (next === (target.pinned_comment ?? "")) continue;
                        try {
                          const r = await sidecar.updateClipMeta(project.slug, idx, { pinned_comment: next });
                          latest = r.project;
                        } catch (err) {
                          pushToast(`Pin save failed on clip ${idx + 1} — ${humanError(err).slice(0, 120)}`, "error");
                          onProjectChange(latest);
                          return;
                        }
                      }
                      onProjectChange(latest);
                      setCaptionDrafts((prev) => {
                        const out = { ...prev };
                        for (const idx of effectiveIdxs) delete out[idx];
                        return out;
                      });
                    }}
                    onOpenStyle={() => setPopover({ kind: "caption-style" })}
                    onOpenEdit={
                      onOpenCaptions ? () => onOpenCaptions(safeFocusedIdx) : undefined
                    }
                  />

                  {/* Reaction module: either ReactionControls or the tombstone */}
                  {focusedClip ? (
                    modalOpen ? (
                      <ReactionTombstone />
                    ) : (
                      <ReactionControls
                        clip={focusedClip}
                        clipIdx={safeFocusedIdx}
                        slug={project.slug}
                        project={project}
                        onProjectChange={onProjectChange}
                        compact
                        onBusyChange={(b) => {
                          setReactionBakingAt(b ? new Date().toISOString() : null);
                        }}
                      />
                    )
                  ) : (
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                      no clip selected
                    </p>
                  )}
                </div>

                {/* SIDE COLUMN — Deploy module.
                    v0.7.32 restructure per docs/clipcard-v0732-target.html
                    cosmetic pass (Daniel's "arrange buttons inside better"
                    directive). Order top-down: deploy eyebrow → Master title
                    + routed-summary → MasterCta full-width primary → Auto-pilot
                    full-width secondary (was the RoutesAlt small link, same
                    onClick) → WhenChips segmented control (kept, functional)
                    → cyan-pulse hint line (only when no channels routed).
                    IG-005/006 invariants preserved: same single writer, same
                    schedule-popover wiring, no parallel toolbar. */}
                <div className="flex flex-col gap-2 px-4 py-3 pl-0">
                  <div>
                    <div className="font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-fuchsia-deep opacity-90">
                      deploy
                    </div>
                    <div className="mt-0.5 font-display text-[15px] font-semibold tracking-[-0.015em] text-ink">
                      Master
                      <span className="ml-1.5 font-mono text-[10px] font-medium tracking-[0.06em] text-text-tertiary normal-case">
                        · {channelsRouted.length} {channelsRouted.length === 1 ? "channel routed" : "channels routed"}
                      </span>
                    </div>
                  </div>
                  <MasterCta
                    label={ctaLabel}
                    isPublish={ctaIsPublish}
                    disabled={busy || selectionSize === 0}
                    onClick={() => {
                      if (whenKey === "now") setPopover({ kind: "publish" });
                      else setPopover({ kind: "schedule" });
                    }}
                    busy={busy}
                  />
                  <AutopilotAlt
                    disabled={busy || selectionSize === 0}
                    onClick={() => setPopover({ kind: "schedule" })}
                  />
                  <WhenChips
                    value={whenKey}
                    onChange={(k) => {
                      setWhenKey(k);
                      if (k === "custom") setPopover({ kind: "schedule" });
                    }}
                    disabled={busy || selectionSize === 0}
                  />
                  {channelsRouted.length === 0 && selectionSize > 0 && (
                    <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary opacity-80">
                      <span
                        aria-hidden
                        className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-cyan-cool)]"
                        style={{ boxShadow: "0 0 6px var(--color-cyan-cool)" }}
                      />
                      <span>no channels routed yet</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Pending / error strips override the body when active */}
            {bakeState.phase === "pending" && !modalOpen && (
              <BakePendingStrip startedAt={bakeState.startedAt} />
            )}
            {bakeState.phase === "error" && !modalOpen && (() => {
              const bakeErrorMessage = bakeState.message; // allow-raw-error — typed BakeState field
              return (
                <BakeErrorStrip
                  message={bakeErrorMessage}
                  onRetry={() => {
                    pushToast("Retry queued — touch a layout tile to bake again.");
                  }}
                />
              );
            })()}

            {/* Popovers (Schedule/Publish use the same panel) */}
            {popover.kind === "schedule" && (
              <SchedulePopoverInline
                busy={busy}
                initialWhen={whenKeyAsScheduleWhen}
                onConnectChannels={() => {
                  // Route to Schedule → Channels (canonical surface since v0.7.40).
                  // Settings.tsx hears the event and calls onOpenSchedule("channels").
                  window.dispatchEvent(
                    new CustomEvent("lc:settings-open-tab", { detail: { tab: "channels" } }),
                  );
                  if (onOpenSettings) onOpenSettings();
                }}
                onClose={() => setPopover({ kind: "none" })}
                onApply={(channels, when) =>
                  void runSideEffect("Scheduled", () =>
                    scheduleClips(project, effectiveIdxs, when, channels),
                  )
                }
              />
            )}

            {popover.kind === "publish" && (
              <SchedulePopoverInline
                busy={busy}
                forcedNow
                onClose={() => setPopover({ kind: "none" })}
                onApply={(channels) =>
                  void runSideEffect("Published", () =>
                    publishClipsNow(project, effectiveIdxs, channels),
                  )
                }
              />
            )}

            {popover.kind === "caption-style" && (
              <CaptionStylePopover
                activeStyle={activeCaptionStyle}
                onPick={async (k) => {
                  if (!hasClips) return;
                  setBusy(true);
                  try {
                    let latest = project;
                    for (const idx of effectiveIdxs) {
                      try {
                        const r = await sidecar.editCaptions(project.slug, idx, [], k);
                        latest = r.project;
                      } catch (err) {
                        pushToast(`Style failed on clip ${idx + 1} — ${humanError(err)}`, "error");
                      }
                    }
                    onProjectChange(latest);
                    pushToast(`Style applied to ${effectiveIdxs.length} clip(s)`);
                  } finally {
                    setBusy(false);
                    setPopover({ kind: "none" });
                  }
                }}
                onClose={() => setPopover({ kind: "none" })}
              />
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>,
    document.body,
  );
}

// ════════════════════════════════════════════════════════════════════
// Sub-components
// ════════════════════════════════════════════════════════════════════

function CockpitCorners() {
  // Outer-shell dashed brackets. Per Impeccable: only ONE surface ornaments.
  const ringClass =
    "absolute w-[18px] h-[18px] pointer-events-none border-[1.5px] border-dashed border-fuchsia";
  const glow = { filter: "drop-shadow(0 0 8px rgba(255,45,149,0.55))" };
  return (
    <>
      <span aria-hidden className={cn(ringClass, "top-0 left-0 border-r-0 border-b-0")} style={glow} />
      <span aria-hidden className={cn(ringClass, "top-0 right-0 border-l-0 border-b-0")} style={glow} />
      <span aria-hidden className={cn(ringClass, "bottom-0 left-0 border-r-0 border-t-0")} style={glow} />
      <span aria-hidden className={cn(ringClass, "bottom-0 right-0 border-l-0 border-t-0")} style={glow} />
    </>
  );
}

function StatusStrip({
  clipIdx,
  totalClips,
  hasClips,
  isBulkMode,
  selectionSize,
  collapsed,
  onToggleCollapse,
  focusedClip,
  whenKey,
  onPrev,
  onNext,
  onScheduleClick,
  onClearSelection,
  onOpenSettings,
  onOpenCaptions,
  onOpenEditor,
  project,
}: {
  clipIdx: number;
  totalClips: number;
  hasClips: boolean;
  isBulkMode: boolean;
  selectionSize: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  focusedClip: Project["clips"][number] | undefined;
  whenKey: WhenKey;
  onPrev: () => void;
  onNext: () => void;
  onScheduleClick: () => void;
  onClearSelection: () => void;
  onOpenSettings?: () => void;
  onOpenCaptions?: () => void;
  onOpenEditor?: () => void;
  project: Project;
}) {
  const clipLabel = !hasClips
    ? "No clips yet"
    : isBulkMode
    ? `${selectionSize} selected`
    : `CLIP ${(clipIdx + 1).toString().padStart(2, "0")}`;

  const schedLabel =
    whenKey === "now"
      ? "Now"
      : whenKey === "custom"
      ? "Custom"
      : whenKey === "+1h"
      ? "+1h · 14:30"
      : "+24h · tomorrow";

  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-2.5 border-b border-line/40 font-mono text-[10px] uppercase tracking-[0.16em]">
      <span className="text-fuchsia font-semibold">
        {hasClips && !isBulkMode ? (
          <>
            CLIP <b className="text-fuchsia-bright ml-1">{(clipIdx + 1).toString().padStart(2, "0")}</b>
          </>
        ) : (
          clipLabel
        )}
      </span>

      {isBulkMode && (
        <button
          type="button"
          onClick={onClearSelection}
          className="inline-flex items-center gap-1 rounded-sm border border-line/30 px-2 py-0.5 text-text-tertiary hover:border-fuchsia/40 hover:text-fuchsia"
        >
          Clear <X className="h-3 w-3" />
        </button>
      )}

      <FocusNav focusedIdx={clipIdx} total={totalClips} onPrev={onPrev} onNext={onNext} disabled={!hasClips} />

      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-text-tertiary cursor-help">ⓘ all live</span>
        </TooltipTrigger>
        <TooltipContent>sidecar live · render live · ayrshare live</TooltipContent>
      </Tooltip>

      <button
        type="button"
        onClick={onScheduleClick}
        disabled={!hasClips}
        className={cn(
          "ml-auto rounded border px-2.5 py-1 transition-colors",
          whenKey === "now"
            ? "border-amber-400/40 text-amber-300 hover:bg-amber-400/5"
            : "border-fuchsia/30 text-fuchsia-bright hover:bg-fuchsia/5",
        )}
      >
        {whenKey === "now" ? "⚡ " : "↗ "}
        <b className="text-paper ml-1">{schedLabel}</b>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger className="text-text-tertiary hover:text-paper px-1">
          <MoreVertical className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[220px]">
          <DropdownMenuLabel>Per-clip</DropdownMenuLabel>
          {onOpenEditor && (
            <DropdownMenuItem onClick={onOpenEditor}>
              Open full editor
              <DropdownMenuShortcut>↵</DropdownMenuShortcut>
            </DropdownMenuItem>
          )}
          {onOpenCaptions && (
            <DropdownMenuItem onClick={onOpenCaptions}>
              Captions
              <DropdownMenuShortcut>C</DropdownMenuShortcut>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Project</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent("lc:open-brief"))}>
            Brief
            <DropdownMenuShortcut>B</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => window.dispatchEvent(new CustomEvent("lc:go-home"))}
          >
            Add more clips
            <DropdownMenuShortcut>⌘N</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Vanity</DropdownMenuLabel>
          <DropdownMenuItem className="opacity-60 cursor-default">
            RDY {project.clips.filter((c) => c.vertical_path).length} ·{" "}
            QUE 0 · PUB —
          </DropdownMenuItem>
          {focusedClip && (
            <DropdownMenuItem className="opacity-60 cursor-default">
              V{focusedClip.virality ?? 0} score
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Navigation</DropdownMenuLabel>
          {onOpenSettings && (
            <DropdownMenuItem onClick={onOpenSettings}>
              Settings → Connections
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => window.dispatchEvent(new CustomEvent("lc:go-earn"))}
          >
            Earn
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        onClick={onToggleCollapse}
        title={collapsed ? "Expand cockpit · \\" : "Collapse cockpit · \\"}
        className="inline-flex items-center gap-1 rounded border border-line/40 px-2 py-0.5 text-text-tertiary hover:border-line/60 hover:text-paper"
      >
        {collapsed ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        <span className="text-[9px]">{collapsed ? "More" : "Min"}</span>
      </button>
    </div>
  );
}

function FocusNav({
  focusedIdx,
  total,
  disabled,
  onPrev,
  onNext,
}: {
  focusedIdx: number;
  total: number;
  disabled: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-paper">
      <button
        type="button"
        onClick={onPrev}
        disabled={disabled || focusedIdx <= 0}
        aria-label="Previous clip"
        className="text-text-tertiary hover:text-paper disabled:opacity-30"
      >
        <SkipBack className="h-3 w-3" />
      </button>
      <span className="tabular-nums text-[10px] tracking-[0.04em]">
        {total === 0 ? "—" : `${(focusedIdx + 1).toString().padStart(2, "0")} / ${total.toString().padStart(2, "0")}`}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={disabled || focusedIdx >= total - 1}
        aria-label="Next clip"
        className="text-text-tertiary hover:text-paper disabled:opacity-30"
      >
        <SkipForward className="h-3 w-3" />
      </button>
    </span>
  );
}

function CollapsedBody({
  focusedClip,
  hasClips,
  activeLayout,
  ctaLabel,
  ctaIsPublish,
  busy,
  onCtaClick,
}: {
  focusedClip: Project["clips"][number] | undefined;
  hasClips: boolean;
  activeLayout: LayoutKey | "mixed";
  ctaLabel: string;
  ctaIsPublish: boolean;
  busy: boolean;
  onCtaClick: () => void;
}) {
  const caption = focusedClip?.pinned_comment ?? focusedClip?.title ?? "";
  const layoutLabel =
    activeLayout === "mixed"
      ? "MIXED"
      : activeLayout === "none"
      ? "NO LAYOUT"
      : LAYOUTS.find((l) => l.key === activeLayout)?.label.toUpperCase() ?? "FULL";

  if (!hasClips) return null;
  return (
    <div className="flex items-center gap-3 px-5 py-2.5">
      <span className="font-mono text-fuchsia text-base font-medium">"</span>
      <span className="flex-1 text-[13px] font-medium leading-tight truncate text-paper">
        {caption || "no caption yet"}
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-sm border border-fuchsia/30 bg-fuchsia/8 px-2 py-1 font-mono text-[9px] tracking-[0.12em] uppercase text-fuchsia-bright">
        <span className="w-1.5 h-1.5 rounded-full bg-fuchsia shadow-[0_0_6px_rgba(255,45,149,0.7)]" />
        {layoutLabel}
      </span>
      <button
        type="button"
        onClick={onCtaClick}
        disabled={busy}
        className={cn(
          "inline-flex items-center gap-1.5 rounded px-3 py-1.5 font-sans text-[12px] font-semibold transition-colors",
          ctaIsPublish
            ? "bg-gradient-to-b from-amber-300 to-amber-500 text-[#241500] shadow-[0_8px_18px_-8px_rgba(255,176,46,0.7)]"
            : "bg-gradient-to-b from-fuchsia-bright to-fuchsia text-[#190007] shadow-[0_8px_18px_-8px_rgba(255,45,149,0.7)]",
          "disabled:opacity-40 disabled:shadow-none",
        )}
      >
        {ctaIsPublish ? <Zap className="h-3 w-3" /> : <Send className="h-3 w-3" />}
        {ctaLabel}
      </button>
    </div>
  );
}

function CaptionRow({
  value,
  isBulkMode,
  isMixedCaption,
  hasClips,
  busy,
  stylePrimary,
  styleLabel,
  onChange,
  onBlur,
  onOpenStyle,
  onOpenEdit,
}: {
  value: string;
  isBulkMode: boolean;
  isMixedCaption?: boolean;
  hasClips: boolean;
  busy: boolean;
  stylePrimary?: string;
  styleLabel?: string | null;
  onChange: (v: string) => void;
  onBlur: (v: string) => void;
  onOpenStyle: () => void;
  onOpenEdit?: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      <span className="font-mono text-fuchsia text-[16px] font-medium leading-none">"</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onBlur(e.target.value)}
        placeholder={
          isBulkMode
            ? isMixedCaption
              ? "Mixed — type to apply to all selected"
              : "Pin caption (applies to all selected)"
            : "pin a caption…"
        }
        disabled={busy || !hasClips}
        className="flex-1 min-w-0 bg-transparent border-0 text-[14px] font-medium tracking-[-0.01em] text-paper placeholder:text-text-tertiary placeholder:italic focus:outline-none disabled:opacity-40"
      />
      <button
        type="button"
        onClick={onOpenStyle}
        disabled={busy || !hasClips}
        className="inline-flex items-center gap-1.5 rounded border border-fuchsia/28 bg-fuchsia/8 px-2 py-1 font-mono text-[9px] tracking-[0.12em] uppercase text-fuchsia-bright disabled:opacity-40"
      >
        <span className="w-2 h-2 rounded-sm" style={{ background: stylePrimary }} />
        {styleLabel ?? "STYLE"}
      </button>
      {onOpenEdit && (
        <button
          type="button"
          onClick={onOpenEdit}
          disabled={busy || !hasClips}
          className="font-mono text-[9px] tracking-[0.1em] uppercase text-text-tertiary border border-line/40 rounded px-2 py-1 hover:text-paper hover:border-line/60 disabled:opacity-40"
        >
          <Flame className="h-3 w-3 inline mr-1" />
          Edit
        </button>
      )}
    </div>
  );
}

function ReactionTombstone() {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed border-fuchsia/40 bg-fuchsia/4 py-5 text-center">
      <span className="font-mono text-[11px] tracking-[0.16em] uppercase text-fuchsia-bright">
        ⤢ Editor open
      </span>
      <span className="font-mono text-[10px] text-text-secondary">
        Reaction controls live in the modal. Close it to resume here.
      </span>
    </div>
  );
}

function MasterCta({
  label,
  isPublish,
  disabled,
  onClick,
  busy,
}: {
  label: string;
  isPublish: boolean;
  disabled: boolean;
  onClick: () => void;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full inline-flex items-center justify-center gap-2 rounded-md px-4 py-3 font-sans text-[13px] font-semibold tracking-[0.005em] transition-transform",
        // v0.7.32 — Brand purity. Was amber-when-scheduled / fuchsia-when-
        // publish; the amber broke the brand-kit "one fuchsia" lock. Now
        // ALWAYS fuchsia regardless of isPublish state. Semantic distinction
        // moves to the leading icon (Zap = publish-now lightning, Send =
        // scheduled paper-plane) + the label morph ("Publish now" vs
        // "Schedule +1h" etc.). Icon + label carry the semantic; color
        // carries the brand.
        "bg-gradient-to-b from-fuchsia-bright to-fuchsia text-[#190007] shadow-[0_12px_24px_-12px_rgba(255,45,149,0.7),inset_0_1px_0_rgba(255,255,255,0.34)] hover:-translate-y-0.5",
        "disabled:bg-line/20 disabled:text-text-tertiary disabled:shadow-none disabled:cursor-not-allowed disabled:translate-y-0",
      )}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isPublish ? (
        <Zap className="h-3.5 w-3.5" />
      ) : (
        <Send className="h-3.5 w-3.5" />
      )}
      {label}
    </button>
  );
}

// v0.7.32 — RoutesAlt renamed to AutopilotAlt per the clipcard-v0732-target
// mockup. Cosmetic restyle: full-width paper-elev secondary button matching
// the demo's `cta-autopilot` pattern. onClick still opens the schedule
// popover (same functional contract as the prior RoutesAlt). Daniel's
// "cosmetic only" directive: no new logic, label + style swap only.
function AutopilotAlt({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-line bg-paper-elev px-3 py-2.5 font-sans text-[12px] font-medium text-ink-soft transition-colors hover:border-fuchsia hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <Zap className="h-3.5 w-3.5" strokeWidth={2} />
      Auto-pilot
    </button>
  );
}

function WhenChips({
  value,
  onChange,
  disabled,
}: {
  value: WhenKey;
  onChange: (v: WhenKey) => void;
  disabled: boolean;
}) {
  const items: { k: WhenKey; label: string }[] = [
    { k: "now", label: "Now" },
    { k: "+1h", label: "+1h" },
    { k: "+24h", label: "+24h" },
    { k: "custom", label: "Custom" },
  ];
  return (
    <div className="grid grid-cols-4 gap-1 mt-1">
      {items.map((it) => {
        const active = value === it.k;
        return (
          <button
            key={it.k}
            type="button"
            onClick={() => onChange(it.k)}
            disabled={disabled}
            className={cn(
              "rounded border py-1 font-mono text-[9px] tracking-[0.08em] uppercase transition-colors",
              active
                ? "border-fuchsia bg-fuchsia/10 text-fuchsia-bright"
                : "border-line/40 text-text-tertiary hover:border-line/60 hover:text-paper",
              "disabled:opacity-40",
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function BakePendingStrip({ startedAt }: { startedAt?: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const start = new Date(startedAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const mm = Math.floor(elapsed / 60).toString().padStart(1, "0");
  const ss = (elapsed % 60).toString().padStart(2, "0");
  return (
    <div className="relative overflow-hidden border-t border-cyan-cool/30 bg-cyan-cool/8 px-5 py-2.5 flex items-center gap-3 font-mono text-[10px] tracking-[0.12em] uppercase text-cyan-cool">
      <span className="absolute inset-0 pointer-events-none" style={{
        background: "linear-gradient(100deg, transparent, rgba(47,233,212,0.16), transparent)",
        animation: "lc-sweep 1.5s linear infinite",
      }} />
      <span className="relative z-10 w-1.5 h-1.5 rounded-full bg-cyan-cool shadow-[0_0_8px_rgba(47,233,212,0.7)] animate-pulse" />
      <span className="relative z-10">
        Baking reaction · <b className="text-paper">{mm}:{ss} elapsed</b>
      </span>
    </div>
  );
}

function BakeErrorStrip({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div className="border-t border-red-400/30 bg-red-400/8 px-5 py-2.5 flex items-center gap-3 font-mono text-[10px] tracking-[0.12em] uppercase text-red-300">
      <span className="text-red-500 font-bold">✕</span>
      <span className="flex-1 truncate normal-case tracking-[0.04em]">
        {message ?? "Bake failed"}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded border border-red-400/40 px-2.5 py-0.5 hover:bg-red-400/10"
      >
        Retry
      </button>
    </div>
  );
}

function SchedulePopoverInline({
  busy,
  forcedNow = false,
  initialWhen,
  onApply,
  onClose,
  onConnectChannels,
}: {
  busy: boolean;
  forcedNow?: boolean;
  initialWhen?: ScheduleWhen;
  onApply: (channels: string[], when: ScheduleWhen) => void;
  onClose: () => void;
  /** Bug 1 (v0.7.30): empty-channels and "add channel" rows route here.
   *  Wired to BottomCockpit.onOpenSettings so users land in Settings →
   *  Connections in one click. */
  onConnectChannels?: () => void;
}) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [when, setWhen] = useState<ScheduleWhen>(initialWhen ?? { kind: "now" });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initialWhen) setWhen(initialWhen);
  }, [initialWhen]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await listChannels();
        if (cancelled) return;
        const active = all.filter((c) => c.status === "active");
        setChannels(active);
        setPicked(new Set(active.map((c) => c.id)));
      } catch (e) {
        if (!cancelled) setErr(humanError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="m-3 rounded-md border border-fuchsia/30 bg-paper-warm/95 p-3 shadow-[0_18px_44px_rgba(11,11,16,0.45)]">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fuchsia-deep">
          {forcedNow ? "Publish now — pick channels" : "Schedule — channels + when"}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-text-tertiary hover:text-ink"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {loading ? (
        <p className="text-[11px] text-text-tertiary">Loading channels…</p>
      ) : err ? (
        <p className="text-[11px] text-red-600">{err}</p>
      ) : channels.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-text-tertiary leading-snug">
            No active channels yet. Connect Instagram, TikTok, YouTube Shorts, or X to publish.
          </p>
          {onConnectChannels && (
            <button
              type="button"
              onClick={() => {
                onConnectChannels();
                onClose();
              }}
              className="rounded-md border border-fuchsia bg-fuchsia/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia hover:bg-fuchsia/20"
            >
              Connect a channel →
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            {channels.map((c) => {
              const on = picked.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() =>
                    setPicked((s) => {
                      const next = new Set(s);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    })
                  }
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]",
                    on
                      ? "border-fuchsia bg-fuchsia text-white"
                      : "border-line bg-paper text-text-tertiary",
                  )}
                >
                  {c.platform} {c.handle ?? ""}
                </button>
              );
            })}
            {onConnectChannels && (
              <button
                type="button"
                onClick={() => {
                  onConnectChannels();
                  onClose();
                }}
                className="ml-auto font-mono text-[9.5px] uppercase tracking-[0.10em] text-text-tertiary underline-offset-2 hover:text-fuchsia hover:underline"
              >
                + Add channel
              </button>
            )}
          </div>
          {!forcedNow && (
            <div className="grid grid-cols-4 gap-1 mb-2">
              {[
                { k: "now", label: "Now", v: { kind: "now" } as ScheduleWhen },
                { k: "1h", label: "+1h", v: { kind: "preset", offsetHours: 1 } as ScheduleWhen },
                { k: "24h", label: "+24h", v: { kind: "preset", offsetHours: 24 } as ScheduleWhen },
                {
                  k: "custom",
                  label: "Custom",
                  v: { kind: "custom", iso: new Date(Date.now() + 3600_000).toISOString() } as ScheduleWhen,
                },
              ].map((opt) => {
                const active =
                  (when.kind === "now" && opt.k === "now") ||
                  (when.kind === "preset" && opt.k === "1h" && when.offsetHours === 1) ||
                  (when.kind === "preset" && opt.k === "24h" && when.offsetHours === 24) ||
                  (when.kind === "custom" && opt.k === "custom");
                return (
                  <button
                    key={opt.k}
                    type="button"
                    onClick={() => setWhen(opt.v)}
                    className={cn(
                      "rounded border py-1 font-mono text-[9px] uppercase tracking-[0.06em]",
                      active
                        ? "border-fuchsia bg-fuchsia/10 text-fuchsia-bright"
                        : "border-line text-text-tertiary",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onClick={() => onApply([...picked], when)}
            disabled={busy || picked.size === 0}
            className="w-full rounded bg-fuchsia px-3 py-2 font-sans text-[12px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? "…" : forcedNow ? "Publish" : "Schedule"} {picked.size} channel
            {picked.size === 1 ? "" : "s"}
          </button>
        </>
      )}
    </div>
  );
}

function CaptionStylePopover({
  activeStyle,
  onPick,
  onClose,
}: {
  activeStyle: CaptionStyleKey | "mixed" | null;
  onPick: (k: CaptionStyleKey) => void;
  onClose: () => void;
}) {
  return (
    <div className="m-3 rounded-md border border-fuchsia/30 bg-paper-warm/95 p-3 shadow-[0_18px_44px_rgba(11,11,16,0.45)]">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fuchsia-deep">
          Caption style
        </span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-text-tertiary hover:text-ink"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {CAPTION_STYLE_KEYS.map((k) => {
          const spec = CAPTION_STYLES[k];
          const active = activeStyle === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => onPick(k)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em]",
                active
                  ? "border-fuchsia bg-fuchsia text-white"
                  : "border-line bg-paper text-ink-soft hover:border-fuchsia",
              )}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: spec.primary }} />
              {spec.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// One-time keyframes injection for the bake sweep.
if (typeof document !== "undefined" && !document.getElementById("lc-cockpit-keyframes")) {
  const style = document.createElement("style");
  style.id = "lc-cockpit-keyframes";
  style.textContent = `
    @keyframes lc-sweep { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
  `;
  document.head.appendChild(style);
}
