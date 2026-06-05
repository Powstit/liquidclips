# Claude Spec — Reaction Suite Launch Blocker

Date: 2026-06-04
Owner: Daniel / Codex scope
Status: spec only, ready for Claude to implement
Priority: launch-blocking

## Why This Is Blocking

Daniel is right: the current reaction suite does not feel powerful. It feels like a file/source picker bolted onto the clip card. That is not launch quality.

The product promise is:

> Pick a clip, add a funny reaction, stack/split/PiP it, preview it, ship it.

Current reality:

- the picker says `overlay`, while the product concept is `reaction`
- reaction sources do not play inside the picker
- stack/split/PiP cells are read-only blocks, not independently previewable
- user cannot clearly see main clip vs reaction clip before render
- action labels mix `b-roll`, `overlay`, and `reaction`
- GIPHY/Pexels/Pixabay are wired, but the UI does not yet feel like a reaction engine
- controls are visually too small/ambiguous and need real icon treatment

Do not launch the reaction suite until this is fixed.

## Product Goal

Build a real **Reaction Editor V1**.

The user journey should feel:

1. Pick where the reaction goes.
2. Pick the reaction source.
3. Preview main and reaction independently.
4. Preview/apply final render.
5. Switch layouts without starting over.

The editor should feel more like a compact pro video tool than a settings modal.

## UX Language Rules

Use one vocabulary everywhere:

- Use `reaction`
- Do not use `b-roll`
- Do not use `overlay` in visible UI
- `overlay` can remain in backend/internal code for now

Replace:

- `Where's the overlay coming from?` → `Pick a reaction clip`
- `Change b-roll` → `Change reaction`
- `Remove b-roll` → `Remove reaction`
- `B-roll audio` → `Reaction audio`
- `side-by-side controls` → `Reaction controls`
- `b-roll rendered` → `Reaction applied`

## Design Direction

Dark, compact, editor-grade.

Use:

- dark panel surfaces
- fuchsia only for active/primary states
- clear icon + label buttons
- small video panes
- segmented controls
- minimal copy
- no long explanatory paragraphs

The current picker is too modal-heavy and text-heavy. Keep the modal if needed, but make it feel like a media browser.

## Icon Requirement

Create dedicated icons for the reaction controls. Use `lucide-react` where possible. If lucide has no exact match, create small local SVG/icon components that match the existing line-icon style.

Required controls:

- `Full`
  - icon: single rectangle / `Maximize2`
- `Stack below`
  - icon: two horizontal panels, main top/reaction bottom
- `Stack above`
  - icon: two horizontal panels, reaction top/main bottom
- `Split left`
  - icon: two vertical panels, reaction left/main right
- `Split right`
  - icon: two vertical panels, main left/reaction right
- `PiP right`
  - icon: main frame + inset bottom-right
- `PiP left`
  - icon: main frame + inset bottom-left
- `Play source`
  - icon: `Play`
- `Pause source`
  - icon: `Pause`
- `Search reactions`
  - icon: `Search`
- `Upload reaction`
  - icon: `Upload`
- `Apply reaction`
  - icon: `WandSparkles` or `Sparkles`
- `Remove reaction`
  - icon: `X`
- `Main audio`
  - icon: `Volume2`
- `Reaction audio`
  - icon: `MessagesSquare` / `AudioLines`
- `Muted`
  - icon: `VolumeX`

Existing `LayoutIcon.tsx` can be improved or replaced, but the visual language must match the rest of the app.

## Required UI Structure

In `ClipPreview.tsx`, restructure the reaction area into four sections.

### 1. Final Preview

Left panel remains the large output preview.

It should clearly display:

- original clip if no reaction applied
- rendered reaction output if applied
- busy state while rendering

After render, preview should switch to `clip.overlay.applied_paths[ratio]`.

### 2. Layout Strip

Create a proper layout strip near the top of the right panel.

Controls:

- Full
- Stack below
- Stack above
- Split left
- Split right
- PiP right
- PiP left

Each control:

- icon + short label
- active state
- tooltip/title
- does not force re-pick if `clip.overlay.source_path` exists

Changing layout should reuse the existing reaction source.

### 3. Cell Preview

Replace the current read-only `LayoutCellDiagram` experience with a playable cell preview.

Create something like:

- `ReactionCellPreview.tsx`
- or upgrade `LayoutCellDiagram.tsx`

It must show:

- `Main clip`
  - playable mini video
  - filename/title
  - audio badge if main audio selected
- `Reaction clip`
  - playable mini video if selected
  - empty state if missing
  - `Pick reaction` button
  - audio badge if reaction audio selected

For Stack/Split layouts, show both cells as actual video cards, not abstract blocks.

For PiP layouts, still show two cards:

- Main
- Inset reaction

Do not attempt true live composite preview in the browser for V1 unless trivial. The rendered output remains the source of truth after Apply.

### 4. Reaction Source Browser

The picker needs to feel like a media browser.

Current file:

- `OverlaySourcePicker.tsx`

Either rename later or leave filename for low-risk, but visible UI must say `reaction`.

Tabs/sections:

- `This project`
- `GIPHY`
- `Pexels`
- `Pixabay`
- `Upload`

Default provider:

- GIPHY

Provider rules:

- Keep GIPHY results in their own lane.
- Do not merge GIPHY with Pexels/Pixabay results.
- Show `Powered by GIPHY` when on GIPHY.
- Show provider attribution for Pexels/Pixabay.

Every result card must include:

- visual preview
- play/preview affordance
- provider badge
- title
- author/source if available
- `Use reaction` action

For GIPHY:

- use animated preview if available
- selected item downloads MP4 via sidecar before applying

For project clips:

- show playable thumbnails/video previews, not static cards only

For upload:

- clear button: `Choose reaction file`

## Audio Controls

Replace current labels with a segmented control:

- `Main`
- `Reaction`
- `Muted`

Use icons:

- `Volume2` for Main
- `AudioLines` or equivalent for Reaction
- `VolumeX` for Muted

Default:

- Main

Persist to existing `audio_source` backend field:

- UI `Main` → backend `main`
- UI `Reaction` → backend `broll`
- UI `Muted` → backend `muted`

Visible UI should never say `broll`.

## Timing Controls

Keep V1 simple:

- Start offset slider
- label: `Reaction starts at 0.0s`
- buttons:
  - `Start at beginning`
  - `Reset`

Do not add complex trim handles yet.

## Backend Scope

Current backend is acceptable for V1:

- one reaction source per clip
- stack/split/PiP layouts
- output stored under `clip.overlay.applied_paths`

Do not attempt multi-source/per-cell backend rendering in this pass unless it is already almost done.

Backend file:

- `desktop/python-sidecar/stages.py`

Keep:

- `apply_overlay_to_clip`
- `OVERLAY_TYPES`
- `audio_source` values

Only change backend if needed for:

- clearer errors
- validation of downloaded provider MP4s
- stable output paths
- ensuring imported clips and generated clips both render reactions

## Provider Keys Already Wired

The following keys are supported through sidecar Keychain storage:

- `GIPHY_API_KEY`
- `PEXELS_API_KEY`
- `PIXABAY_API_KEY`

Relevant files:

- `desktop/python-sidecar/secrets_store.py`
- `desktop/python-sidecar/sidecar.py`
- `desktop/src/lib/sidecar.ts`

The React layer must not read raw values. Sidecar performs provider calls.

## Files To Touch

Likely required:

- `desktop/src/components/ClipPreview.tsx`
- `desktop/src/components/OverlaySourcePicker.tsx`
- `desktop/src/components/clips-feed/LayoutCellDiagram.tsx`
- `desktop/src/components/clips-feed/LayoutIcon.tsx`
- `desktop/src/components/clips-feed/layout-cells.ts`
- `desktop/src/lib/sidecar.ts`
- `desktop/src/lib/mock-sidecar.ts`

Only touch backend if required:

- `desktop/python-sidecar/stages.py`
- `desktop/python-sidecar/sidecar.py`

Avoid touching:

- `.github/workflows/release.yml`
- `desktop/src-tauri/tauri.conf.json` version field
- release tags/secrets

## Acceptance Criteria

This must all pass before launch:

1. Generated clip opens editor.
2. Imported/uploaded clip opens editor.
3. User can select Stack below.
4. User can pick a project clip as reaction.
5. User can preview the reaction source before applying.
6. User can apply reaction.
7. Main preview switches to rendered output.
8. User can switch Stack → Split → PiP without re-picking the source.
9. User can select Main / Reaction / Muted audio.
10. User can remove reaction and return to original.
11. GIPHY tab defaults first.
12. Missing GIPHY key shows a clean Settings/API-key CTA.
13. Pexels/Pixabay remain fallback tabs.
14. No visible UI says `b-roll`.
15. No visible UI says `overlay`.
16. Layout controls use icons.
17. Source result cards can preview/play.
18. The editor feels coherent at 1280x820 and does not overflow.
19. `python3 -m py_compile desktop/python-sidecar/*.py` passes.
20. `npx tsc -b --pretty false` passes.

## Manual Smoke Script

Use one generated project and one imported clip pack.

Generated project:

1. Open clip 01.
2. Select `Split right`.
3. Pick clip 02 from same project.
4. Preview reaction source.
5. Apply reaction.
6. Confirm final preview plays split render.
7. Switch to `Stack below`.
8. Confirm same reaction source is reused.
9. Set `Reaction audio`.
10. Apply.
11. Remove reaction.

Imported clip:

1. Open imported clip.
2. Select `PiP right`.
3. Search GIPHY `funny reaction`.
4. Pick result.
5. Confirm download to `~/LiquidClips/Reaction Library/downloaded/`.
6. Apply.
7. Confirm preview plays rendered output.

## Design Bar

Daniel is a perfectionist and the current UI feels off. Do not ship a technically-working but visually awkward version.

The editor must read as:

> Liquid Clips has a reaction studio.

Not:

> Liquid Clips has a file picker that runs ffmpeg.

