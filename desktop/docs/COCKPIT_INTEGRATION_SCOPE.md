# Cockpit ⇄ ClipPreview integration — ship-lens scope

The cockpit demo was being built in isolation. Daniel is right that this risks breaking the real edit flow. This scope reconciles the cockpit with the **existing** editing surfaces — `ClipPreview`, `Reaction Studio`, `OverlayTemplateGallery`, `CaptionDrawer` — so the whole thing reads as one connected panel, not two competing UIs.

**Goal:** the cockpit handles BULK + STATUS. ClipPreview handles PER-CLIP DEEP EDIT. They share state cleanly with no duplication.

---

## What already exists in the codebase (we DON'T rebuild)

| Surface | File | Owns |
|---|---|---|
| **ClipPreview** | `src/components/ClipPreview.tsx` | Per-clip modal editor — title, description, pinned-comment, broll-offset, audio-source, layout, ratio, reaction picker |
| **Reaction Studio** | inside ClipPreview line 822-860 | The 7-tile labeled picker (Full · Stack below · Stack above · Split left · Split right · PiP right · PiP left). Daniel's reference screenshot IS this. |
| `LAYOUTS` array | `src/components/clips-feed/LayoutIcon.tsx:87-95` | Canonical layout key + label catalogue |
| **applyLayout** | `ClipPreview.tsx:362` | Calls sidecar.applyOverlayTemplate, persists `clip.overlay` |
| **OverlayTemplateGallery** | `src/components/OverlayTemplateGallery.tsx` | The 8-template gallery (already mounted in ClipPreview v0.7.15) |
| **CaptionDrawer** | `src/components/captions/CaptionDrawer.tsx` | Per-clip caption fine-edit (text + style + position + word-level) |
| **PlatformBadgePicker** | `src/components/PlatformBadge.tsx:70` | Per-clip platform routing |
| Open flow | `ResultsGrid.tsx:338` `onOpenEditor={() => setPreviewIdx(idx)}` | Click card → modal |

**Existing tile style** (Reaction Studio at `ClipPreview.tsx:840-857`):
```tsx
<button className={`flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-lg border px-1.5 py-2 transition-all ${
  active ? "border-fuchsia bg-fuchsia text-white shadow-[var(--glow-sm)]"
         : "border-line bg-paper text-ink hover:border-fuchsia hover:bg-fuchsia-soft/20"
} disabled:opacity-50`}>
  <LayoutIcon kind={item.key} />
  <span className="font-sans text-[10px] font-medium">{item.label}</span>
</button>
```

This IS the reference shot. Copy it verbatim.

---

## What the cockpit Frame module DOES

The cockpit Frame module is a **bulk gateway** to the existing edit surfaces. It does three things, in order of priority:

1. **Shows current state** — `[9:16 · PiP right]` in the eyebrow value, so the clipper sees what's applied to the target.
2. **Bulk-applies common settings** — ratio segmented + the 7 layout tiles (same `LAYOUTS` array, same `LayoutIcon`, same `applyLayout` RPC, same active visual). Tapping a tile calls `applyLayout` for every clip in the target.
3. **Drills into the deep editor** — an "Edit this clip ▸" affordance that opens ClipPreview on the focused clip, scrolled to the Reaction Studio section. Available when `target.size === 1`.

The cockpit Frame module DOES NOT:
- Re-implement the layout state — it reads `clip.overlay.layout` from each target clip
- Re-implement the layout RPC — it calls the same `applyLayout` ClipPreview calls
- Re-implement the audio/offset/reaction-video controls — those live in ClipPreview, opened via "Edit this clip ▸"
- Render its own preview video — the focused clip's poster in the cockpit is read-only; the playable preview lives in ClipPreview

This isolation is the contract: cockpit Frame = bulk + status; ClipPreview = deep edit.

---

## PHASE 1 — DESIGN (every element earns its place)

Cockpit Frame module:

| Element | Tag | Reason |
|---|---|---|
| Module icon (Layers) | **N** | Workspace tile-archetype anchor |
| Module title "Frame" | **N** | Section name |
| Eyebrow `[ {ratio} · {layout-label} ]` | **O** | Status answer without leaving cockpit |
| Sub `ratio ▸ overlay ▸ cover` | **N** | Mono terminal sub |
| Ratio segmented (9:16 / 1:1 / 4:5) | **O** | Bulk ratio set |
| 7 layout tiles (Full / Stack below / Stack above / Split left / Split right / PiP right / PiP left) | **O** | Bulk layout set + visual status |
| "Edit this clip ▸" affordance | **O** | Drill into ClipPreview for the focused clip |

Cuts vs current demo:
- The 8-template OverlayTemplateGallery row I added (`pip-br`, `react`, `frame`, `captions`, etc.) **conflicts** with the 7-LAYOUT canonical set. **Cut the 8-template row.** Use only the 7 `LAYOUTS`. (The OverlayTemplateGallery still exists for the per-clip gallery picker accessible from ClipPreview; cockpit doesn't need a second one.)

---

## PHASE 2 — STATE (every shape rendered)

Per-clip data the cockpit reads:
- `clip.overlay.layout: LayoutKey` (defaults to `"none"` = Full)
- `clip.ratio: RatioKey` (defaults to `"vertical"` = 9:16)
- `clip.overlay.source_path` (reaction video; may be `null`)
- `clip.overlay.audio_source: "main" | "broll" | "muted"` (set in ClipPreview, displayed but not editable from cockpit)
- `clip.overlay.start_offset_s` (set in ClipPreview)

State variants the cockpit Frame module renders:

| State | Visual handling |
|---|---|
| All target clips share layout + ratio | Both tile + segmented show active; eyebrow `[ 9:16 · PiP right ]` |
| Target clips have mixed layouts | No tile is active; eyebrow `[ 9:16 · mixed layout ]` (cyan); tap any tile = "apply to all 5" (confirms via toast) |
| Target clips have mixed ratios | Ratio segmented shows "—"; eyebrow `[ mixed ]` |
| Single clip target + layout is e.g. PiP right but no `overlay.source_path` | Tile shows active; eyebrow appends "(no reaction yet)" in mono; tile click opens ClipPreview's Reaction Cell Picker |
| Free tier | Reaction layouts disabled past the first (lock icon); tile click opens UpgradeModal instead of applying |
| Sidecar encoding the reframe (after layout change) | Tile shows a tiny `working-shimmer` strip; cockpit disables further layout taps until done |

---

## PHASE 3 — JOURNEY (per-state walk)

**State: 5 clips selected, all currently "Full" layout, ratio 9:16**
- ENABLES: clipper taps "Stack below" → 5 clips apply that layout, toast confirms "Layout set: stack below · 5 clips."
- PREVENTS: silent partial apply — `Promise.allSettled` + per-clip failure toast row.
- BREAKS: nothing.
- STRANDS: ⚠️ if any clip has no reaction source video, that clip's layout still sets but the rendered frame stays "Full" until source is added. Need to surface this. Solution: after bulk apply, toast says "Set on 5 clips · 2 still need a reaction video [Add ›]" → opens ClipPreview for the first such clip.

**State: 1 clip selected, layout = PiP right, source video present**
- ENABLES: tap "Edit this clip ▸" → ClipPreview modal opens, scrolled to Reaction Studio section.
- PREVENTS: full-blown editor opening when bulk-editing many clips at once.
- BREAKS: nothing.
- STRANDS: none.

**State: 3 clips selected with mixed layouts (PiP right + Stack below + Full)**
- ENABLES: cockpit shows `[ 9:16 · mixed layout ]`; clipper taps a tile → all 3 apply same; toast says "Applied stack below to 3 clips · was mixed".
- PREVENTS: "what did I just override?" — toast explicitly names the "was mixed".
- BREAKS: nothing.
- STRANDS: ⚠️ if clipper wants to keep the mix and only change ratio, they can: ratio segmented is independent of layout tiles.

**State: cockpit Frame tile tap while target.size === 0 (All mode, 9 clips)**
- ENABLES: bulk apply across all 9.
- PREVENTS: empty-set apply.
- BREAKS: nothing.
- STRANDS: confirm dialog for `target.size > 5` — "Apply Stack below to all 9 clips? [Apply] [Cancel]" so a tap doesn't surprise-mutate 100 clips.

**State: free tier + clipper taps anything but "Full"**
- ENABLES: UpgradeModal opens.
- PREVENTS: silent gate.
- BREAKS: nothing.
- STRANDS: none.

**State: reaction video swap mid-edit (clipper changes source_path in ClipPreview while cockpit is open)**
- ENABLES: cockpit re-renders on next `onProjectChange` cycle, picks up new state.
- PREVENTS: stale cockpit values after returning from ClipPreview.
- BREAKS: nothing.
- STRANDS: none — already wired via existing `onProjectChange` cascade.

---

## MANDATORY RULE — reviewer + ship-gate

When Kimi implements this:
1. `ship-lens-reviewer` agent on the diff → `docs/ship-lens-review.json` verdict `PASS`, `unaddressed_p0_p1 = 0`.
2. `bash desktop/scripts/ship-gate.sh` → exit 0.
3. Real-data walk: Daniel opens v0.7.18, selects 2 clips, taps "PiP right" in cockpit Frame, confirms toast + cards update + ClipPreview if opened shows the new layout.

---

## REAL-DATA WALK (the override)

Cockpit + ClipPreview must walk as one. Required checks:

1. **Single-clip walk** — select 1, tap "Stack below" in cockpit → opens ClipPreview at Reaction Studio? Or just applies + toast? Both are valid, but pick ONE behaviour and document it. Recommendation: **applies + small "Open editor ▸" pill in toast** (doesn't force modal).
2. **Bulk walk** — select 5, tap "PiP right" in cockpit → all 5 update + toast names count.
3. **Mixed walk** — Force mixed via `forceMixed` scenario, tap a tile → applies + toast says "was mixed".
4. **Cross-surface walk** — open ClipPreview, change layout there, close → cockpit eyebrow updates without re-render hack.
5. **No reaction source walk** — bulk apply Stack below to clips with no source → toast says "set on 5 · 2 still need a reaction video [Add ▸]".

---

## How I will do this

The work splits into 3 deliveries:

### Delivery 1 — Cockpit Frame tile visual unification (this turn)

Update the HTML demo Frame module to use the **exact** Reaction Studio tile style:
- Labeled cards (icon + label below)
- Layouts use `LAYOUTS` array values: Full · Stack below · Stack above · Split left · Split right · PiP right · PiP left
- LayoutIcon glyph approximated in CSS (one geometric shape per kind)
- Selected = fuchsia bg + white inner icon-pill (matches the reference shot exactly)
- 4 tiles per row, 2 rows = 7 layouts shown
- Drop the OverlayTemplateGallery row from the cockpit (it lives in ClipPreview)

### Delivery 2 — Kimi React implementation (the real work, scoped here)

Files Kimi creates / edits:

```
desktop/src/components/cockpit/CockpitFramePanel.tsx                  (NEW)
  └─ Reads target clips, renders ratio segmented + LAYOUTS tiles
  └─ Calls applyLayout (extracted from ClipPreview for reuse) for bulk
  └─ "Edit this clip ▸" button → onOpenEditor(clipIdx) prop

desktop/src/components/clips-feed/applyLayoutBulk.ts                   (NEW — extract)
  └─ Move applyLayout logic out of ClipPreview into a shared helper
  └─ Both ClipPreview AND CockpitFramePanel import this
  └─ Wraps sidecar.applyOverlayTemplate, handles Promise.allSettled for bulk

desktop/src/components/ClipPreview.tsx                                 (refactor)
  └─ Import applyLayout from the extracted module instead of inline
  └─ No visible behaviour change

desktop/src/components/cockpit/CockpitPanel.tsx                        (per COCKPIT_FINAL_SCOPE)
  └─ Mounts the 4 section panels (Channels, Caption, Frame, When) + Master
  └─ Wires onOpenEditor to ResultsGrid's setPreviewIdx

desktop/src/components/ResultsGrid.tsx                                 (small edit)
  └─ Pass setPreviewIdx + setOpenReactionStudio to cockpit so cockpit can drill in
```

The contract:
- `CockpitFramePanel` receives `targetClipIdxs: number[]` + `project` + `onOpenEditor(idx, section?: "reaction" | "captions") => void`
- Bulk path: tile click → `applyLayoutBulk(targetIdxs, layoutKey)` → toast → cockpit re-renders on `onProjectChange`
- Drill path: "Edit this clip ▸" button → `onOpenEditor(focusedIdx, "reaction")` → ResultsGrid opens ClipPreview pre-scrolled

### Delivery 3 — ClipPreview integration tweaks

Add to ClipPreview:
- New prop `initialScrollTo?: "captions" | "reaction" | "platforms"` — when set, scrolls to the named section on mount
- Add `id="reaction-studio"` to the existing Reaction Studio section so scroll-into-view works

That's the integration. Kimi already knows the codebase patterns from M1-M5; this is one more delivery in that style.

---

## What I will do this turn

1. Apply the **Reaction Studio tile style** verbatim to the cockpit demo's Frame module — labeled cards, the 7 `LAYOUTS`, fuchsia selected state with white inner icon-pill, matching Daniel's reference shot.
2. Drop the OverlayTemplateGallery row from the cockpit (it lives in ClipPreview).
3. Add a small "Edit this clip ▸" pill that simulates opening ClipPreview (toast for demo purposes).
4. Show the mixed-state cyan eyebrow when layouts differ across target.
5. This scope doc as the deliverable for Kimi to implement Delivery 2.
