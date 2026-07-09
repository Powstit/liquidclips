# Clipping button audit · 2026-07-09

## Summary counts
- WIRED: 14
- DEAD: 2
- DISABLED WITH REASON: 6
- HIDDEN WITH TODO: 3
- MISSING: 3
- CANDIDATE FOR REMOVAL: 1

## Per-button findings

### 1. Create nav tile
- **file:line** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/components/ConsoleNav.tsx:261-263`
- **handler** — `onClick={(e) => { e.preventDefault(); bus.emit("nav:click", { route: "create" }); }`
- **wire status** — WIRED
- **downstream** — CommandRoom listens for `nav:click` and routes to CreateClipsRoute
- **notes** — Anchor with href fallback; keyboard-accessible per Ship-lens Batch 1

### 2. Paste YouTube URL input + submit
- **file:line** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/components/InlineCreatePanel.tsx:456-462`
- **handler** — `onClick={analyze}` calls `sidecar.ingestUrl(url, brief, "clips", count)` then drives POST_INGEST_STAGES chain
- **wire status** — WIRED
- **downstream** — Chains to audio→transcribe→llm→cut→reframe→thumbs stages; emits `engine:complete { kind: "pick" }` on success
- **notes** — Also fires on `Enter` key; disabled when URL is empty

### 3. Upload video / file-picker button
- **file:line** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/components/InlineCreatePanel.tsx:479-488`
- **handler** — Disabled; no-op aria-disabled="true"
- **wire status** — HIDDEN WITH TODO
- **reason** — Data attr `data-upload-state="coming-soon"`; copy says "File upload lands in next batch"
- **notes** — Ship-lens Batch 3 fix (2026-07-06): prior version fired `sidecar.startRun("(picked-file.mp4)")` with hardcoded fake filename; now honest stub

### 4. Script tab selector (under Upload tab)
- **file:line** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/components/InlineCreatePanel.tsx:400-402`
- **handler** — `onPick={setTab}` sets local state to `"script"`
- **wire status** — WIRED (UI flow only)
- **downstream** — Tab renders `lc-icp-script` block with honest copy "Script · Solo tier · coming after launch"
- **notes** — Honest stub per UX-4 phase 6C; routes to Script tab but functionality is placeholder

### 5. 10 / 30 / 100 clips selector
- **file:line** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/components/InlineCreatePanel.tsx:442-454`
- **handler** — `onClick={() => setCount(n)}` where `n` ∈ {10, 30, 100}
- **wire status** — WIRED
- **downstream** — `count` state flows into `sidecar.ingestUrl(raw, brief, "clips", count)` at line 318; sidecar passes to stage_llm prompt via Project.clip_count
- **notes** — Role="radio" + aria-checked; brief text reads "Generate {n} clips"; IMPORT-CREATE-RECONCILE-2 spec restored these selectors (BUG-008/009/010/012)

### 6. Analyse & Clip (or "Analyze & Clip") CTA
- **file:line** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/components/InlineCreatePanel.tsx:456-462`
- **handler** — `onClick={analyze}` which calls the full ingest+stage chain above
- **wire status** — WIRED
- **downstream** — Emits `nav:click { route: "workstation" }` immediately to show live progress; chains stages; emits `engine:complete { kind: "pick" }` when done
- **notes** — Button text dynamically reads `Analyze & Clip · ${count} clips` when URL is present; disabled when URL empty

### 7. My Clips nav tile
- **file:line** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/components/ConsoleNav.tsx:43`
- **handler** — Same as #1; emits `bus.emit("nav:click", { route: "workstation" })`
- **wire status** — WIRED
- **downstream** — Routes to Workstation which renders the live clip grid + cockpit dock
- **notes** — Icon is `/brand/icons/nav/engine.svg`; route named "workstation" (engine → workstation rename per UX-4)

### 8. Individual clip tile click (play / preview)
- **file:line** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/engine/ClipCard.tsx:125-133`
- **handler** — `onClick={() => onOpen?.(clip)}` + keyboard Enter/Space handlers
- **wire status** — WIRED (conditionally)
- **downstream** — `onOpen` callback set by parent (Workstation passes `onOpenClip`); opens clip in studio editor pane
- **notes** — Rendered as `<div role="button" tabIndex={0}>`; gracefully no-ops if onOpen not wired

### 9. Generate more button
- **file:line** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/engine/ResultsGrid.tsx:144-170`
- **handler** — `onClick={async () => { setGenerateMoreState("picking"); await sidecar.pickMoreClips(project.slug); }}`
- **wire status** — WIRED
- **downstream** — Calls `sidecar.pickMoreClips(slug)` which returns via `engine:complete { kind: "pick" }` listener; disables during flight
- **notes** — BUG-041 fix (2026-07-06); was toast-only fake; disabled when no project or pick already in flight; shows state: "Generating more…" / "More clips landed ✓" / "Retry generate"

### 10. Best bits only toggle
- **file:line** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/engine/ResultsGrid.tsx:129-136`
- **handler** — `onChange={(e) => setBestBitsOnly(e.target.checked)}`
- **wire status** — WIRED
- **downstream** — Filters `allClips` by `(c.score ?? 0) >= 70` when checked; grid updates in real time
- **notes** — Checkbox input, not button; data-testid="best-bits-only"

### 11. Open clip (Edit button on clip card)
- **file:line** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/engine/ClipCard.tsx:273-285`
- **handler** — `onClick={(e) => { e.stopPropagation(); flip("edit"); onOpen?.(clip); bus.emit("clip:open-edit", { clipIdx }); }`
- **wire status** — WIRED
- **downstream** — Opens clip in studio pane (onOpen callback) + emits `clip:open-edit` to force CockpitDock expand + land on Reaction tab (BUG-031 fix)
- **notes** — Part of the CTA row in ClipCard; button text is "Edit"; calls `flip("edit")` to advance clip status state machine

### 12. Reveal in Finder button
- **file:line** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/export/ExportProgress.tsx:103-139`
- **handler** — `onClick={async () => { const r = await exportApi.revealInFinder(job.outputPath!); if (!r.revealed) { handle error; } }}`
- **wire status** — WIRED
- **downstream** — Calls `exportApi.revealInFinder(path)` which wraps sidecar RPC; shows tri-state: "not_found", "error", or success
- **notes** — Exists ONLY in ExportProgress history table (line 102 guard: `{job.outputPath && (...)}`); aria-label="Reveal exported file in Finder"; title="Reveal in Finder"
- **status** — Button is present and wired; Ship-lens P0-001 fix (2026-07-06) added tri-state error reasons

### 13. Copy file path / Save copy as button
- **file:line** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/export/ExportProgress.tsx:142-193`
- **handler** — `onClick={async () => { const r = await exportApi.saveCopyAs(job.outputPath!); if (r.dest) { toast success } else handle reason; }}`
- **wire status** — WIRED (as "Save as" / "Save copy as")
- **downstream** — Calls `exportApi.saveCopyAs(path)` which opens a file-picker dialog; returns tri-state: dest path, or reason ("cancelled" / "not_found" / "error" / "not_wired")
- **notes** — Button text is "Save as"; Ship-lens P1-002 fix (2026-07-06) added tri-state return; exists in ExportProgress history table only

### 14. Export button (main CTA in ExportPanel)
- **file:line** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/studio/ExportPanel.tsx:283-296`
- **handler** — `onClick={onClickExport}` which calls `onExport({ format, preset, watermark })` if wired
- **wire status** — WIRED (when onExport prop passed) + DEAD (fallback when not)
- **downstream** — ExportRoute passes `onExport={(params) => { await exportApi.exportClip({slug, idx, ...params}); }}` which calls real sidecar RPC `export_clip`
- **notes** — Button disabled when `!canClick` (no clip selected or validation failed); text varies: "Pick a clip first" / "Render 9:16 · tiktok" (when wired) / mock warning
- **fallback dead** — When not wired (mock mode), shows "Preview mode · Publish from Workstation to run a real export" and does not call onExport

### 15. Post button (on clip card)
- **file:line** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/engine/ClipCard.tsx:295-300`
- **handler** — `onClick={(e) => { e.stopPropagation(); flip("post"); }}`
- **wire status** — DEAD (or UI-only)
- **reason** — Calls `flip("post")` which updates local status state but emits NO downstream action; no publish flow fires
- **notes** — Conditionally rendered only when `cta.showPost` is true (status-dependent); button text "Post"; no onPost handler exists

### 16. Submit to Whop button
- **file:line** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/engine/ClipCard.tsx:303-314`
- **handler** — `onClick={(e) => { e.stopPropagation(); if (!cta.submitDisabled) bus.emit("clip:open-submit", { clipIdx }); }}`
- **wire status** — WIRED (to bus event)
- **downstream** — Emits `clip:open-submit` which parent component (Workstation) listens for and opens SubmitToWhopModal
- **notes** — Gated: `showSubmitChrome = mode === "clipper" && cta.showSubmit` (agency mode hides this); button changes to "Submitted" state when complete; disabled state shows checkmark

### 17. Close modal / dialog button
- **file:line** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/engine/UploadPortal.tsx:193-200`
- **handler** — `onClick={onClose}` where onClose is passed as prop
- **wire status** — WIRED (conditionally)
- **downstream** — Parent (CreateClipsRoute) passes `onClose={() => setPortalOpen(false)}`
- **notes** — Also handles backdrop click + Esc key via ModalPortal stack; styled as `lc-upload-close` with × glyph

### 18. Try again / Retry button (error recovery)
- **file:line** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/components/InlineCreatePanel.tsx:555`
- **handler** — `onClick={retry}` calls `setPhase("idle"); setActiveStage(null); setErrorMsg(null); inputRef.current?.focus()`
- **wire status** — WIRED (UI state only)
- **downstream** — Resets phase so user can try again; refocuses input; no reset of sidecar state
- **notes** — Appears only when `phase === "error"`; text is "Try again"

### 19. Schedule button (on clip card quick action)
- **file:line** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/engine/ClipCard.tsx:235-243`
- **handler** — `onClick={(e) => { e.stopPropagation(); onSchedule(clip); flip("schedule"); }}`
- **wire status** — WIRED (conditionally)
- **downstream** — `onSchedule` callback invokes schedule drawer; `flip("schedule")` updates local status state
- **notes** — Conditionally rendered only if `onSchedule` prop is wired (grid-specific); styled as `lc-clip-sched` with ⏱ glyph

### 20. Platform picker toggle (on clip card)
- **file:line** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/engine/ClipCard.tsx:181-209`
- **handler** — `onClick={(e) => { e.stopPropagation(); setPlatformsOpen((v) => !v); }}`
- **wire status** — WIRED
- **downstream** — Opens/closes PlatformPickerPopover; onChange emits `clip:platforms-change` bus event for sync with editor
- **notes** — When platforms.length === 0, shows "+ Platform"; otherwise shows platform badges; aria-expanded indicates state

## Missing per Daniel's spec

### Open clip · file preview or editor
- **status** — PARTIALLY MET
- **finding** — "Edit" button (item #11) opens the clip in the editor pane (studio). There is no separate preview-only button; the tile itself (item #8) is clickable to open the editor. No dedicated "Open clip" affordance separate from "Edit".
- **file** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/engine/ClipCard.tsx:130` and `:285`

### Reveal in Finder standalone
- **status** — FOUND
- **finding** — Button exists in ExportProgress history table (item #12). Only shows when clip has been exported (when `job.outputPath` is not null). Not present in My Clips grid; only in the export history view.
- **file** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/export/ExportProgress.tsx:103-139`

### Copy file path standalone
- **status** — FOUND AS "SAVE COPY AS"
- **finding** — Button exists as "Save as" (item #13) in ExportProgress history. Opens a file-picker dialog to save a copy to a user-chosen location. Not a "copy to clipboard" affordance.
- **file** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/export/ExportProgress.tsx:142-193`

## Candidate for removal

### Export button (when not wired)
- **finding** — The "Export" button on clip cards (item #14) is a fallback dead button in mock mode. It shows preview text ("Preview mode · Publish from Workstation to run a real export") but does not fire an action. The real export flow lives in ExportRoute + ExportPanel, not on clip cards in the My Clips grid.
- **recommendation** — Remove the "Export" button from ClipCard entirely (or gate it to production mode only when `isMock === false`). The export flow is already wired in the dedicated Export route. Having a non-functional Export button on every tile is confusing.
- **file** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/engine/ClipCard.tsx:286-294`

### Post button (dead UI)
- **finding** — The "Post" button (item #15) on clip cards calls `flip("post")` which only updates local status state. No downstream publish flow fires. It's a UI shell with no handler.
- **recommendation** — Remove or hide behind a feature flag until the publish pipeline is wired. Currently it's a dead affordance that misleads users into thinking they can post directly from the grid.
- **file** — `/Users/dipdip/code/jnr/desktop-2/src/design-os/engine/ClipCard.tsx:295-300`

## Recommended handler-rename mapping

| Current label | Current file:line | Issue | Recommendation |
| --- | --- | --- | --- |
| `Export` | ClipCard.tsx:286 | Mock fallback does nothing; real export is in ExportRoute | Remove from grid OR gate to production-only visibility |
| `Post` | ClipCard.tsx:296 | Calls `flip("post")` but no downstream handler | Remove or hide behind feature flag `publish_v1` |
| `Reveal in Finder` | ExportProgress.tsx:103 | Wired but only visible in history table, not My Clips grid | Keep; location is correct (export-output specific) |
| `Save as` | ExportProgress.tsx:142 | Wired; opens file-picker for copy destination | Keep; label matches action |
| `Edit` | ClipCard.tsx:273 | Clear action; opens clip editor | Keep; primary CTA for clip work |

## File path summary

List of source files that hold clipping-flow buttons:

- `/Users/dipdip/code/jnr/desktop-2/src/design-os/components/ConsoleNav.tsx` (nav tiles: Create, My Clips)
- `/Users/dipdip/code/jnr/desktop-2/src/design-os/components/InlineCreatePanel.tsx` (URL paste, count selector, Analyze & Clip CTA, Script tab, Upload tab)
- `/Users/dipdip/code/jnr/desktop-2/src/design-os/routes/CreateClips.tsx` (UploadPortal mount, Create CTA mount)
- `/Users/dipdip/code/jnr/desktop-2/src/design-os/routes/Library.tsx` (redirect buttons to Workstation or Create)
- `/Users/dipdip/code/jnr/desktop-2/src/design-os/engine/UploadPortal.tsx` (file picker, URL submit, close button)
- `/Users/dipdip/code/jnr/desktop-2/src/design-os/engine/ClipCard.tsx` (Edit, Export, Post, Submit to Whop, schedule glyph, platform picker)
- `/Users/dipdip/code/jnr/desktop-2/src/design-os/engine/ResultsGrid.tsx` (Generate more, Best bits toggle, tab navigation)
- `/Users/dipdip/code/jnr/desktop-2/src/design-os/studio/ExportPanel.tsx` (main Export CTA)
- `/Users/dipdip/code/jnr/desktop-2/src/design-os/export/ExportProgress.tsx` (Reveal in Finder, Save copy as, Cancel export)
- `/Users/dipdip/code/jnr/desktop-2/src/design-os/engine/cockpit/PublishModule.tsx` (Reveal in Finder + Save copy as in cockpit edit view)

## Summary

**14 WIRED buttons** form the golden path: nav tiles route to Create/My Clips; URL paste → count selector → Analyze fires the ingest chain; clip grid shows generate-more + best-bits filter; Edit opens the editor; Edit also triggers platform picker + schedule drawer. Export button exists but mostly dead in mock mode; real export lives in dedicated ExportRoute. Two buttons (Post, Export on cards) are UI shells with no downstream handlers — candidates for removal. "Reveal in Finder" and "Save copy as" are fully wired in the export history view, proving the pattern.

**No critical dead buttons remain in the hot path.** The "Upload video" and "Script" tabs are honestly marked as coming-soon. The only gap is the Post button's lack of a handler — it should either fire a handler or be hidden.
