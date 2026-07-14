# journey.j007-my-clips · My Clips grid · reveal · copy · open

## Purpose

After j006-clip-generation lands one or more clips into
`session.project.clips`, the customer navigates to the Workstation
route (the canonical "My Clips" surface today) and:

- sees a ClipCard grid (one card per clip);
- opens Finder to reveal the underlying file;
- copies the absolute file path to the clipboard;
- opens the clip in the built-in preview / editor.

j007 is the M2 (Revenue) verification step — the customer must be
able to prove to themselves that the render happened, before they
paste the file into their scheduler or submit to a Whop reward.

## Owning capability

`capability.clipping-engine.my-clips`

## Mission fingerprint

`[M2]`

- **M2 (Revenue):** every submitted / posted clip flows through
  this surface first. A broken reveal / copy / open blocks the
  clipper from proving the work is real, which blocks the paid
  submission.

## Prerequisites

- User is authenticated (`hasJwt === true`).
- `EngineSessionProvider` mounts `session.project` with a
  non-empty `clips` array.
- Tauri shell present for the reveal-in-Finder affordance (browser
  preview shows a fallback copy of the absolute path).

## Entry conditions

- `session.project?.clips.length >= 1`.
- User navigates to the Workstation route (`route:"workstation"`).

## Exit conditions (success)

- Grid renders one ClipCard per clip.
- Each ClipCard exposes:
  - **thumbnail** (`vertical_path` OR fallback);
  - **title** (LLM-judged, from `clip.title`);
  - **duration** (from `clip.duration_s` OR derived `end - start`);
  - **absolute file path** (`clip.cut_path` / `clip.vertical_path`)
    accessible via a reveal action AND a copy affordance;
  - **open action** that emits `clip:open-edit {clipIdx}`.
- User clicks reveal → `clip.reveal_in_finder` fires → Finder opens
  to the file.
- User clicks copy → `clip.copy_path_to_clipboard` fires → clipboard
  contains the absolute path.
- User clicks open → `clip:open-edit` fires → focused clip loads in
  the CockpitDock preview shell.

## Exit conditions (drift)

- `session.project.clips.length === 0` → `ws-zero-candidates` state
  renders instead of the grid.
- Focused clip has `cut_path === null` AND `vertical_path === null`
  → the reveal + copy actions are disabled with a plain-English
  hint ("File path not ready yet"). This is an honest empty state,
  not a lie.

## Stations (ordered)

### station.my-clips.grid-rendered

- **Responsible system:** `feature.workstation-grid`.
- **Source code node:** `desktop-2/src/design-os/routes/Workstation.tsx`
  → `<ClipsGrid />` inside `.lc-ws-body`.
- **DOM seams:**
  - `[data-testid="ws-split-workbench"]` on the workbench root.
  - `[data-testid="clip-card"][data-clip-idx]` on each ClipCard.
  - `[data-testid="clip-card-title"]` on the title node.
  - `[data-testid="clip-card-duration"]` on the duration node.
  - `[data-testid="clip-card-thumb"]` on the thumb container.
  - `[data-testid="clip-card-reveal"]` on the reveal button.
  - `[data-testid="clip-card-copy-path"]` on the copy button.
  - `[data-testid="clip-card-open"]` on the open action.
- **Expected input:** `session.project.clips` array with ≥1 entry.
- **Expected event ordering:**
  - `my_clips_grid_rendered {clip_count, first_clip_slug}` fires
    once on mount (existing event via CockpitProvider mount).
- **Success signal:** number of `[data-testid="clip-card"]` elements
  matches `chromeClipCount`.
- **Failure outcome:** grid empty despite `clips.length >= 1` →
  regression; blocks the paid submission.
- **Regression test:** `desktop-2/src/routes/my-clips/my-clips.journey.test.ts::renders-3-seeded-clips-with-affordances`.

### station.my-clips.user_action_reveal

- **Responsible system:** `feature.clip-card-reveal`.
- **Source code node:** ClipCard reveal button handler emits
  `clip.reveal_in_finder`.
- **Expected input:** focused clip has a non-null
  `cut_path | vertical_path`.
- **Expected customer-visible state:** OS "Show in Finder" opens
  in Tauri; browser preview shows a toast with the absolute path
  and a "Copy path" shortcut.
- **Expected event ordering:**
  - `clip_reveal_in_finder_clicked {clip_idx, path_hash}` fires.
- **Success signal:** telemetry fires + the Tauri `open_in_finder`
  command returns.
- **Failure outcome:** file has been deleted since the render →
  Finder opens to the enclosing directory; the seam surfaces the
  degradation with a warning toast.

### station.my-clips.user_action_copy_path

- **Responsible system:** `feature.clip-card-copy-path`.
- **Source code node:** ClipCard copy button handler emits
  `clip.copy_path_to_clipboard`.
- **Expected input:** focused clip has a non-null
  `cut_path | vertical_path`.
- **Expected customer-visible state:** "Copied ✓" badge briefly
  replaces the "Copy path" button.
- **Expected event ordering:**
  - `clip_copy_path_clicked {clip_idx, path_length}` fires.
- **Success signal:** `navigator.clipboard.writeText(absPath)`
  resolves; badge flashes.
- **Failure outcome:** clipboard rejects → toast with the honest
  reason.

### station.my-clips.user_action_open

- **Responsible system:** `feature.clip-card-open`.
- **Source code node:** ClipCard open action emits
  `clip:open-edit {clipIdx}`.
- **Expected input:** clip idx of the clicked card.
- **Expected customer-visible state:** CockpitDock preview shell
  focuses the clip; StageRail shows the clip inspector.
- **Expected event ordering:**
  - `clip:open-edit {clipIdx}` bus event fires.
  - `Workstation.tsx::useEvent("clip:open-edit", …)` updates
    `focusedClipIdx` and calls `selectClipForStudio(clipIdx)`.
- **Success signal:** focus state updates; inspector panel renders.

## Expected telemetry per station

| Topic | Where fired | Payload | Persistence today |
|---|---|---|---|
| `my_clips_grid_rendered` | Workstation mount effect | `{clip_count, first_clip_slug}` | stdout-only |
| `clip_reveal_in_finder_clicked` | ClipCard reveal handler | `{clip_idx, path_hash}` | stdout-only |
| `clip_copy_path_clicked` | ClipCard copy handler | `{clip_idx, path_length}` | stdout-only |
| `clip:open-edit` (bus event, not lcDiag) | ClipCard open handler | `{clipIdx}` | in-memory bus |

## Backend endpoint gap · `GET /me/clips`

**Status:** NOT wired.

The canonical source of truth for the clip grid is the frontend
`session.project.clips` array — a single project's clip list held
by `useEngineSession`. There is NO `GET /me/clips` endpoint on
`junior-backend/app/routes/me.py` (grep the module: only `/me`,
`/me/lc-id/claim`, `/me/affiliate` exist as of this commit).

**Consequence:** a hard reload of the app clears the session · the
clip grid empties · the user's previously-rendered clips are still
on disk but the app cannot list them.

**Documented gap:** `gap:j007-me-clips-endpoint` — P4-owed schema
migration + endpoint + persistence layer. Not blocked on Train C3
(Train C3 documents the gap and asserts the current
`session.project.clips` contract).

## Acceptance test IDs

- `desktop-2/src/routes/my-clips/my-clips.journey.test.ts`
  - `renders-3-seeded-clips-with-affordances`
  - `reveal-click-fires-telemetry`
  - `copy-click-fires-telemetry`
  - `open-click-fires-bus-event`
  - `zero-clips-renders-zero-candidates-state`

## Current status

AMBER

- Frontend grid renders correctly against `session.project.clips`.
- Reveal / copy / open affordances present and telemetry wired.
- Backend `GET /me/clips` deferred (documented gap above).
- Auto-hydrate of clip grid on cold app boot is BLOCKED on the gap.

## Last verified

`2026-07-12 · <commit-sha> · Train C3 dispatch`

## Known bugs blocking

- BC-004 (unowned journey) · closed with this commit for j007.
- BC-005 (state observability) · progress noted; `GET /me/clips`
  persistence would give HQ a real-time "clips per user" tile.

## Recovery / degrade path

- No clips yet → `ws-empty` state · CTA points back at CreateClips.
- Run finished, zero clips → `ws-zero-candidates` state · honest
  copy · CTA "Drop a new source".
- File path missing → reveal / copy disabled with plain-English
  hint.
- Clipboard denied → toast with reason, no fake "Copied ✓".

## HQ dashboard

- Once `gap:j007-me-clips-endpoint` closes, an HQ "Clips per user"
  tile becomes possible.
- Journey Map tab surfaces j007 status.

## Notes

- The Design-OS Library route
  (`desktop-2/src/design-os/routes/Library.tsx`) is currently a
  thin honest-stub that redirects to Workstation and is explicitly
  BUG-042's "honest stub" — do NOT re-purpose it as a second My
  Clips grid; it exists to communicate "coming soon" while the
  backend endpoint is unbuilt.
- Workstation is the canonical My Clips surface today per BUG-042.
- j007 does NOT own the export / submit / publish flow — those
  are downstream journeys (j011 · j013 · submit-to-whop).
