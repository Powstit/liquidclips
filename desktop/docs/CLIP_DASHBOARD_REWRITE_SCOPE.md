# Clip Dashboard Rewrite — scope for Kimi

**Source:** Daniel, 2026-06-08 walking v0.7.17.
**Owner:** Kimi (Daniel: "kimi fix should be able to do this").
**Branch off:** `main` after this scope lands.
**Ship target:** v0.7.18.

## Daniel's verbatim brief

> "add a clip needs to duplicate a window right now its askes undeed question titke duration 2. i do not like the buttons underneath the clip needs a complete change so it feels liks a proper dashabord. can we move controls to their own mini dashabord underneath that can control all clips we add"

## Three concrete changes

### 1. Add a clip → duplicate (no modal)

**Current:** `AddClipCard` opens `AddClipDialog` asking for Title + Duration, calls `sidecar.addClip(slug, start, end, title)` which requires a transcript and runs the full cut → reframe → thumbs pipeline.

**Target:** Tapping the "+" tile **duplicates the last (or focused) clip** instantly. No modal. The duplicate inherits everything from the source clip, gets a new slug like `{slug}-v2`, and reuses the existing rendered MP4 paths (no re-cut — instant).

**Files**
- New sidecar RPC: `python-sidecar/sidecar.py` → `method_duplicate_clip(slug, source_idx)` — copies the clip dict, mutates slug + title (`"{title} (copy)"`), reuses `cut_path` / `vertical_path` / `square_path` / `portrait_path` / `srt_path` / `vtt_path` / `thumbnails` / `captions_burned`. Appends to `project.clips`. Returns `{project}`.
- New TS wrapper: `src/lib/sidecar.ts` → `duplicateClip(slug, sourceIdx)`.
- `src/components/AddClipCard.tsx` → strip the dialog entirely. The button calls `sidecar.duplicateClip(project.slug, sourceIdx)` where `sourceIdx` is the LAST clip with a rendered `vertical_path` (use the existing `firstRenderedClipIdx` pattern from `ResultsGrid` but `findLastIndex`).
- If the project has zero rendered clips, the tile disables itself with hover hint "Render at least one clip first."

**Acceptance**
- Single click on "+" tile → new card appears at end of grid within 1s.
- New clip plays the same MP4 as source (use the same `vertical_path`).
- Slug is unique even after multiple duplicates (`-v2`, `-v3` etc.).
- No transcript required — the duplicate path doesn't touch `stage_reframe`.

### 2. Delete per-card InlineScheduler

**Current:** Each `ClipCard` mounts its own `<InlineScheduler clip={clip} />` (line 578 of `ClipCard.tsx`) which renders the channel picker / caption / when row / Schedule button **under every clip**. That's what Daniel called "annoying buttons under the clip".

**Target:** Remove the mount entirely. The card surfaces just the clip preview, the title, the captions chip, the platform badges, and the multi-select checkbox. No scheduler.

**Files**
- `src/components/clips-feed/ClipCard.tsx` — delete the `<InlineScheduler>` import + JSX block (look for the `existing InlineScheduler (no modal)` comment ~line 566). Keep the `Caption` chip and `PlatformBadge` mounts; they still pair well with the new dashboard.
- `src/components/clips-feed/InlineScheduler.tsx` — leave the file for now (some flows may still reference it; phase its deletion in v0.7.19 after the dashboard hardens).

**Acceptance**
- ClipCard renders cleanly without the under-clip channel/caption/when/schedule chrome.
- Grid layout still reads correctly with the shorter cards.

### 3. Promote GridMasterToolbar to persistent bottom dashboard

**Current:** `GridMasterToolbar` floats above the grid **only when `selected.size > 0`** (`ResultsGrid.tsx:312`). It already has Schedule / Publish / Caption / Ratio / Layout popovers and applies actions across the selection.

**Target:** Make the master toolbar **always visible** as a bottom-anchored dashboard bar (`fixed bottom-0 left-0 right-0`, like a Photoshop tool palette). Behaviour:

- **No selection** → toolbar shows the **all-clips** target. "Schedule" → schedules every clip. Caption / Ratio / Layout apply to all.
- **Selection > 0** → toolbar shows the **selected-clips** target (current behaviour). Same actions, narrower scope.

A small "N clips" / "selected N of M" pill on the left of the toolbar tells the user the current target.

**Files**
- `src/components/clips-feed/GridMasterToolbar.tsx`
  - Remove the `selected.size > 0` parent gate (always render).
  - Accept an additional prop: `mode: "all" | "selected"`. When mode is `all`, `selectedIdxs` is computed from `project.clips.map((_, i) => i)`.
  - Add the left target-pill: `"All N clips"` or `"N of M selected"`. Click toggles between modes (clearing selection switches back to `all`).
  - Restyle the bar: anchored to the bottom, dark glass background (`bg-paper-deep/85 backdrop-blur-xl border-t border-line/40`), 56-64px tall, pill controls aligned in a row.
- `src/components/ResultsGrid.tsx:312` — drop the `selected.size > 0 &&` gate, always render `<GridMasterToolbar mode={selected.size > 0 ? "selected" : "all"} ... />`. Add `pb-20` (or matching px) to the grid container so the bottom row of cards isn't covered by the bar.

**Acceptance**
- Toolbar visible on the results view regardless of selection.
- "Schedule" with zero selection → applies to all clips, toast confirms `"Scheduled 12 of 12 clips"`.
- "Schedule" with selection → applies to the selection only.
- The under-clip space is empty — no leftover scheduler chrome.

## Out of scope for this rewrite

- Keep `InlineScheduler.tsx` on disk; don't delete the file in this PR.
- Don't touch `Workbench` (that surface was killed in v0.7.13).
- Don't touch the imported-clip path or `LibraryQuickPreview`.
- The lens findings from yesterday's import-path audit (S1 missing-source, S2 poster onError, S3 dropError tone, S4 drag-drop import) stay for a separate sprint.

## Constraints (mandatory)

- `cd desktop && npx tsc --noEmit` exit 0
- `cd desktop && bash scripts/check-humanError.sh` exit 0
- `cd desktop && python3 -m py_compile python-sidecar/sidecar.py` exit 0
- Every `catch (e)` uses `humanError(e)` — never `String(e)` / `e.message`
- Run the ship-lens-reviewer agent on the diff before claiming done. `docs/ship-lens-review.json` must show `verdict: "PASS"` and `unaddressed_p0_p1: 0`.
- Run `bash desktop/scripts/ship-gate.sh` — exit 0 required.
- Bump patch version (`scripts/bump_patch.sh`) before the final commit.
- Do NOT push.

## Lens — apply ship-lens phase 2 to the new dashboard

The bottom dashboard renders against **every** clip in the project. Inventory its data states upfront so Kimi catches the same silent-empty-render strand we caught on imports:

| State | Render handling |
|---|---|
| `project.clips.length === 0` | Dashboard hides; no actions exposed against empty set |
| All-clips mode, zero renderable (no `vertical_path`) | Schedule + Publish + Caption disabled with hint "Render at least one clip first" |
| Selected-mode, selection drops to zero mid-action | Action continues against the snapshot it captured at dispatch (existing GridMasterToolbar behaviour — preserve) |
| All-clips mode with 100+ clips | `"All 100 clips"` pill stays readable; action toast pages through summary |
| Duplicate appended → new clip lacks a transcript | Caption action against the duplicate falls back to the source clip's caption — no error |

## Memory hooks (write these after ship)

- Project memory: "v0.7.18 — per-clip InlineScheduler removed, all controls on bottom MasterDashboard. Add-Clip is now duplicate-clip."
- Feedback memory: "When Daniel says the controls feel 'annoying under the clip', he means the per-clip InlineScheduler. The fix is a global bottom dashboard."

## File checklist for Kimi

```
desktop/python-sidecar/sidecar.py                          (new RPC)
desktop/src/lib/sidecar.ts                                 (new wrapper)
desktop/src/components/AddClipCard.tsx                     (rewrite)
desktop/src/components/clips-feed/ClipCard.tsx             (delete InlineScheduler mount)
desktop/src/components/clips-feed/GridMasterToolbar.tsx    (mode prop + persistent bottom)
desktop/src/components/ResultsGrid.tsx                     (drop gate, pb-20)
```

Six files. No new components. No new packages.
