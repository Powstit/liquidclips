# Liquid Clips 2.0 — Iron-gate registry

Sentinels for the `/desktop-2/` shell. Prefix `IG-LC2-NNN` (vs `IG-NNN`
which belongs to `/desktop/`).

Pre-commit hook refuses any diff that removes a sentinel comment unless
`IRON_GATE_OVERRIDE=1` is set with a reason quoted from Daniel's current-
turn instruction.

## Active gates (locked)

| ID         | Locks                                                  | Sentinel sites |
| ---------- | ------------------------------------------------------ | -------------- |
| IG-LC2-015 | Grid tiles render the sidecar's PNG thumbnail via `<img src={convertFileSrc(clip.thumbnails[0].path)}>`. **Never `<video>` for grid display.** WebKit's `<video preload="metadata">` loads file headers but never decodes pixels, so tiles stay black. Video elements belong only in the single-clip editor pane (one at a time, after user click). Mirrors the shipping desktop/ pattern at `desktop/src/components/projects/LibraryClipStrip.tsx:244` and `desktop/src/components/ResultsGrid.tsx:293`. See BUG-027 in `desktop-2/docs/BUGS_ERRORS_FIXES.md` for the full chase. | `desktop-2/src/design-os/engine/ClipCard.tsx` (wrapped `<img>` block); `desktop-2/src/design-os/engine/types.ts` (`Clip.thumbnails` field declaration) |
| IG-LC2-016 | **Once `session.project` exists, fixture-sourced clips are forbidden in Workstation / editor surfaces.** Workstation IS the editor — `<ClipPreviewShell>` mounts inside Workstation and reads the same `focusedClip` that CockpitDock reads, resolved from `session.project.clips`. `TimelineStudio` (secondary surface) MUST also resolve its `clip` from `session.project?.clips.find(...)` and NEVER from `FIXTURE_PROJECT`. No secondary editor window. See BUG-028 in `desktop-2/docs/BUGS_ERRORS_FIXES.md`. | `desktop-2/src/design-os/routes/Workstation.tsx` (focusedClip derivation + ClipPreviewShell mount site); `desktop-2/src/design-os/routes/TimelineStudio.tsx` (session.project clip resolution) |
| IG-LC2-017 | **Workstation generated-clip editing path is contract-locked end to end.** The wire `URL/Create flow → generated session.project → ResultsGrid → ClipCard.onOpen → focusedClip (Workstation.tsx) → ClipPreviewShell `<video src={convertFileSrc(clip.vertical_path)}>` → CockpitDock(focusedClip=…)` must remain unbroken. **Hard prohibitions:** (a) no `FIXTURE_PROJECT.*.find(...)` fallback may be reintroduced in any node of this path; (b) no second editor window/route — Workstation IS the editor; (c) no rebroken preview (the `<ClipPreviewShell clip={focusedClip} />` mount site inside `<WorkstationFrame>` must remain conditional only on `focusedClip` truthy, never on phase/route/feature-flag); (d) `ClipPreviewShell` must use `<video src={convertFileSrc(clip.vertical_path)}>`, never `<img>`, never raw `clip.vertical_path` unwrapped; (e) `CockpitDock` and `ClipPreviewShell` must read the **same** `focusedClip` reference so the dock and preview cannot drift. Confirmed live by Daniel on 2026-06-22: 10 clips generated, 10 thumbnails rendered, preview plays in Workstation, no fixture leak. See BUG-028 AFTER FIX in `desktop-2/docs/BUGS_ERRORS_FIXES.md`. | `desktop-2/src/design-os/routes/Workstation.tsx` (focusedClip derivation + ClipPreviewShell mount + CockpitDock focusedClip prop); `desktop-2/src/design-os/studio/ClipPreviewShell.tsx` (`<video>` + `convertFileSrc` site); `desktop-2/src/design-os/engine/ResultsGrid.tsx` (onOpenClip → setFocusedClipIdx wire) |

## Pending gates (locked at end of their phase)

| ID         | Phase | Locks                                                                                |
| ---------- | ----- | ------------------------------------------------------------------------------------ |
| IG-LC2-001 | 1     | Raw shell: 11 visible primary sections (Home, Create, Browse, Engine, Projects, Schedule, Channels, Community, Earn, Campaigns, Settings), full-canvas layout, no persistent global panel, diagnostics skeleton, fake data on launch, no backend/keychain calls on launch. Account, Diagnostics, and HQ Bridge are reachable as Settings sub-tabs. Clipper is a hidden mode/skin route. Two-persona UI simulator is present. |
| IG-LC2-002 | 2     | Fixture loader is the only data source until Phase 3+; no network at boot.           |
| IG-LC2-003 | 3     | createStore + sidecar `clip_from_url` wrapper.                                       |
| IG-LC2-004 | 4     | editorStore tier gate (free → watermark filter, paid → clean).                        |
| IG-LC2-005 | 5     | projectsStore mutation contract.                                                     |
| IG-LC2-006 | 6     | scheduleStore + UI lane (still fake-connected).                                      |
| IG-LC2-007 | 7     | channels deep-link return path.                                                      |
| IG-LC2-008 | 8     | COMMUNITY route-only mount rule (no global panel).                                   |
| IG-LC2-009 | 9     | EARN lazy mount + license gate (no passive Whop call on launch).                     |
| IG-LC2-010 | 10    | Settings mount no-side-effects rule (no keychain reads on mount).                     |
| IG-LC2-011 | 11    | HQ bridge verb schema.                                                               |
| IG-LC2-012 | post  | Brand-kit single source of truth (mirror desktop/ IG-012 with new sentinel).         |
| IG-LC2-013 | post  | Apple notarisation chain — adopted from desktop/ when cutover lands.                 |
| IG-LC2-014 | post  | Auth-keychain invariant — adopted from desktop/ on cutover.                          |

## How to add a sentinel

In code:

```ts
// ───── IRON GATE IG-LC2-NNN — see docs/lc2/IRON_GATES_LC2.md ─────
// (the protected block)
// ───── END IRON GATE IG-LC2-NNN ─────
```

In this file, move the row from "Pending" to "Active gates" and fill the
sentinel-site cell with file paths.
