// ship-lens v0.7.13: Grid+select master toolbar. Replaces the Workbench WindowManager's MasterToolbar — selection IS the surface.
//
// Floats above the grid when `selectedIdxs.length > 0`, fans out Schedule /
// Publish / Caption / Ratio / Layout across the selection. Selection is
// a plain `number[]` of clip indices into project.clips — there's no
// workbench WindowId indirection because the grid IS the surface.
//
// USER JOURNEY · GridMasterToolbar
//   ENABLES — clipper selects N cards on the grid → master bar pops in
//             over the grid → one action, one toast confirms what landed
//             across the whole selection.
//   PREVENTS — silent partial failures (Promise.allSettled + per-clip
//              failure ledger surfaces every "no rendered video" / "no
//              channel selected" clip by name), double-fire (in-flight
//              `busy` guard), and "I clicked Schedule but I have no
//              channels yet" (toast surfaces "Connect a channel first"
//              with a link to Settings).
//   BREAKS — none. Additive overlay on top of the existing grid surface;
//            ResultsGrid + ClipCard are not touched.
//   STRANDS — what if the user clears selection mid-action? The action
//             continues against the snapshot it captured at dispatch
//             time; the toast still surfaces the summary so the user
//             never wonders what happened. What if all selected clips
//             share one unrendered state? Each row in the toast names
//             the reason once so the user knows what to fix next.

import { useEffect, useMemo, useState } from "react";
import {
  Captions as CaptionsIcon,
  ChevronDown,
  Loader2,
  Send,
  X,
} from "lucide-react";
import { humanError, type Project } from "../../lib/sidecar";
import {
  CAPTION_STYLES,
  CAPTION_STYLE_KEYS,
  type CaptionStyleKey,
} from "../../lib/caption-styles";
import { listChannels, type Channel } from "../../lib/backend";
import { ChannelPicker } from "../schedule/ChannelPicker";
import {
  applyCaptionStyle,
  publishClipsNow,
  scheduleClips,
  summarize,
  type ClipActionResult,
  type ScheduleWhen,
} from "./masterClipActions";

type Props = {
  /** Clip indices currently selected on the grid. Sorted ascending. */
  selectedIdxs: number[];
  /** Source-of-truth project — every action passes this in and the new
   *  project (when one is produced) flows out via onProjectChange. */
  project: Project;
  /** Called with a new project after an action that mutates state.
   *  Schedule/Publish never mutate project; caption / ratio / layout do. */
  onProjectChange: (p: Project) => void;
  /** Called when the user clicks the "Clear ×" affordance on the chip.
   *  The toolbar does NOT clear selection on its own after an action
   *  lands — that's the parent grid's call. */
  onClear: () => void;
  /** Optional — open the Settings → Channels surface from the "no
   *  channels connected" toast. When omitted, the toast just shows the
   *  copy without the inline link. */
  onOpenSettings?: () => void;
};

type PopoverKind =
  | { kind: "none" }
  | { kind: "schedule" }
  | { kind: "publish" }
  | { kind: "caption" }
  | { kind: "ratio" }
  | { kind: "layout" };

type ToastState = {
  /** One-line copy that summarises the outcome. */
  summary: string;
  /** Wire colour — fuchsia for clean, red for has-failures. */
  variant: "ok" | "partial" | "fail";
  /** The full failure ledger from the last action — surfaced under the
   *  summary so the user can see exactly which clips need attention. */
  failed: ClipActionResult["failed"];
  /** Render only the first N failure rows; the rest collapse into "+M more". */
  failureCap: number;
} | null;

export function GridMasterToolbar({
  selectedIdxs,
  project,
  onProjectChange,
  onClear,
  onOpenSettings,
}: Props): JSX.Element | null {
  const [popover, setPopover] = useState<PopoverKind>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  // v0.7.18 — Cockpit promotion. The toolbar now ALWAYS renders as a
  // persistent bottom dashboard. When the user has nothing selected, the
  // target falls back to the entire project (ALL clips). When they DO
  // select, the target narrows to the selection. The "X clear" affordance
  // only renders when there's an active selection.
  const isAllMode = selectedIdxs.length === 0;
  const effectiveIdxs = isAllMode
    ? project.clips.map((_, i) => i)
    : selectedIdxs;

  const selectionSize = effectiveIdxs.length;
  const enabled = !busy && selectionSize > 0;

  function closePopover() {
    setPopover({ kind: "none" });
  }

  function pushToast(
    summary: string,
    failed: ClipActionResult["failed"],
    okCount: number,
  ) {
    const variant: ToastState extends infer T ? T : never =
      okCount === 0 && failed.length > 0
        ? null
        : null;
    void variant; // narrow below — TS already knows
    const v: "ok" | "partial" | "fail" =
      failed.length === 0
        ? "ok"
        : okCount === 0
          ? "fail"
          : "partial";
    setToast({ summary, variant: v, failed, failureCap: 3 });
  }

  /** Run a fan-out with the standard busy guard + toast plumbing. */
  async function runMutating(
    actionLabel: string,
    fn: () => Promise<{ project: Project; result: ClipActionResult }>,
  ) {
    if (busy) return;
    setBusy(true);
    try {
      const { project: next, result } = await fn();
      if (next !== project) onProjectChange(next);
      pushToast(summarize(actionLabel, result, selectionSize), result.failed, result.ok);
      closePopover();
    } catch (e) {
      setToast({
        summary: `${actionLabel} failed — ${humanError(e).slice(0, 120)}`,
        variant: "fail",
        failed: [],
        failureCap: 0,
      });
    } finally {
      setBusy(false);
    }
  }

  async function runSideEffect(
    actionLabel: string,
    fn: () => Promise<ClipActionResult>,
  ) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await fn();
      pushToast(summarize(actionLabel, result, selectionSize), result.failed, result.ok);
      closePopover();
    } catch (e) {
      setToast({
        summary: `${actionLabel} failed — ${humanError(e).slice(0, 120)}`,
        variant: "fail",
        failed: [],
        failureCap: 0,
      });
    } finally {
      setBusy(false);
    }
  }

  const actionBtn = (active: boolean) =>
    [
      "relative inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5",
      "font-mono text-[10px] uppercase tracking-[0.14em]",
      active
        ? "border-fuchsia/60 bg-fuchsia/10 text-fuchsia hover:bg-fuchsia/15"
        : "border-fuchsia/15 bg-paper/30 text-text-tertiary cursor-not-allowed",
    ].join(" ");

  return (
    <div
      role="toolbar"
      aria-label="Cockpit"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full px-4 pb-4"
    >
      <div className="relative mx-auto flex max-w-6xl flex-wrap items-center gap-3 rounded-2xl border-2 border-fuchsia/60 bg-paper-warm/95 px-4 py-2.5 shadow-[0_-18px_60px_-12px_rgba(255,26,140,0.22),0_-1px_0_0_rgba(255,26,140,0.18)] backdrop-blur-xl">
        <BracketCorners />

        {/* Target chip — "All N clips" when nothing selected, "N selected" otherwise. */}
        <div className="flex items-center gap-2 rounded-md border border-fuchsia/40 bg-paper/50 px-2.5 py-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">
            {isAllMode ? `All ${selectionSize}` : `${selectionSize} selected`}
          </span>
          {!isAllMode && (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia/80 hover:bg-fuchsia/10 hover:text-fuchsia"
              aria-label="Clear selection"
            >
              Clear <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <span className="h-5 w-px bg-fuchsia/15" aria-hidden />

        {/* Action group */}
        <div className="flex flex-wrap items-center gap-2">
          <PopoverTrigger
            label="Schedule"
            icon={<Send className="h-3.5 w-3.5" />}
            disabled={!enabled}
            active={popover.kind === "schedule"}
            className={actionBtn(enabled)}
            onToggle={() =>
              setPopover((p) =>
                p.kind === "schedule" ? { kind: "none" } : { kind: "schedule" },
              )
            }
          />
          <PopoverTrigger
            label="Publish"
            icon={<Send className="h-3.5 w-3.5" />}
            disabled={!enabled}
            active={popover.kind === "publish"}
            className={actionBtn(enabled)}
            withChevron={false}
            onToggle={() =>
              setPopover((p) =>
                p.kind === "publish" ? { kind: "none" } : { kind: "publish" },
              )
            }
          />
          <PopoverTrigger
            label="Captions"
            icon={<CaptionsIcon className="h-3.5 w-3.5" />}
            disabled={!enabled}
            active={popover.kind === "caption"}
            className={actionBtn(enabled)}
            onToggle={() =>
              setPopover((p) =>
                p.kind === "caption" ? { kind: "none" } : { kind: "caption" },
              )
            }
          />
          {/* ship-lens v0.7.13 F2 — Ratio + Layout popovers removed.
              applyRatio/applyLayout wrote preferred_ratio/preferred_layout
              to clips but NO surface read them — silent-success lies that
              showed a confirmation toast while nothing actually changed.
              Per-clip ratio still works via ClipPreview's ratio picker;
              batch ratio + layout return in v0.7.14 with real wiring. */}

          {busy ? (
            <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">
              <Loader2 className="h-3 w-3 animate-spin" />
              applying
            </span>
          ) : null}
        </div>

        {/* One-at-a-time popover surfaces, anchored under the bar. */}
        {popover.kind === "schedule" ? (
          <SchedulePopover
            disabled={busy}
            initialWhen={{ kind: "now" }}
            onOpenSettings={onOpenSettings}
            onApply={(channels, when) =>
              void runSideEffect("Scheduled", () =>
                scheduleClips(project, effectiveIdxs, when, channels),
              )
            }
            onMissingChannels={() =>
              setToast({
                summary: "Connect a channel first",
                variant: "fail",
                failed: [],
                failureCap: 0,
              })
            }
            onClose={closePopover}
          />
        ) : null}

        {popover.kind === "publish" ? (
          <SchedulePopover
            disabled={busy}
            initialWhen={{ kind: "now" }}
            forcedWhen={{ kind: "now" }}
            onOpenSettings={onOpenSettings}
            onApply={(channels) =>
              void runSideEffect("Published", () =>
                publishClipsNow(project, effectiveIdxs, channels),
              )
            }
            onMissingChannels={() =>
              setToast({
                summary: "Connect a channel first",
                variant: "fail",
                failed: [],
                failureCap: 0,
              })
            }
            onClose={closePopover}
          />
        ) : null}

        {popover.kind === "caption" ? (
          <CaptionStylePopover
            disabled={busy}
            onApply={(style) =>
              void runMutating("Applied caption style to", () =>
                applyCaptionStyle(project, effectiveIdxs, style, null),
              )
            }
            onClose={closePopover}
          />
        ) : null}

        {/* v0.7.13 F2 — RatioPopover + LayoutPopover removed (silent-success lies). */}
      </div>

      {/* One-line summary toast that mirrors what the last action produced.
          Stays beneath the bar so the user's eye doesn't have to jump to
          the top-right corner to find out what happened. */}
      {toast ? (
        <SummaryToast
          toast={toast}
          onOpenSettings={onOpenSettings}
          onDismiss={() => setToast(null)}
        />
      ) : null}
    </div>
  );
}

/* ──────────────────────── helpers ──────────────────────── */

function BracketCorners() {
  const corner = "pointer-events-none absolute h-3 w-3 border-fuchsia/70";
  return (
    <>
      <span aria-hidden className={`${corner} left-1 top-1 border-l border-t`} />
      <span aria-hidden className={`${corner} right-1 top-1 border-r border-t`} />
      <span aria-hidden className={`${corner} left-1 bottom-1 border-l border-b`} />
      <span aria-hidden className={`${corner} right-1 bottom-1 border-r border-b`} />
    </>
  );
}

function PopoverTrigger({
  label,
  icon,
  disabled,
  active,
  className,
  onToggle,
  withChevron = true,
}: {
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  active: boolean;
  className: string;
  onToggle: () => void;
  withChevron?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      aria-haspopup="dialog"
      aria-expanded={active}
      className={className}
    >
      {icon}
      {label}
      {withChevron ? <ChevronDown className="h-3 w-3 opacity-70" /> : null}
    </button>
  );
}

function PopoverShell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="false"
      className="absolute left-3 right-3 top-full z-50 mt-1 rounded-xl border border-fuchsia/30 bg-paper-warm/95 p-3 shadow-[0_18px_44px_rgba(11,11,16,0.35)] backdrop-blur"
    >
      {children}
    </div>
  );
}

function CaptionStylePopover({
  disabled,
  onApply,
  onClose,
}: {
  disabled: boolean;
  onApply: (style: CaptionStyleKey) => void;
  onClose: () => void;
}) {
  return (
    <PopoverShell onClose={onClose}>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
        caption style
      </p>
      <div className="flex flex-wrap gap-2">
        {CAPTION_STYLE_KEYS.map((k) => {
          const spec = CAPTION_STYLES[k];
          return (
            <button
              key={k}
              type="button"
              disabled={disabled}
              onClick={() => onApply(k)}
              className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia/40 bg-paper/40 px-3 py-1 font-sans text-[12px] text-ink hover:border-fuchsia hover:bg-fuchsia/10 disabled:opacity-40"
              style={{ fontFamily: spec.fontFamily }}
            >
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: spec.primary }}
              />
              {spec.label}
            </button>
          );
        })}
      </div>
    </PopoverShell>
  );
}

// ship-lens v0.7.13 F2 — RatioPopover + LayoutPopover deleted. Both wrote
// preferred_ratio/preferred_layout fields no surface read. Will return in
// v0.7.14 with real wiring.

function SchedulePopover({
  disabled,
  initialWhen,
  forcedWhen,
  onApply,
  onMissingChannels,
  onOpenSettings,
  onClose,
}: {
  disabled: boolean;
  initialWhen: ScheduleWhen;
  /** When set, the time controls are hidden and this is the only choice.
   *  Used by the Publish button (always "now"). */
  forcedWhen?: ScheduleWhen;
  onApply: (channels: string[], when: ScheduleWhen) => void;
  onMissingChannels: () => void;
  onOpenSettings?: () => void;
  onClose: () => void;
}) {
  const [when, setWhen] = useState<ScheduleWhen>(forcedWhen ?? initialWhen);
  const [customIso, setCustomIso] = useState<string>(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 60);
    // toISOString() returns UTC; trim the seconds + Z so <input type=datetime-local>
    // accepts it as a local-ish default. Validation happens on Apply.
    return d.toISOString().slice(0, 16);
  });
  const [channels, setChannels] = useState<Channel[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load channels on mount so the picker has the latest status info. We
  // re-use ChannelPicker for single-select; for the master action we need
  // multi-select, so we render our own grid of chips over the same Channel
  // list — keeps status awareness without forking the underlying surface.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await listChannels();
        if (cancelled) return;
        setChannels(all.filter((c) => c.status !== "deleted"));
      } catch (e) {
        if (cancelled) return;
        setLoadError(humanError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeChannels = useMemo(
    () => channels.filter((c) => c.status === "active"),
    [channels],
  );

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function apply() {
    if (activeChannels.length === 0) {
      onMissingChannels();
      onClose();
      return;
    }
    if (picked.size === 0) {
      // No-op safeguard — user clicked Apply without ticking a channel.
      onMissingChannels();
      return;
    }
    let chosenWhen: ScheduleWhen = forcedWhen ?? when;
    if (!forcedWhen && when.kind === "custom") {
      // Validate the custom datetime — fall back to "now" if it's clearly
      // bogus so the action still proceeds rather than silently no-op.
      const parsed = new Date(customIso);
      if (Number.isNaN(parsed.getTime())) {
        chosenWhen = { kind: "now" };
      } else {
        chosenWhen = { kind: "custom", iso: parsed.toISOString() };
      }
    }
    onApply(Array.from(picked), chosenWhen);
  }

  return (
    <PopoverShell onClose={onClose}>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
        {forcedWhen ? "publish now" : "schedule"}
      </p>

      {!forcedWhen ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {(["now", "1h", "24h", "custom"] as const).map((k) => {
            const active =
              (k === "now" && when.kind === "now") ||
              (k === "1h" && when.kind === "preset" && when.offsetHours === 1) ||
              (k === "24h" && when.kind === "preset" && when.offsetHours === 24) ||
              (k === "custom" && when.kind === "custom");
            const label =
              k === "now"
                ? "Now"
                : k === "1h"
                  ? "+ 1 hour"
                  : k === "24h"
                    ? "+ 24 hours"
                    : "Custom";
            return (
              <button
                key={k}
                type="button"
                onClick={() =>
                  setWhen(
                    k === "now"
                      ? { kind: "now" }
                      : k === "1h"
                        ? { kind: "preset", offsetHours: 1 }
                        : k === "24h"
                          ? { kind: "preset", offsetHours: 24 }
                          : { kind: "custom", iso: customIso },
                  )
                }
                className={
                  active
                    ? "inline-flex items-center gap-1 rounded-full border-2 border-fuchsia bg-fuchsia/15 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia"
                    : "inline-flex items-center gap-1 rounded-full border border-fuchsia/40 bg-paper/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:border-fuchsia hover:text-fuchsia"
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}

      {!forcedWhen && when.kind === "custom" ? (
        <div className="mb-3">
          <label className="block font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary mb-1">
            datetime
          </label>
          <input
            type="datetime-local"
            value={customIso}
            onChange={(e) => setCustomIso(e.target.value)}
            className="rounded-md border border-fuchsia/40 bg-paper/40 px-2 py-1 font-mono text-[11px] text-ink"
          />
        </div>
      ) : null}

      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
        channels
      </p>

      {loading ? (
        <div className="flex items-center gap-2 font-mono text-[11px] text-text-tertiary">
          <Loader2 className="h-3 w-3 animate-spin" /> loading channels…
        </div>
      ) : loadError ? (
        <div className="flex flex-col gap-2">
          <p className="font-sans text-[12px] text-[var(--color-danger)]">{loadError}</p>
          {onOpenSettings ? (
            <button
              type="button"
              onClick={onOpenSettings}
              className="self-start font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia underline-offset-2 hover:underline"
            >
              Open Settings → Channels
            </button>
          ) : null}
        </div>
      ) : activeChannels.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p className="font-sans text-[12px] text-text-secondary">
            No active channels. Connect one in{" "}
            <strong>Settings → Channels</strong> first.
          </p>
          {/* ChannelPicker reuse — surfaces the non-active channels with the
              right status badge so the user can see why their TikTok is greyed
              out. We pass a no-op value/onChange because for the master action
              we only use this picker as a status-aware visualisation. */}
          <ChannelPicker
            value={null}
            onChange={() => {
              /* multi-select handled below; this single-select fallback is
                 only shown when there are no active rows, so it never fires
                 in practice. */
            }}
            onAddChannel={onOpenSettings}
            onManageChannels={onOpenSettings}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {channels.map((c) => {
              const sel = picked.has(c.id);
              const disabledChip = c.status !== "active";
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={disabledChip || disabled}
                  onClick={() => toggle(c.id)}
                  title={
                    disabledChip
                      ? `Status: ${c.status} — open Settings → Channels`
                      : c.handle ?? c.label
                  }
                  className={[
                    "inline-flex items-center gap-2 rounded-full border px-3 py-1 font-sans text-[12px] transition-colors",
                    disabledChip
                      ? "cursor-not-allowed border-line bg-paper/40 text-text-tertiary opacity-60"
                      : sel
                        ? "border-fuchsia bg-fuchsia text-paper"
                        : "border-fuchsia/40 bg-paper/40 text-ink hover:border-fuchsia hover:bg-fuchsia/10",
                  ].join(" ")}
                >
                  <span
                    className={
                      sel
                        ? "grid h-4 w-4 place-items-center rounded-full bg-paper text-fuchsia"
                        : "grid h-4 w-4 place-items-center rounded-full bg-ink text-paper"
                    }
                  >
                    <span className="font-mono text-[9px] uppercase">
                      {c.platform[0]?.toUpperCase() ?? "?"}
                    </span>
                  </span>
                  <span className="max-w-[140px] truncate">{c.label}</span>
                  {c.status !== "active" ? (
                    <span className="ml-1 rounded-full bg-fuchsia-deep/20 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-fuchsia-deep">
                      {c.status}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              {picked.size} channel{picked.size === 1 ? "" : "s"} picked
            </span>
            <button
              type="button"
              disabled={disabled || picked.size === 0}
              onClick={apply}
              className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[12px] font-semibold text-white shadow-[0_0_14px_rgba(255,26,140,0.4)] hover:bg-fuchsia-bright disabled:opacity-40"
            >
              <Send className="h-3 w-3" /> Apply
            </button>
          </div>
        </div>
      )}
    </PopoverShell>
  );
}

function SummaryToast({
  toast,
  onOpenSettings,
  onDismiss,
}: {
  toast: NonNullable<ToastState>;
  onOpenSettings?: () => void;
  onDismiss: () => void;
}) {
  // Auto-dismiss clean successes after 5s so the bar doesn't accumulate
  // toast clutter. Failures stay sticky until the user reads them.
  useEffect(() => {
    if (toast.variant !== "ok") return;
    const t = window.setTimeout(onDismiss, 5000);
    return () => window.clearTimeout(t);
  }, [toast, onDismiss]);

  const wire =
    toast.variant === "ok"
      ? "border-fuchsia/40 bg-paper-warm/95"
      : toast.variant === "partial"
        ? "border-fuchsia-deep/50 bg-fuchsia-deep/5"
        : "border-[var(--color-danger)]/50 bg-[var(--color-danger)]/5";

  const extra =
    toast.failed.length > toast.failureCap
      ? toast.failed.length - toast.failureCap
      : 0;
  const visible = toast.failed.slice(0, toast.failureCap);
  const needsChannelHint = toast.summary
    .toLowerCase()
    .includes("connect a channel");

  return (
    <div
      role="status"
      aria-live="polite"
      className={`mt-2 flex flex-col gap-1 rounded-xl border px-3 py-2 backdrop-blur ${wire}`}
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 font-sans text-[12px] text-ink">{toast.summary}</p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded-full p-0.5 text-text-tertiary hover:text-ink"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {needsChannelHint && onOpenSettings ? (
        <button
          type="button"
          onClick={onOpenSettings}
          className="self-start font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia underline-offset-2 hover:underline"
        >
          Open Settings → Channels
        </button>
      ) : null}
      {visible.length > 0 ? (
        <ul className="ml-1 list-disc pl-3 font-mono text-[10px] tracking-[0.04em] text-text-secondary">
          {visible.map((f, i) => (
            <li key={`${f.idx}-${i}`}>
              clip #{f.idx + 1} — {f.message}
            </li>
          ))}
          {extra > 0 ? (
            <li className="list-none text-text-tertiary">+{extra} more</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
