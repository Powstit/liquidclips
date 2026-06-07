// Workbench tile chrome — top bar above every ClipWindow.
//
// Renders the tick checkbox (selection — does NOT change focus), title, and
// close button. Reserves a slot for the per-window account-binding chip;
// Agent 5 wires the real chip into `[data-slot="account-binding"]` later.
// Until then the slot stays empty (and benign) so this file ships first.
//
// Visual language: cockpit-tile fuchsia HUD corner brackets (same dashed
// language as LibraryCard / UploadPortal), mono uppercase title.

import { useMemo, useState } from "react";
import { useWorkbenchStore } from "./useWorkbenchStore";
import { ConfirmDialog } from "../ConfirmDialog";
import { AccountBindingChip } from "./AccountBindingChip";
import type { Clip, WindowId } from "./types";

// Heuristic for unsaved edits: the captions drawer's last Apply writes
// caption_palette in the bake. If the user opened the drawer and applied
// within the last 5 minutes, treat the window as "recently edited" and
// guard the close with a confirm. No signal → close silently.
function recentlyEdited(clip: Clip): boolean {
  // `caption_palette` is the only persisted timestamp-adjacent signal on
  // Clip today. Real "last edit time" would need a sidecar field; for now
  // presence-of-custom-palette is a soft heuristic. Refine when Agent 1
  // adds a window-level dirty flag.
  return !!clip.caption_palette;
}

export function ClipWindowChrome({
  windowId,
  clip,
  selected,
  focused,
}: {
  windowId: WindowId;
  clip: Clip;
  selected: boolean;
  focused: boolean;
}) {
  // Selector-scoped subscriptions — chrome only re-renders when its own
  // window's slice changes, not on every canvas move.
  const toggleSelected = useWorkbenchStore((s) => s.toggleSelected);
  const removeWindow = useWorkbenchStore((s) => s.removeWindow);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const isDirtyHeuristic = useMemo(() => recentlyEdited(clip), [clip]);

  function handleTick(e: React.MouseEvent) {
    e.stopPropagation();
    toggleSelected(windowId);
  }

  function handleClose(e: React.MouseEvent) {
    e.stopPropagation();
    if (isDirtyHeuristic) {
      setConfirmOpen(true);
      return;
    }
    removeWindow(windowId);
  }

  return (
    <div
      className="relative flex items-center gap-2 border-b border-line bg-paper px-2.5 py-1.5"
      data-window-id={windowId}
      data-focused={focused ? "true" : "false"}
    >
      {/* Fuchsia HUD bracket corners — cockpit-tile language. Only visible
          when this window is focused; otherwise the chrome stays quiet so
          a 100-tile grid doesn't strobe. */}
      {focused && (
        <>
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
        </>
      )}

      {/* Tick checkbox — selection only. Does NOT promote to focus, so the
          clipper can multi-select without yanking the active video pool. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={selected ? "Deselect this clip" : "Select this clip"}
        onClick={handleTick}
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border transition-colors ${
          selected
            ? "border-fuchsia bg-fuchsia text-white"
            : "border-line bg-paper text-transparent hover:border-fuchsia"
        }`}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path
            d="M2 5.2 L4 7.2 L8 3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Title — clipped to one line, mono uppercase to match cockpit voice. */}
      <span
        className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-[0.10em] text-text-secondary"
        title={clip.title}
      >
        {clip.title || "(untitled)"}
      </span>

      {/* Per-window channel binding — drives Master Schedule fan-out. */}
      <div data-slot="account-binding" className="shrink-0">
        <AccountBindingChip windowId={windowId} />
      </div>

      {/* Close window — confirms when the recently-edited heuristic fires. */}
      <button
        type="button"
        onClick={handleClose}
        aria-label="Close this window"
        title="Close this window"
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-text-tertiary hover:bg-fuchsia-soft/40 hover:text-fuchsia"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path
            d="M2 2 L8 8 M8 2 L2 8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <ConfirmDialog
        open={confirmOpen}
        title="Close this window?"
        body="You have recent caption edits on this clip. Closing the window keeps the saved bake on disk, but in-flight drafts inside the captions drawer are lost."
        confirmLabel="Close window"
        cancelLabel="Keep open"
        tone="destructive"
        onConfirm={() => {
          setConfirmOpen(false);
          removeWindow(windowId);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
