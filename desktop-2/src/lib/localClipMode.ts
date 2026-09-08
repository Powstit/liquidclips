/**
 * Local-upload Automatic/Manual mode · single source of truth
 *
 * 2026-09-08 · local-upload drag/drop mode-propagation follow-up.
 *
 * `chooseOwnClips` (InlineCreatePanel.tsx's upload-tab toggle) is the
 * user-facing control — same boolean, same semantics, same
 * sticky-across-"+"-cycles behavior already documented at its own
 * declaration. It used to live as a plain module-level `let` inside
 * InlineCreatePanel.tsx, which was fine as long as the only local-ingest
 * entry point that needed to read it was InlineCreatePanel's own "Pick
 * file" button (same file, same closure).
 *
 * DropOverlay.tsx is a second, independent entry point — a completely
 * separate, always-mounted, window-level drag/drop listener with no
 * props/context link to InlineCreatePanel — that also feeds the same
 * `source:drop` channel. Without a shared place to read the CURRENT
 * mode preference from, a raw drag/drop had no way to know the user had
 * switched the toggle to Manual, and always defaulted to Automatic.
 *
 * Not a new state machine: extracting the same value into its own tiny
 * module lets both emitters read/write ONE source of truth without one
 * importing the other's internals. InlineCreatePanel.tsx still owns the
 * only UI that sets it.
 */

export type LocalClipMode = "automatic" | "manual";

let activeMode: LocalClipMode = "automatic";

export function getLocalClipMode(): LocalClipMode {
  return activeMode;
}

export function setLocalClipMode(mode: LocalClipMode): void {
  activeMode = mode;
}
