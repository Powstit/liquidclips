// Workbench master toolbar — selection chip + master action fan-out.
//
// The cockpit-tile bracket corners + mono uppercase labels match the rest
// of the workbench. The selection model (Set<WindowId>) is owned by the
// store (Agent 1); this component only reads it and dispatches via
// masterActions.fanOut.
//
// All actions are gated on selectedIds.size > 0 — when nothing is picked
// the toolbar shows the selection chip alone (no enabled buttons), so the
// user never gets a confusing "nothing happens when I click" loop. The
// popovers (caption style / layout / ratio / schedule) open immediately
// so the user can pick a target BEFORE committing the action — a single
// "Apply" click then fans out.
//
// USER JOURNEY · MasterToolbar
//   ENABLES — clipper edits 12-24 windows in one chord: pick selection
//             → pick caption style → click Apply → toast confirms.
//   PREVENTS — silent half-applied state (sequential RPC + toast),
//              double-fire (in-flight guard `busy`), accidental destroy
//              (Remove button confirms via a small inline "Confirm?").
//   BREAKS — none — additive top-of-workbench surface.
//   STRANDS — what if all windows fail? toast shows error + Retry; the
//             selection persists. What if the user closes a popover
//             mid-pick? the popover state resets so reopening is clean.
//             What if a schedule needs channels the user hasn't connected?
//             we surface "no channel selected" in the toast and link to
//             Settings via inline copy.

import { useEffect, useState } from "react";
import {
  Captions as CaptionsIcon,
  ChevronDown,
  Layers as LayersIcon,
  Pause,
  Pencil as PencilIcon,
  Play,
  Ratio as RatioIcon,
  Send,
  Trash2,
  X,
} from "lucide-react";
import type { Project } from "../../lib/sidecar";
import { RATIOS } from "../../lib/sidecar";
import { CAPTION_STYLES, CAPTION_STYLE_KEYS } from "../../lib/caption-styles";
import { LayoutIcon, LAYOUTS } from "../clips-feed/LayoutIcon";
import type {
  MasterAction,
  MasterActionResult,
  RatioKey,
  WindowId,
} from "./types";
import { fanOut, type WindowLite } from "./masterActions";
import { MasterActionToast } from "./MasterActionToast";

// Agent 1's Zustand store. We narrow the returned slice at runtime via
// the ToolbarStore shape below so this component stays decoupled from
// store internals that other agents may shift around.
import { useWorkbenchStore } from "./useWorkbenchStore";

type ToolbarStore = {
  windows: Map<WindowId, WindowLite & { boundChannelIds?: string[] }>;
  selection: { selectedIds: Set<WindowId>; focusedId: WindowId | null };
  clearSelection: () => void;
  setRatio?: (id: WindowId, ratio: RatioKey | null) => void;
  setCaptionsOpen?: (id: WindowId, open: boolean) => void;
  promoteToPool?: (id: WindowId, reason: "playing") => void;
};

type Props = {
  project: Project;
  onProjectChange: (p: Project) => void;
};

type PopoverKind =
  | { kind: "none" }
  | { kind: "caption" }
  | { kind: "layout" }
  | { kind: "ratio" }
  | { kind: "schedule" }
  | { kind: "remove-confirm" };

type ToastState = {
  result: MasterActionResult;
  total: number;
  actionLabel: string;
  lastAction: MasterAction;
} | null;

export function MasterToolbar({ project, onProjectChange }: Props) {
  // The store hook returns the full store; we narrow with a runtime shape
  // because Agent 1 may ship a slightly different export name. The cast
  // happens once, here, so downstream code stays typed.
  const store = useWorkbenchStore() as unknown as ToolbarStore;
  const selectedIds = store.selection.selectedIds;
  const selectionSize = selectedIds.size;
  const totalWindows = store.windows.size;

  const [popover, setPopover] = useState<PopoverKind>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  // When playback is toggled we flip an internal "playing" indicator —
  // pause_all is a no-op RPC-wise but the icon needs to reflect intent.
  const [playing, setPlaying] = useState(false);

  // Close the popover whenever selection drops to zero — otherwise the
  // user can re-open a stale popover that targets nothing.
  useEffect(() => {
    if (selectionSize === 0 && popover.kind !== "none") {
      setPopover({ kind: "none" });
    }
  }, [selectionSize, popover.kind]);

  function closePopover() {
    setPopover({ kind: "none" });
  }

  /** Generic dispatch — guards against double-fire, locks UI, runs fanOut,
   *  hands the result to the toast. */
  async function dispatch(action: MasterAction, actionLabel: string) {
    if (busy || selectionSize === 0) return;
    setBusy(true);
    const snapshot = new Set(selectedIds);
    const windowsLite: ReadonlyMap<WindowId, WindowLite> = new Map(
      [...store.windows.entries()].map(([id, w]) => [
        id,
        { clipIdx: w.clipIdx, boundChannelIds: w.boundChannelIds },
      ]),
    );
    try {
      const result = await fanOut(
        action,
        snapshot,
        windowsLite,
        project,
        onProjectChange,
        {
          promoteToPool: store.promoteToPool,
          defaultCaption: (c) => c.description || c.title || "",
        },
      );

      // Ratio fan-out: the store owns per-window ratio; update it for the
      // succeeded ids so the canvas re-renders. We do this AFTER fanOut so
      // we never apply a ratio to a clip that just failed.
      if (action.kind === "apply_ratio" && store.setRatio) {
        for (const id of result.ok) store.setRatio(id, action.ratio);
      }
      if (action.kind === "play_all") setPlaying(true);
      if (action.kind === "pause_all") setPlaying(false);
      if (action.kind === "remove") {
        // Store reconciliation is the store's job — once it sees a new
        // project with fewer clips it'll prune the removed windows. We
        // still clear selection so the toolbar resets cleanly.
        store.clearSelection();
      }

      setToast({
        result,
        total: snapshot.size,
        actionLabel,
        lastAction: action,
      });
      closePopover();
    } finally {
      setBusy(false);
    }
  }

  async function retryFailed(
    failedIds: string[],
    action: MasterAction,
  ): Promise<MasterActionResult> {
    const ids = new Set(failedIds);
    const windowsLite: ReadonlyMap<WindowId, WindowLite> = new Map(
      [...store.windows.entries()].map(([id, w]) => [
        id,
        { clipIdx: w.clipIdx, boundChannelIds: w.boundChannelIds },
      ]),
    );
    return fanOut(action, ids, windowsLite, project, onProjectChange, {
      promoteToPool: store.promoteToPool,
      defaultCaption: (c) => c.description || c.title || "",
    });
  }

  const enabled = selectionSize > 0 && !busy;

  // Pre-compute classnames for the action buttons — bracket-corner tile look,
  // fuchsia border + ink fill, disabled state visibly dimmer (so the user can
  // see "this needs selection" without a tooltip dance).
  const actionBtn = (active: boolean) =>
    [
      "relative inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5",
      "font-mono text-[10px] uppercase tracking-[0.14em]",
      active
        ? "border-fuchsia/60 bg-fuchsia/10 text-fuchsia hover:bg-fuchsia/15"
        : "border-fuchsia/15 bg-paper/30 text-text-tertiary cursor-not-allowed",
    ].join(" ");

  const destructiveBtn = (active: boolean) =>
    [
      "relative inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5",
      "font-mono text-[10px] uppercase tracking-[0.14em]",
      active
        ? "border-[#DC2626]/60 bg-[#DC2626]/10 text-[#DC2626] hover:bg-[#DC2626]/15"
        : "border-[#DC2626]/15 bg-paper/30 text-text-tertiary cursor-not-allowed",
    ].join(" ");

  return (
    <>
      <div
        role="toolbar"
        aria-label="Workbench master toolbar"
        className="relative flex w-full items-center gap-3 rounded-xl border border-fuchsia/30 bg-paper-warm/40 px-3 py-2"
      >
        <BracketCorners />

        {/* Selection chip — always visible so the user always knows the
            current scope of every action below. */}
        <div className="flex items-center gap-2 rounded-md border border-fuchsia/40 bg-paper/40 px-2.5 py-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">
            {selectionSize === 0
              ? `${totalWindows} windows · none selected`
              : `${selectionSize} of ${totalWindows} selected`}
          </span>
          {selectionSize > 0 ? (
            <button
              type="button"
              onClick={() => store.clearSelection()}
              className="rounded-full p-0.5 text-fuchsia/80 hover:text-fuchsia"
              aria-label="Clear selection"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>

        <span className="h-5 w-px bg-fuchsia/15" aria-hidden />

        {/* Action group — popover triggers + immediate-fire buttons. */}
        <div className="flex flex-wrap items-center gap-2">
          <PopoverTrigger
            label="Caption style"
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
          <PopoverTrigger
            label="Layout"
            icon={<LayersIcon className="h-3.5 w-3.5" />}
            disabled={!enabled}
            active={popover.kind === "layout"}
            className={actionBtn(enabled)}
            onToggle={() =>
              setPopover((p) =>
                p.kind === "layout" ? { kind: "none" } : { kind: "layout" },
              )
            }
          />
          <PopoverTrigger
            label="Ratio"
            icon={<RatioIcon className="h-3.5 w-3.5" />}
            disabled={!enabled}
            active={popover.kind === "ratio"}
            className={actionBtn(enabled)}
            onToggle={() =>
              setPopover((p) =>
                p.kind === "ratio" ? { kind: "none" } : { kind: "ratio" },
              )
            }
          />
          <PopoverTrigger
            label="Schedule"
            icon={<Send className="h-3.5 w-3.5" />}
            disabled={!enabled}
            active={popover.kind === "schedule"}
            className={actionBtn(enabled)}
            onToggle={() =>
              setPopover((p) =>
                p.kind === "schedule"
                  ? { kind: "none" }
                  : { kind: "schedule" },
              )
            }
          />

          {/* Edit ▾ — visible affordance for users who haven't memorised `E`.
              Opens the Edit drawer on the focused tile via the store. Not
              gated on selection (the drawer edits ONE tile — the focused
              one). Disabled when there is no focused window. */}
          {(() => {
            const focusedId = store.selection.focusedId;
            const canEdit = !!focusedId && !!store.setCaptionsOpen;
            return (
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => {
                  if (!focusedId || !store.setCaptionsOpen) return;
                  store.setCaptionsOpen(focusedId, true);
                }}
                className={actionBtn(canEdit)}
                aria-label="Edit focused tile"
                title={canEdit ? "Edit focused tile (E)" : "Focus a tile first"}
              >
                <PencilIcon className="h-3.5 w-3.5" /> Edit ▾
              </button>
            );
          })()}

          {/* Play / Pause — immediate, no popover. */}
          <button
            type="button"
            disabled={!enabled}
            onClick={() =>
              void dispatch(
                playing ? { kind: "pause_all" } : { kind: "play_all" },
                playing ? "Pause all" : "Play all",
              )
            }
            className={actionBtn(enabled)}
            aria-label={playing ? "Pause all selected" : "Play all selected"}
            aria-pressed={playing}
          >
            {playing ? (
              <>
                <Pause className="h-3.5 w-3.5" /> Pause all
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" /> Play all
              </>
            )}
          </button>

          {/* Remove — destructive, two-step confirm via popover. */}
          <button
            type="button"
            disabled={!enabled}
            onClick={() =>
              setPopover((p) =>
                p.kind === "remove-confirm"
                  ? { kind: "none" }
                  : { kind: "remove-confirm" },
              )
            }
            className={destructiveBtn(enabled)}
          >
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </button>
        </div>

        {/* Popover surfaces — rendered as absolute panels below the toolbar.
            One at a time. Closing one opens nothing. */}
        {popover.kind === "caption" ? (
          <CaptionStylePopover
            disabled={busy}
            onApply={(style) =>
              void dispatch(
                { kind: "apply_caption_style", style },
                "Apply caption style",
              )
            }
            onClose={closePopover}
          />
        ) : null}

        {popover.kind === "layout" ? (
          <LayoutPopover
            disabled={busy}
            onApply={(layout) =>
              void dispatch(
                layout === "none"
                  ? { kind: "apply_layout", layout: "none" }
                  : {
                      kind: "apply_layout",
                      layout,
                      // sourcePath omitted — see masterActions: a layout
                      // other than "none" with no source is surfaced as
                      // "pick a reaction source first" in the toast. The
                      // single-clip drawer is where users pick a source;
                      // this fan-out reuses an already-applied source on
                      // a future iteration.
                    },
                "Apply layout",
              )
            }
            onClose={closePopover}
          />
        ) : null}

        {popover.kind === "ratio" ? (
          <RatioPopover
            disabled={busy}
            onApply={(ratio) =>
              void dispatch({ kind: "apply_ratio", ratio }, "Apply ratio")
            }
            onClose={closePopover}
          />
        ) : null}

        {popover.kind === "schedule" ? (
          <SchedulePopover
            disabled={busy}
            onApply={(channels, when) =>
              void dispatch(
                { kind: "schedule", channels, when },
                "Schedule selected",
              )
            }
            onClose={closePopover}
          />
        ) : null}

        {popover.kind === "remove-confirm" ? (
          <RemoveConfirmPopover
            count={selectionSize}
            disabled={busy}
            onConfirm={() => void dispatch({ kind: "remove" }, "Remove")}
            onClose={closePopover}
          />
        ) : null}
      </div>

      <MasterActionToast
        result={toast?.result ?? null}
        total={toast?.total ?? 0}
        actionLabel={toast?.actionLabel ?? ""}
        onRetry={
          toast
            ? (failedIds) => retryFailed(failedIds, toast.lastAction)
            : undefined
        }
        onDismiss={() => setToast(null)}
      />
    </>
  );
}

/* ──────────────────────── helpers ──────────────────────── */

function BracketCorners() {
  // Cockpit-tile fuchsia bracket corners — purely decorative, but a strong
  // brand signal across the workbench. Pointer-events-none so they never
  // eat clicks meant for the chips below.
  const corner =
    "pointer-events-none absolute h-3 w-3 border-fuchsia/70";
  return (
    <>
      <span aria-hidden className={`${corner} left-1 top-1 border-l border-t`} />
      <span
        aria-hidden
        className={`${corner} right-1 top-1 border-r border-t`}
      />
      <span
        aria-hidden
        className={`${corner} left-1 bottom-1 border-l border-b`}
      />
      <span
        aria-hidden
        className={`${corner} right-1 bottom-1 border-r border-b`}
      />
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
}: {
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  active: boolean;
  className: string;
  onToggle: () => void;
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
      <ChevronDown className="h-3 w-3 opacity-70" />
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
  // Close on Esc — keeps keyboard users from being trapped inside the
  // popover with no way out short of clicking the parent toggle.
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
  onApply: (style: (typeof CAPTION_STYLE_KEYS)[number]) => void;
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

function LayoutPopover({
  disabled,
  onApply,
  onClose,
}: {
  disabled: boolean;
  onApply: (layout: (typeof LAYOUTS)[number]["key"]) => void;
  onClose: () => void;
}) {
  return (
    <PopoverShell onClose={onClose}>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
        layout
      </p>
      <div className="flex flex-wrap gap-2">
        {LAYOUTS.map((l) => (
          <button
            key={l.key}
            type="button"
            disabled={disabled}
            onClick={() => onApply(l.key)}
            className="inline-flex items-center gap-1.5 rounded-md border border-fuchsia/40 bg-paper/40 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink hover:border-fuchsia hover:bg-fuchsia/10 disabled:opacity-40"
          >
            <span className="text-fuchsia">
              <LayoutIcon kind={l.key} />
            </span>
            {l.short}
          </button>
        ))}
      </div>
      <p className="mt-2 font-mono text-[10px] tracking-[0.06em] text-text-tertiary">
        Non-Full layouts use each window&apos;s existing reaction source. Pick a
        source per clip from the single-clip drawer first.
      </p>
    </PopoverShell>
  );
}

function RatioPopover({
  disabled,
  onApply,
  onClose,
}: {
  disabled: boolean;
  onApply: (ratio: RatioKey) => void;
  onClose: () => void;
}) {
  return (
    <PopoverShell onClose={onClose}>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
        ratio
      </p>
      <div className="inline-flex overflow-hidden rounded-full border border-fuchsia/40 bg-paper/40">
        {RATIOS.map((r) => (
          <button
            key={r.key}
            type="button"
            disabled={disabled}
            onClick={() => onApply(r.key)}
            className="px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink hover:bg-fuchsia/15 disabled:opacity-40"
          >
            {r.label}
          </button>
        ))}
      </div>
    </PopoverShell>
  );
}

function SchedulePopover({
  disabled,
  onApply,
  onClose,
}: {
  disabled: boolean;
  onApply: (channels: string[], when: "now" | "1h" | "24h") => void;
  onClose: () => void;
}) {
  // For master-fan-out we don't fetch channels here — we rely on per-window
  // boundChannelIds (set in the single-clip flow). This keeps the toolbar
  // popover small and avoids a network round-trip every open. If a window
  // has no bound channels it surfaces "no channel selected" in the toast.
  const [when, setWhen] = useState<"now" | "1h" | "24h">("now");
  return (
    <PopoverShell onClose={onClose}>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
        schedule
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        {(["now", "1h", "24h"] as const).map((k) => {
          const active = when === k;
          const label =
            k === "now" ? "Post now" : k === "1h" ? "+ 1 hour" : "+ 24 hours";
          return (
            <button
              key={k}
              type="button"
              onClick={() => setWhen(k)}
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
      <button
        type="button"
        disabled={disabled}
        onClick={() => onApply([], when)}
        className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[12px] font-semibold text-white shadow-[0_0_14px_rgba(255,26,140,0.4)] hover:bg-fuchsia-bright disabled:opacity-40"
      >
        <Send className="h-3 w-3" /> Schedule selected
      </button>
      <p className="mt-2 font-mono text-[10px] tracking-[0.06em] text-text-tertiary">
        Posts to each window&apos;s bound channels. Bind channels in the
        single-clip scheduler first.
      </p>
    </PopoverShell>
  );
}

function RemoveConfirmPopover({
  count,
  disabled,
  onConfirm,
  onClose,
}: {
  count: number;
  disabled: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <PopoverShell onClose={onClose}>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#DC2626]">
        confirm remove
      </p>
      <p className="mb-3 font-sans text-[13px] text-ink">
        Remove {count} clip{count === 1 ? "" : "s"} from this project? This
        deletes the underlying clip and can&apos;t be undone.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={onConfirm}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#DC2626]/60 bg-[#DC2626]/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[#DC2626] hover:bg-[#DC2626]/15 disabled:opacity-40"
        >
          <Trash2 className="h-3 w-3" /> Remove {count}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-elev px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </PopoverShell>
  );
}
