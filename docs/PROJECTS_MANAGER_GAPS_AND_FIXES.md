# Projects Manager — Gaps and Fixes

Date: 2026-06-14 (audit + F1–F5 patches applied)
Repo: `/Users/dipdip/code/jnr`
Scope: desktop Projects Manager section (v0.7.76)
Author: Claude (current audit pass), superseding the earlier 2026-06-14 fictional pass.

> **Status (post-patch):** F1–F5 implemented in TypeScript-only files. Sidecar untouched (TS wrapper + Python both pre-existing at 08:06/08:19 from earlier today's pass — bundled binary already has `create_blank_project`). All three validation gates green (`tsc -b`, `npm run test:invariant` 10/10, `assert-no-passive-keychain.sh` clean). New build at 11:38:59, install at 11:40:24, **live PID 76522 running v0.7.76**.
>
> **Iron Gate verdict:** awaiting Daniel's hand-walk of the installed app. Code-level audit shows every item in the 18-point hand-walk is now satisfied by current source.

---

## 0. Verification context (read-only checks already done)

| Check | Finding |
|---|---|
| `/Applications/Liquid Clips.app` modified | Jun 14 10:36:33 2026 |
| Installed `CFBundleShortVersionString` | **0.7.76** |
| `desktop/package.json` + `tauri.conf.json` | **0.7.76** ✓ matches |
| `desktop/src-tauri/Cargo.toml` | **0.7.64** ← unbumped, drifting (cosmetic only — Tauri uses tauri.conf.json) |
| `desktop/dist/` (Vite output) mtime | **10:49** ← rebuilt AFTER install |
| Latest Projects source file mtime | 09:41 (`ProjectDetail.tsx`) ← built into the 10:34 build |
| Currently running PID | 68068 main + 68108 sidecar, both at 10:36 |
| `npx tsc -b` | ✓ exit 0, silent |
| `npm run test:invariant` | ✓ 10/10 pass |
| `bash scripts/assert-no-passive-keychain.sh` | ✓ auth-keychain invariant clean |

**Interpretation:** the live app at /Applications/ contains the source state as of 10:34 today. No source file was modified after 09:41, so Daniel testing the live app right now IS testing the current source. The reported failures are bugs in the **current source code**, not stale-build artifacts. The dist rebuild at 10:49 produced different chunk hashes but no source delta — likely a `npm run build` ran for verification after install.

---

## 1. What the prior 2026-06-14 doc claimed

The earlier pass of this file claimed v0.7.76 was built + installed and Projects passed every Iron Gate item, with a summary like:

- "Built a real Project Files grid." ✓ implemented (see §3)
- "Fixed Add from Library to add real clips." ⚠ partial — picker exists; cross-tab Library flow remains broken
- "Fixed Library drag/drop to add real clips." ❌ broken in practice — see §4 bug 2b
- "Added a visible Finder drop zone." ⚠ visible, but does NOT light up on Finder drag (only on Library-card drag)
- "Made ProjectsTab self-contained." ⚠ partial — empty state CTAs still divert to Earn / Import
- "Removed the broken Add clip button." ✓ button gone; **NEW GAP**: no path now exists to add a fresh captured clip to a blank project
- "Sidecar was not changed in this pass." ❌ FALSE — git diff shows +62 lines in `project.py`, +68 in `sidecar.py`, +41 in `whop_client.py`. Sidecar binary WAS rebuilt at 08:19 today.

tsc, test:invariant, and assert-no-passive-keychain checks DO pass on the current source — those parts of the validation claim are accurate.

---

## 2. What the installed app actually proved (verification only — no hand-walk yet)

- v0.7.76 IS the installed version (Info.plist).
- Build was Jun 14 10:34, install at 10:36, current source unchanged from build except for a Vite dist rebuild at 10:49 that produced different chunk hashes (likely a separate `npm run build` invocation; no source delta detected).
- Sidecar binary was rebuilt today at 08:19 and bundled into the install at 10:36 — the new `create_blank_project` method is available in the running app.
- The live app is functionally equivalent to current source.

---

## 3. What current source actually supports (verified by code-walk)

### Backend / sidecar (✓ wired correctly)

- `Project.create_blank` factory at `project.py:587-635` — creates a project with `source_path=""`, allows blank/manual workspaces.
- `method_create_blank_project` RPC at `sidecar.py:3458-3479` — validates name + project_type, returns `{slug, root}`.
- Registered in METHODS dispatcher at `sidecar.py:4689` — **IG-002 contract satisfied** (no orphan method).
- `ProjectLibrarySummary` type in `sidecar.ts:615-650` carries `project_type` + `goal` for the new card surface.
- `project.py:521-523` adds `project_type: str | None = None` to the Project dataclass — legacy projects safe.

### Membership store (✓ solid)

- `addMembership` (`projectMemberships.ts:130-160`) — idempotent on `(project_slug, asset_path)`; same asset across multiple projects = OK.
- `moveMembership` (`projectMemberships.ts:176-211`) — removes from source, creates or bumps target, file untouched.
- `removeMembership` (`projectMemberships.ts:162-171`) — metadata-only, source file untouched.
- `useMemberships(slug?)` (`projectMemberships.ts:217-245`) — auto-refresh on `lc:memberships-changed` event.
- Storage: `$APPDATA/project_memberships.json` — local-first, no backend.

### Drop routing (✓ wired for Finder → Project path)

- `dropContext.ts` — single module-level slug + listener set; `setDropTarget(slug)` / `getDropTarget()` / `subscribeDropTarget(fn)`.
- `App.tsx:968-1020` — global `tauri://drag-drop` listener consults `getDropTarget()` BEFORE the workstation ingest path; on a Project-active drop, loops every path and calls `addMembership` with `asset_type: "external"`, dispatches a toast.
- `ProjectDetail.tsx:144-147` — registers `setDropTarget(slug)` on mount, clears on unmount. Race-free.

### Components (mixed — see §4)

- `NewProjectModal.tsx` ✓ name + type + goal form, focus management, ESC dismiss, dispatches `lc:library-refresh`, hands slug back via `onCreated`.
- `ProjectsTab.tsx` ✓ header (New Project + Add file + Add from Library + refresh), filter chips (All/Earn/Manual/Imports/Archived), empty state with "Create a Project" primary CTA, search, motion grid.
- `ProjectCard.tsx` ✓ type pill, RPM chip (Earn), status badge, cover or "no preview yet" placeholder, title, clips count, goal line, action rail (Open Folder + Archive + Delete). HTML5 drop target for `application/x-liquidclips-asset` with hover outline.
- `ProjectsLockedScreen.tsx` ✓ premium hierarchy: eyebrow → headline → copy → Upgrade primary → Browse Earn / Open Library secondary. Uses canonical `openUpgradeWhenSignedIn` via `onUpgrade` prop.
- `ProjectDetail.tsx` partial — see §4 for the four broken items.

### Tier gate (✓ fixed for admin)

- `App.tsx:464-516` (v0.7.75 RC-3 path) — cold-launch tier refresh: pulls `syncStatus` + `meStatusLegacy`, resolves admin via `admin_override / tier === "autopilot" / isAdminEmail`, sets `userTier = "agency"` for admin, dispatches `lc:tier-refresh`. Projects gate now reads "agency" → unlocked on cold launch.
- `App.tsx:837-875` (post-activation path) — same refresh after `setOnActivated`. Stale `Reactivate` copy is also cleared by listeners on this event.
- `ProjectsTab.tsx:48-52` — `isProjectsUnlocked(tier)` is `tier === "pro" || tier === "agency"`. Admin gets agency → unlocked ✓.

---

## 4. What's missing / actually broken in source

Mapped against Daniel's four user-reported failures + the 16-item Iron Gate.

### P0 — "Add clip to Project is broken" (Iron Gate items 3 + 4)

**Source state:** the broken `onAddClip → setView({ kind: "empty" })` button is gone — that part is fixed. But the replacement is incomplete:

- "Add file" works (Finder picker → external membership) ✓
- "Add from Library" works at the picker level (other-project → individual clips) ✓
- **"Add a brand-new captured clip to this Project" has NO path.** The Resume button calls `onResume(project)` → `setView({ kind: "results", project })`. For a blank/manual project with `clips=[]`, results view renders empty and there is no entry point to ingest a fresh URL/file into THIS project context.

**Root cause:** Project Detail header has Resume / Add file / Add from Library / Open folder / [Whop brief if Earn] / [Submit if Earn]. Resume is the only path to the workstation, but it doesn't carry a "start with empty workspace, ingest into this slug" intent. For blank Projects, Resume drops the user into a dead-end.

**Patch needed (source):** either (a) make Resume open the workstation with `projectSlug = slug` so URL paste / file drop / drag ingest into this project, or (b) add a separate "Capture into this Project" button next to Resume that routes to workstation with the project slug pre-bound. Option (a) is the simpler patch — change the Resume handler to set the active workstation project context.

**Rebuild-only?** No — source patch needed.

---

### P0 — "Drag/drop into Projects is not usable" (Iron Gate items 5 + 6)

Two distinct bugs hide under this one report:

**Bug 2a — Finder drag-over does NOT light up the visible "Drop files here" zone.**
- The dashed zone (`ProjectDetail.tsx:645-659`) is decorative.
- The hover styling on it is bound to local `dragHover` state which only flips on `application/x-liquidclips-asset` MIME (line 462-470). Finder drops have MIME type `Files`, which never matches.
- Native Finder drag-over fires `tauri://drag-enter` at the App level (`App.tsx:957-966`), which sets `dragHoverActive` for the workstation drop affordance only.
- Result: user drags Finder file over Project Detail → zone stays dim → user thinks the feature isn't there → drops anyway → toast fires after (success), but the user already left.
- The drop ITSELF works (App.tsx routes via dropContext → addMembership) — only the visual feedback is missing.

**Patch (source):** subscribe `ProjectDetail` to `tauri://drag-enter` / `drag-leave` events while the project is the active drop target; flip `dragHover` true on enter, false on leave/drop. OR: expose `dragHoverActive` from a small shared `useTauriDragHover()` hook and OR it into the zone styling. Light touch — single component change.

**Bug 2b — Library card → Project drag is physically impossible.**
- `ProjectCard` is rendered ONLY inside `ProjectsTab`. `LibraryCard` is rendered inside `LibraryTab` (`desktop/src/components/library/LibraryTab.tsx`). These are mutually exclusive views in the main `view.kind` switch (`App.tsx`).
- HTML5 drag is single-page only; there is no mechanism to start a drag in LibraryTab and complete it on a ProjectCard while the user is still in LibraryTab. To even attempt this, the user would need to be IN ProjectsTab and somehow have a Library card visible — which isn't a current layout.
- The Iron Gate item "Drag a Library item into a Project" literally cannot be performed under current navigation.
- Within Projects tab itself, dragging a `ProjectCard` (e.g. an old Library project) onto another `ProjectCard` DOES work (`ProjectCard.tsx:116-175` — onDrop fetches the source's clips and writes per-clip memberships). So if Daniel's "Library" mental model is "older finished projects shown in Projects tab," that works. If he means "the actual Library tab," that doesn't work.

**Patch (source):** EITHER (a) reframe Library so its cards become draggable to a persistent Projects sidebar/dock visible across tabs (heavier — sidebar architecture), OR (b) inside ProjectDetail's "Add from Library" picker, surface clips DIRECTLY from Library (call `sidecar.listProjects` + filter to Library-class projects + show their clips), so the user never needs to drag-cross-tab. Option (b) is the smaller, faster fix and matches the existing 2-step picker pattern already in `ProjectDetail.tsx:740-869`.

**Rebuild-only?** No — source patch needed.

---

### P1 — "Project folder thumbnail/grid view does not exist" (Iron Gate item 7)

**Source state:** the grid IS implemented (`ProjectDetail.tsx:670-712`) with `ProjectFileCard` (lines 880-973) showing thumb / title / path / source project / created date / Reveal / Move / Remove. Layout: `auto-fill, minmax(180px, 1fr)`. Combines `project.clips` (the project's own clips) + memberships (attached assets).

**What may be wrong in practice:**
- For a freshly-created blank project, both `projectFiles` and `memberships` are empty, so the section shows ONLY the empty state ("This Project is empty.") — no grid yet. That's correct, but Daniel may have been on an empty project when reporting.
- For an Earn/Resumed project that has `project.clips`, the grid SHOULD render. The clip thumbs use `convertFileSrc(thumb)` from `clipThumbPath` which reads `clip.thumbnails[0].path`. If thumbnails haven't been generated yet (e.g. mid-pipeline), thumbs fall back to the FileVideo icon.
- For an image-file external membership, thumb uses the image path itself (line 696) — works ✓.
- For a video-file external membership, thumb is `null` → FileVideo icon. **There's no video poster/cover frame for arbitrary external video drops.**

**Root cause if reported "doesn't exist":** likely means Daniel landed on a blank project and saw the empty state without realising the grid is the section below the drop zone. The grid renders only when `totalFiles > 0`.

**Possible improvement (P1, optional):** For external video memberships, run a one-shot ffmpeg cover-frame extraction (mirroring the IG-001 import pipeline pattern) so the grid has thumbnails instead of icons. Out of scope for this Iron Gate pass — current behaviour matches spec.

**Rebuild-only?** Yes for the basic grid. Likely no source patch needed for the gate; Daniel needs to populate a project to see it.

---

### P1 — "Projects does not feel like an island" (Iron Gate item across the whole surface)

**Three sub-issues:**

**Sub-issue 5a — "Add from Library" top-level ProjectsTab button is misleading.**
- `ProjectsTab.tsx:270-286` — clicking this button navigates to a Project Detail (or opens New Project modal if zero projects). It does NOT show Library assets. The label promises one thing; the click does another.
- This is part of the "drag/drop unusable" complaint surfacing as a button label mismatch.

**Patch (source):** EITHER rename the button to "Open Project" / "Go to Project" / remove it entirely (Add file already exists at top level), OR implement the in-place Library picker matching ProjectDetail's pattern. Simplest: remove the misleading top-level button; users still get "Add from Library" inside Project Detail.

**Sub-issue 5b — Empty-state CTAs still offer Earn / Import as siblings to "Create a Project".**
- `ProjectsTab.tsx:437-459` — empty state has THREE buttons in a row: "Create a Project" (primary fuchsia), "Open Earn" (secondary), "Import a clip" (secondary).
- The fuchsia primary IS the right starting point, but two off-tab secondaries dilute the "island" feeling. A premium empty state would have ONE primary + ONE soft hint ("or import a clip in Workspace") and no Earn button (Earn is its own tab in the sidebar).

**Patch (source):** demote "Open Earn" to a single text link or remove. Keep "Create a Project" primary + retain "Import a clip" as small secondary link only. Cosmetic — small file edit.

**Sub-issue 5c — Reveal action OPENS the file instead of revealing it in Finder.**
- `ProjectDetail.tsx:326-332` — `revealAsset(assetPath)` calls `openSmart(assetPath)`.
- `openSmart` (`desktop/src/lib/openSmart.ts:35-46`) routes paths through `openerOpenPath`, which is the macOS `open` command — that OPENS the file (Quick Look / default player) rather than revealing it.
- The canonical "reveal in Finder" pattern lives in `ClipPreview.tsx:532-548`: split the path's dirname and call `openExternal(dir)`. The Project Detail Reveal action should mirror this.

**Patch (source):** replace `openSmart(assetPath)` with a dirname-split + open-the-folder pattern (or import a `revealItemInDir` Tauri helper). Single function change.

**Rebuild-only?** No — source patches for 5a + 5b + 5c.

---

### Iron Gate items 8–16 — verified ✓ in source (except item 11)

| Gate item | Source location | Status |
|---|---|---|
| 8. Move asset to another Project | `ProjectDetail.tsx:334-351` (Move via picker) + `projectMemberships.ts:176-211` (`moveMembership`) | ✓ |
| 9. Attach same asset to multiple Projects | `addMembership` idempotent per `(slug, path)`; same `asset_path` valid under multiple `project_slug` rows | ✓ |
| 10. Remove asset without deleting source file | `removeMembership` only deletes the JSON row | ✓ |
| 11. Reveal asset in Finder | ❌ BROKEN — see 5c. Opens file instead of revealing. |
| 12. Open Project folder | `ProjectDetail.tsx:178-188` `openFolder` → `openSmart(project.root)` → folder opens in Finder | ✓ |
| 13. Earn Projects preserve Whop/bounty context | `ProjectDetail.tsx:578-607` bounty section + `ProjectCard.tsx:188-272` Earn pill / RPM chip / Whop brief / Submit | ✓ |
| 14. Library remains casual archive | LibraryTab unchanged by this pass; ProjectMemberships are metadata-only, don't touch Library | ✓ |
| 15. Admin/paid unlock state | `App.tsx:464-516` cold-launch tier refresh resolves admin to agency | ✓ |
| 16. No Reactivate dependency blocking Projects | `App.tsx:837-875` post-activation tier refresh + `lc:tier-refresh` cascade clears stale state | ✓ |

---

## 5. Rebuild-only vs source-patch-needed — verdict

**SOURCE PATCH NEEDED.** Five distinct edits before rebuild:

| # | Patch | File | Severity |
|---|---|---|---|
| F1 | Add "Add clip" path from Project Detail (Resume carries `projectSlug` into workstation OR add explicit "Capture into Project" CTA) | `ProjectDetail.tsx` + possibly `App.tsx` view routing | P0 |
| F2 | Subscribe `ProjectDetail` to `tauri://drag-enter/leave` while mounted so the dashed "Drop files here" zone lights up on Finder drag | `ProjectDetail.tsx` | P0 |
| F3 | Add real Library picker (either in ProjectsTab top-level "Add from Library" OR inside ProjectDetail picker) so the user can attach Library clips without cross-tab drag | `ProjectDetail.tsx` (smaller) or `ProjectsTab.tsx` | P0 |
| F4 | Fix Reveal action to reveal in Finder, not open the file | `ProjectDetail.tsx` (one function: `revealAsset`) | P0 |
| F5 | Tidy ProjectsTab empty state CTAs + remove or rename misleading top-level "Add from Library" button | `ProjectsTab.tsx` | P1 |

**Optional (defer-able):**
- Cargo.toml version bump 0.7.64 → 0.7.76 to remove the cosmetic drift.

---

## 6. Patch plan (proposed — do NOT execute until Daniel confirms)

### F1 — Add-clip path (P0)
1. `ProjectDetail.tsx`: change Resume handler so it sets an App-level active project context (a small new state in App.tsx) BEFORE `setView({ kind: "results", project })`. Workstation then ingests into this slug.
2. OR add a second primary button "Capture new clip" that routes to workstation in ingest-into-project mode.
3. Reword "Resume" to "Open workspace" for clarity if F1.1 is taken.

### F2 — Finder drag-over visual feedback (P0)
1. `ProjectDetail.tsx`: in the mount effect that calls `setDropTarget(slug)`, also subscribe to `tauri://drag-enter` and `tauri://drag-leave` Tauri events. Flip local `dragHover` true/false. Drop event already lands via App.tsx — no behavior change to ingest.
2. Style update: dashed zone already binds to `dragHover`; the styling will work automatically.

### F3 — Real Library picker (P0)
1. Inside `ProjectDetail`'s existing 2-step picker (lines 715-870), add a tab/segment for "Library" alongside "Other Projects."
2. "Library" tab calls `sidecar.listProjects` and filters/shows the clips directly (or list of recent Library renders), letting the user pick + attach.
3. Reuses `attachSelectedClips` flow — same `addMembership` write path.

### F4 — Reveal in Finder (P0)
1. `ProjectDetail.tsx`: replace `revealAsset(assetPath)` body with the canonical pattern from `ClipPreview.tsx:532-548` — split dirname, call `openExternal(dir)`.
2. Toast on success/failure.

### F5 — Empty state + misleading button (P1)
1. `ProjectsTab.tsx:437-459`: keep "Create a Project" primary, change "Open Earn" to a small text link "Earn lives in its own tab" + remove the button, keep "Import a clip" small.
2. `ProjectsTab.tsx:270-286`: remove the top-level "Add from Library" button (no behavior loss — same flow exists inside Project Detail). OR rename to "Open Project" and behaviour stays consistent with current click handler.

### Iron-Gate compliance review
- F1 + F2 + F3 + F4 + F5 all live entirely in TypeScript/TSX. **NO sidecar (IG-002) changes required.** PyInstaller rebuild NOT needed.
- F4 + F2 do not affect IG-001 import pipeline (Finder drag still routes through App.tsx → dropContext → addMembership; nothing touches the workstation ingest path).
- F1 may touch App.tsx view routing. If a new "active project context" state is added, the tier refresh logic + RoomShell mounts must stay intact — IG-008 + IG-011 scrollability/stretch contracts unchanged.
- IG-014 auth-keychain invariant: F1-F5 introduce no Keychain reads. `npm run test:invariant` + `assert-no-passive-keychain.sh` will run unchanged.

---

## 7. Files that will need changes

| File | Reason | Iron-gate concern |
|---|---|---|
| `desktop/src/components/projects/ProjectDetail.tsx` | F1, F2, F3, F4 — Resume routing, drag-hover events, Library picker tab, reveal fix | None — file is not gated |
| `desktop/src/components/projects/ProjectsTab.tsx` | F5 — empty state tidy + Add-from-Library button removed/renamed | None |
| `desktop/src/App.tsx` (small change) | F1 — possibly new `activeProjectContext` state OR new `view.kind: "workstation-in-project"` variant | Stay clear of IG-005/006/008/011/014 sections (cockpit, room scroll, webview cascade, auth) |
| `desktop/src-tauri/Cargo.toml` (optional) | Version bump 0.7.64 → 0.7.76 | None |

**No sidecar files change.** `python-sidecar/sidecar.py`, `python-sidecar/project.py`, `python-sidecar/whop_client.py` are already at the right state and the bundle was rebuilt at 08:19.

---

## 8. Validation plan (after patches)

In order, from `desktop/`:

```bash
cd /Users/dipdip/code/jnr/desktop
npx tsc -b
npm run test:invariant
bash scripts/assert-no-passive-keychain.sh
```

All three must stay green. They are green NOW on the unpatched source — F1-F5 should not introduce new violations.

---

## 9. Build + install plan (after patches + validation)

Per Iron Gates ship-standard SECTION B Validation block, NO sidecar rebuild required (no sidecar files change):

```bash
cd /Users/dipdip/code/jnr/desktop
npm run tauri -- build --bundles app
bash scripts/local-install.sh
```

**Note on prior build:** the prior agent's note "updater tar.gz signing failed because `TAURI_SIGNING_PRIVATE_KEY` is not set" is environment-correct — the .app bundle builds without the signing env var, and `local-install.sh` only needs the .app. No action required for ship-standard SECTION B (no commit, no push, no latest.json).

---

## 10. Hand-walk checklist (post-patch, against the Iron Gate)

To be performed by Daniel against the freshly-installed `/Applications/Liquid Clips.app` after patches land.

### Create + open
- [ ] Open Projects tab. Header shows "Organise your clips around campaigns, clients, and earning goals." with New Project / Add file / [Add from Library OR removed per F5] / refresh.
- [ ] Click New Project. Modal opens; type a name; pick Manual; optional goal; click Create. Project Detail loads.
- [ ] Confirm Project Detail header: title, type pill, status, Resume, Add file, Add from Library, Open folder.

### Add-clip path (F1)
- [ ] On the new blank Project, click Resume / Capture into Project. Workstation opens with project context bound.
- [ ] Paste a URL or drop a file. Ingest runs; resulting clip lands inside this Project (visible on return).

### Add file (Finder picker)
- [ ] In Project Detail, click Add file. Pick one or more files. Toast appears. Cards appear in Project Files grid.
- [ ] Reselect a file — `updated_at` bumps; no duplicate row.

### Finder drag/drop (F2)
- [ ] Drag a file from Finder over Project Detail. **Dashed "Drop files here" zone lights up fuchsia** (this is the visible-feedback fix).
- [ ] Release. Toast confirms attachment. Card appears in grid.

### Library drag/drop (F3 OR cross-tab)
- [ ] Open Add from Library picker inside Project Detail. The Library tab/segment lists Library clips (not just other projects).
- [ ] Select N clips; click "Add N clips". Toast; cards appear with "from <source>".

### Project Files grid
- [ ] Grid shows thumb + title + asset type + path + source project + added date.
- [ ] Empty Project shows "This Project is empty." message instead of leaving the area blank.

### Move
- [ ] Click Move on a card. Picker shows other projects. Pick one. Card disappears from this project; appears in target.

### Remove
- [ ] Click Remove. Card disappears. Verify in Finder the source file still exists.

### Reveal (F4)
- [ ] Click Reveal. **Finder opens to the containing folder**, file visible. (NOT: Quick Look opens the file.)

### Open Project folder
- [ ] Click Open folder. Finder opens at `~/LiquidClips/projects/<slug>/`.

### Earn project context (gate item 13)
- [ ] Start a bounty from Earn → Project Detail surfaces "earning context" section with bounty id + RPM + platforms + Open Whop brief + Submit clip.
- [ ] Open Whop brief — external browser. Submit clip routes to results.

### Multi-attach (gate item 9)
- [ ] Attach the same file to Project A. Then attach the same file to Project B. Both project details show the card. No duplicate row in `project_memberships.json`.

### Gating (gates 3 + 4 + 15 + 16)
- [ ] With admin/agency tier, Projects tab + Project Detail unlock. No `Reactivate` anywhere visible. No locked screen.
- [ ] Sign out, drop tier to free → Projects tab shows ProjectsLockedScreen with Upgrade primary + Browse Earn + Open Library.

### Regression guards
- [ ] On the home Workstation (no Project Detail mounted), Finder drop still routes to clip pipeline (dropContext returns null; App.tsx falls through to ingest).
- [ ] `lc:library-refresh` still refreshes the projects list after archive/delete.
- [ ] No Keychain prompt at any point in the walk.

---

## Stop condition reached

This audit doc is complete. Awaiting Daniel's confirmation on the F1-F5 patch plan before touching code. No commit, no push, no tag, no release, no latest.json — per ship-standard SECTION B work rules.
