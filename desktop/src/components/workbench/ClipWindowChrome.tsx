// SURFACE: Workbench tile chrome
// MAP TAGS: (S "select for batch") tick checkbox | (O #1) truncated title
//           (O #2) AccountBindingChip avatars/dot
// See docs/UI_MAP_workbench.md — the contract.
//
// One-row chrome bar above every ClipWindow. Never wraps. NO Close X (per
// Cut list: "Per-tile Close X button — creates 12 destructive buttons one
// click away — moved to Cmd-Backspace + right-click"). NO clip number, NO
// theme tag, NO time range, NO LC score in the chrome — the LC score + why
// microcopy is hover-only on the poster, owned by ClipWindowPoster.
//
// Focused-only fuchsia bracket corners are retained — they're (O #1) "I
// want to see what each clip is" cockpit-language proof that this tile is
// active, not chrome decoration.
//
// Removal of a tile happens via:
//   • Cmd-Backspace on focused tile (WindowManager keydown owner)
//   • Right-click → "Remove" (WindowManager context menu)
// Neither path lives in the chrome anymore.

import { useWorkbenchStore } from "./useWorkbenchStore";
import { AccountBindingChip } from "./AccountBindingChip";
import type { Clip, WindowId } from "./types";

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
  const toggleSelected = useWorkbenchStore((s) => s.toggleSelected);

  function handleTick(e: React.MouseEvent) {
    e.stopPropagation();
    toggleSelected(windowId);
  }

  return (
    <div
      className="relative flex h-7 items-center gap-2 border-b border-line bg-paper px-2.5"
      data-window-id={windowId}
      data-focused={focused ? "true" : "false"}
    >
      {/* Fuchsia HUD bracket corners — focused-only. */}
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
    </div>
  );
}
