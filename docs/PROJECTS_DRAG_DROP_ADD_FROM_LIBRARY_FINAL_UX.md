# Projects Manager — Final UX for Drag/Drop + Add from Library

**Date:** 2026-06-14
**Section:** B — Projects Manager
**Status:** Design lock-in (pre-wiring). No code changes yet. Per Daniel's directive after the v0.7.76 hand-walk: design the final outcome first, then wire to match.
**Scope:** the Project Detail surface only. NOT a redesign of Library, Earn, Workstation, Auth.
**Replaces (in spirit):** the UX implied by F1–F5 patches in `PROJECTS_MANAGER_GAPS_AND_FIXES.md` §6. Those patches are kept; this doc tightens the intent before any further wiring.

---

## 0. The user's actual flow (in their words)

> "I open Projects. I make a new Project. I want clips in it. I should be able to add a file from my Mac, drag a clip in from Library, or click 'Add from Library' and see clips — not projects pretending to be clips. When I drop something, it shows up. When I'm done, I close it. That's it."

Every screen, drop zone, picker, and card we build must serve that sentence.

---

## 1. Where the doc fits (read order for next agent)

1. `~/Downloads/LIQUID_CLIPS_SHIP_STANDARD_IRON_GATES.md` § SECTION B (Iron Gate items + hand-walk)
2. `docs/PROJECTS_MANAGER_GAPS_AND_FIXES.md` (honest audit + post-patch state from v0.7.76)
3. `docs/PROJECTS_MANAGER_SCOPE.md` (the v0.7.73 architecture decisions: hybrid storage, metadata memberships, no DnD library)
4. `desktop/docs/IRON_GATES.md` IG-001, IG-002, IG-005, IG-006, IG-008, IG-011, IG-014 (the gates anything Projects-adjacent must respect)
5. **THIS FILE** — the UX contract this section ships against.

---

## 2. Hand-walk findings to design against

From Daniel's hand-walk of v0.7.76 (installed at 11:40):

| # | Outcome | Status | Where it failed |
|---|---|---|---|
| 1 | Create Project | ✅ works | New Project modal + `create_blank_project` RPC end-to-end |
| 2 | Add Finder file | ✅ works | `runAddFileToProject` writes `external` memberships |
| 3 | Add from Library | ❌ **broken** | The "broken" feel comes from: (a) the picker step 1 shows project-rows when the user expects clip-rows, (b) if no other project has rendered clips, step 1 returns "no Library projects with rendered clips match" — looks like a dead button |
| 4 | Get clips into a new Project | ❌ **unclear path** | A blank Project has no obvious "capture clip" flow; the F1 capture-context pill works once Resume is clicked but the user didn't discover that; Add from Library is empty on a fresh install with one project |
| 5 | Cohesion / "feels like a workspace manager" | ❌ **too much walking** | Implementations satisfied the Iron Gate items individually but didn't compose into a single coherent flow |

This doc specifies the flow.

---

## 3. Final Project Detail layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ← Back to Projects                                                          │
│                                                                             │
│ PROJECT · MANUAL · DONE/IN PROGRESS                                         │
│ My First Campaign                                                           │
│ £40 / clip · 3 clips · TikTok · Instagram                                   │
│                                                                             │
│ [▶ Open Workspace]  [⊕ Add file]  [⊕ Add from Library]  [📁 Open folder]   │
│                                            [↗ Open Whop brief]  [➤ Submit] │ ← Earn-only
│                                                                             │
│ ─── earning context ──────────────────────────────────────────────────────── │ ← Earn-only block
│ │ Whop bounty b_abc123                                                     │ │
│ │ by @creator                                                              │ │
│ │ "Promote our new launch ..."                                             │ │
│ │ 47 spots remaining                                                       │ │
│ ───────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│ ─── source ──────────────────────────────────────────────────────────────── │
│ │ 📁 launch-video.mp4                                                      │ │
│ │ ~/LiquidClips/projects/my-first-campaign/                       [ Open ] │ │
│ ───────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│ ─── project files (5) ───────────────────────  3 created · 2 attached ──── │
│                                                                             │
│ ┌───────────────────────────── DROP ZONE ──────────────────────────────┐   │
│ │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │   │
│ │                                                                       │   │
│ │             Drop files or Library clips into this Project              │   │
│ │       Finder files become references — your originals stay where      │   │
│ │                       they are. Drop a clip to attach.                │   │
│ │                                                                       │   │
│ │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │   │
│ └───────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐                    │
│ │ thumb     │ │ thumb     │ │ thumb     │ │ thumb     │                    │
│ │           │ │           │ │           │ │           │                    │
│ │ Clip 1    │ │ Clip 2    │ │ image.png │ │ launch.mp4│                    │
│ │ Clip      │ │ Render    │ │ External  │ │ External  │                    │
│ │ Reveal    │ │ Reveal    │ │ Reveal    │ │ Reveal    │                    │
│ │ Move      │ │ Move      │ │ Move      │ │ Move      │                    │
│ │ Remove    │ │ Remove    │ │ Remove    │ │ Remove    │                    │
│ └───────────┘ └───────────┘ └───────────┘ └───────────┘                    │
│                                                                             │
│ connect channels in Schedule → Channels to publish from this project       │
└────────────────────────────────────────────────────────────────────────────┘
```

**Key changes vs. v0.7.76:**

1. **Drop zone is large and persistent**, not a small dashed strip. It's the visual centerpiece of the Files section.
2. **Drop zone copy explicitly mentions both Finder files AND Library clips** — so the user knows it accepts both.
3. **Below-drop-zone grid** is the only "Project Files" surface. Clips and memberships co-mingle in the same grid (already true in v0.7.76).
4. **Workstation button is renamed "Open Workspace"** instead of "Resume" — Resume implies prior work; for blank projects this is the discovery path.

---

## 4. Empty Project state

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ← Back to Projects                                                          │
│                                                                             │
│ PROJECT · MANUAL                                                            │
│ Walk Test                                                                   │
│ Just created · 0 clips                                                      │
│                                                                             │
│ [▶ Open Workspace]  [⊕ Add file]  [⊕ Add from Library]  [📁 Open folder]   │
│                                                                             │
│ ─── source ──────────────────────────────────────────────────────────────── │
│ │ — (no source yet)                                                        │ │
│ │ ~/LiquidClips/projects/walk-test/                              [ Open ] │ │
│ ───────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│ ─── project files (0) ──────────────────────────────────────────────────── │
│                                                                             │
│ ┌──────────────────────── DROP / GET STARTED ──────────────────────────┐   │
│ │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │   │
│ │                                                                       │   │
│ │              This Project is empty. Three ways to fill it:            │   │
│ │                                                                       │   │
│ │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐       │   │
│ │  │ ▶ Open          │  │ ⊕ Add file      │  │ ⊕ Add from      │       │   │
│ │  │   Workspace     │  │                  │  │   Library       │       │   │
│ │  │                  │  │                  │  │                  │       │   │
│ │  │ Paste a URL or   │  │ Pick a video,   │  │ Pull in existing│       │   │
│ │  │ drop a video to  │  │ image, or file  │  │ clips from your │       │   │
│ │  │ capture clips    │  │ from Finder     │  │ Library         │       │   │
│ │  │ into this        │  │                  │  │                  │       │   │
│ │  │ Project          │  │                  │  │                  │       │   │
│ │  └─────────────────┘  └─────────────────┘  └─────────────────┘       │   │
│ │                                                                       │   │
│ │           Or drag files or Library clips anywhere on this screen.      │   │
│ │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │   │
│ └───────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────┘
```

The empty state shows three large, equally-weighted "Get started" tiles plus a footer hint that anywhere on the screen is a drop target. The three tiles are the same three actions in the header — duplicated here so the user with zero clips never has to look at the header to figure out what to do.

---

## 5. Drop zone — states and behaviour

### 5.1 Default (calm) state

- Dashed `border-line` border (`1px`).
- Background: `bg-paper-elev/40` (subtle elevation).
- Copy: **"Drop files or Library clips into this Project"** (sans-13, `text-text-secondary`).
- Sub-copy: **"Finder files become references — your originals stay where they are."** (mono-10, `text-text-tertiary`).
- No animation. No glow.

### 5.2 Finder drag-over (native Tauri)

Triggered by: `tauri://drag-enter` while a ProjectDetail is the active drop target.

- Border: `border-fuchsia border-2` (heavier dashed).
- Background: `bg-fuchsia-soft/20`.
- Copy swaps to: **"Drop here to attach to «Project name»"** (sans-13, `text-fuchsia-deep`).
- Sub-copy: **"Tauri Finder drop — Files become external references."**
- Subtle scale: `scale-[1.01]` with 120ms ease.

Triggered on the **entire ProjectDetail surface** (drag target = the whole `<RoomShell>` body), not just the dashed box — because Tauri's native drag is window-wide. The dashed box just visually anchors the affordance.

### 5.3 Library clip drag-over (HTML5)

Triggered by: any `dragenter` whose dataTransfer.types include `application/x-liquidclips-asset`.

- Border + background match Finder hover (visually identical).
- Copy swaps to: **"Drop to attach to «Project name»"** (sans-13).
- Sub-copy: **"Will pull in N clip«s» from «source project»"** if we can read the payload (we can — it's HTML5).
- If user drags over a ProjectCard in another tab (impossible cross-tab today — see §11.2), no-op.

### 5.4 Both hovers active simultaneously

Tauri's drag and HTML5's drag are mutually exclusive (you can't drag from Finder and Library at the same time). No state to design.

### 5.5 Drag-leave / drop-end

Border, background, and copy revert immediately. No 200ms fade — fade reads as "still working" and feels laggy.

### 5.6 After successful drop

1. Toast (top-center): **"Added N file«s» to «Project name»"** (info kind, 2.4s auto-dismiss).
2. New ProjectFileCard appears in the grid. Position: top of the grid (sort by `updated_at desc`). No scroll-into-view jolt.
3. The card animates in: fade + 8px y-translate over 180ms (matches existing `LayoutGroup` motion in ProjectsTab).
4. Drop zone returns to calm state.

### 5.7 Duplicate detection

`addMembership` is idempotent. If the dropped file's `asset_path` matches an existing membership row for this project:
- Toast: **"«filename» is already attached — bumped to most recent"** (info kind).
- The card's `updated_at` bumps; it animates to the top of the grid (already at top? subtle 60ms scale-pulse).
- No new card, no error.

### 5.8 Unsupported / weird files

Membership attachment is metadata-only — there's no "unsupported." Anything with a path attaches.

Edge cases handled gracefully:
- **Folder dropped**: attaches the folder path as `external`. Reveal opens the folder. Acceptable.
- **0-byte file**: attaches. The ProjectFileCard's `onError` fallback shows the file-type icon.
- **Bad characters in path**: addMembership accepts strings as-is.

The only "error" case is **a drop while the OS file picker is open** (existing race guard at `App.tsx:973-982`). Toast: **"Close the file picker before dropping a file."**

### 5.9 Drop zone scope

The drop zone visual is anchored in the Files section, but the drop event area is the full ProjectDetail body (Tauri drag-drop is window-level; HTML5 drag bubbles up). This is correct — the user can drop anywhere; the dashed box just signposts it.

---

## 6. Add from Library — final picker design

### 6.1 Decision: ONE-STEP flat clip picker

The current 2-step (project → clips) picker is the source of "Add from Library is broken." Replace with a one-step modal that shows clips directly. Project becomes a *label* on each clip, not a step.

### 6.2 Picker layout

Renders as a full-viewport modal (z-50, backdrop blur) — not a drawer inside ProjectDetail. The picker is a focused task; the surrounding ProjectDetail recedes.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Add from Library                                                      [✕] │
│ Pick clips to attach to «Walk Test».                                       │
│                                                                             │
│ [🔍 search clips, projects…  ]   ☐ Earn   ☐ Manual   ☐ Imports             │
│                                            sort: ▼ newest                  │
│                                                                             │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│ │ ☐ thumb │ │ ☑ thumb │ │ ☐ thumb │ │ ☐ thumb │ │ ☐ thumb │ │ ☐ thumb │    │
│ │         │ │         │ │         │ │         │ │         │ │         │    │
│ │ Clip A  │ │ Clip B  │ │ Clip C  │ │ Clip D  │ │ Clip E  │ │ Clip F  │    │
│ │ campaign│ │ campaign│ │ launch  │ │ launch  │ │ promo   │ │ promo   │    │
│ │ Earn    │ │ Earn    │ │ Manual  │ │ Manual  │ │ Import  │ │ Import  │    │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘    │
│                                                                             │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐                            │
│ │ ☐ thumb │ │ ☐ thumb │ │ ☐ thumb │ │ ☐ thumb │                            │
│ │         │ │         │ │         │ │         │                            │
│ │ Clip G  │ │ Clip H  │ │ Clip I  │ │ Clip J  │                            │
│ │ promo   │ │ promo   │ │ promo   │ │ promo   │                            │
│ │ Import  │ │ Import  │ │ Import  │ │ Import  │                            │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘                            │
│                                                                             │
│                            [Cancel]    [Add 1 clip to Walk Test →]         │
└────────────────────────────────────────────────────────────────────────────┘
```

### 6.3 Data fetching

On open:

1. Fire `sidecar.listProjects(200, false)` — get all non-archived project summaries (1 RPC, fast).
2. Filter to projects with `clips_count > 0` AND `slug !== <current project's slug>` to avoid self-attach.
3. In parallel, fire `sidecar.getProject(slug)` for each — this is the existing RPC.
4. Build a flat `{ clip, sourceProject }[]` list.
5. Sort by `sourceProject.updated_at desc` then clip index.

**Estimated cost:** 20 projects × ~30ms = ~600ms with parallelism. Cache the result in component state; don't refetch until close+reopen. Show a skeleton grid (6 dashed placeholders) during load.

### 6.4 Clip card design (inside picker)

```
┌───────────┐
│ ☐ ▶ 0:23  │  ← checkbox top-left, duration bottom-right
│           │
│  thumb    │  ← clip.thumbnails[0].path, fallback FileVideo icon
│           │
├───────────┤
│ Clip A    │  ← clip.title || basename(vertical_path) || clip.slug
│ campaign  │  ← sourceProject.whop_bounty_title || source_filename || slug
│ EARN      │  ← classifyProject(sourceProject) pill, color-coded
└───────────┘
```

On hover: card lifts (`y: -2`, 120ms), fuchsia border.
On click: toggles the selection state. Checkbox in top-left visually fills fuchsia.
Selected cards: `border-fuchsia` + `bg-fuchsia-soft/30`.

### 6.5 Search behaviour

Live filter:
- Matches against clip title, clip slug, sourceProject title, sourceProject slug, sourceProject project_type.
- Case-insensitive, includes-style.
- Empty search shows all clips.
- No clips match: shows the empty state inline (see 6.7).

### 6.6 Filter chips

Three checkable chips: **Earn**, **Manual**, **Imports**. Click toggles inclusion. None selected = show all. Multiple selected = OR (union).

`Imports` chip filters by `sourceProject.imported`. `Earn` filters by `sourceProject.whop_bounty_id`. `Manual` filters by the negation.

### 6.7 Empty states inside picker

| Trigger | Shown |
|---|---|
| Loading | 6 dashed skeleton tiles |
| No clips found across all projects | **"No Library clips yet."** + sub-copy **"Capture or import your first clip in Workspace, then come back."** + a single button **[Open Workspace]** (closes picker, navigates to `{ kind: "empty" }`). |
| Search returns 0 results | **"No clips match «query»."** + button **[Clear search]**. |
| Filters return 0 results | **"No clips match these filters."** + button **[Clear filters]**. |

### 6.8 Bottom action bar

- Left: `[Cancel]` (border-line, ghost).
- Right: `[Add N clips to «Project name»]` (fuchsia, disabled if N === 0).
- Selected count shown in the button label.
- Pressing the button writes N membership rows via `addMembership` in a single tick. Closes the modal on success. Fires a single toast: **"Added N clips to «Project name»."**

### 6.9 Keyboard

- `Esc` → cancel.
- `Cmd/Ctrl + A` → select all visible (after search/filter).
- `Enter` while focus is on a clip card → toggle that card's selection.
- `Enter` with N ≥ 1 selected and focus not in search → fire Add.
- `Cmd/Ctrl + F` → focus the search input.

### 6.10 Performance escape hatch

If Daniel's live install has > 50 projects with > 500 clips total, the picker may take > 1.5s to load. Acceptable for v0.7.76. Out of scope for this UX pass — add a sidecar method `list_library_clips(limit, offset)` later if performance becomes a real issue.

---

## 7. Project Files card design (the post-attach grid)

Single card spec — clips and memberships render identically.

```
┌──────────────────────────────┐
│                              │  ← 16:9 thumbnail area
│         thumbnail            │
│                              │
│                              │
├──────────────────────────────┤
│ launch.mp4                   │  ← title (line-clamp-1)
│ /Users/dipdip/Movies/...     │  ← path (line-clamp-1, mono-9)
│ from My First Campaign       │  ← source project (only if cross-project)
│ added Jun 14, 11:42          │  ← created_at (only for memberships)
│                              │
│ [ Reveal ] [ Move ] [Remove] │  ← action rail
└──────────────────────────────┘
```

### 7.1 Card dimensions

- Grid columns: `repeat(auto-fill, minmax(200px, 1fr))` (slightly larger than v0.7.76's 180px to give the action rail breathing room).
- Card height: auto; thumbnail aspect `16/10` (slightly taller than 16/9 for vertical clips).
- Border: `border-line`, hover `border-fuchsia`.
- Card hover: subtle lift `y: -2`, 120ms ease.

### 7.2 Thumbnail rules

| Asset type | Thumbnail |
|---|---|
| `clip` (project's own clip) | `clip.thumbnails[0].path` via `convertFileSrc`; fallback FileVideo icon |
| `render` membership | Same as clip if available; else FileVideo icon |
| `source` membership | FileVideo icon |
| `external` video file | FileVideo icon (no cover frame extraction — out of scope) |
| `external` image file | The image itself via `convertFileSrc(asset_path)`, `onError` → FileImage icon |
| `external` audio / other | FileIcon glyph + type label below |
| Folder (external folder drop) | FolderOpen glyph + type label |

### 7.3 Asset type pill (small, top-right of thumb area)

| Type | Pill |
|---|---|
| `clip` | none (clips are the default; pill would be noise) |
| `external` | "EXT" pill, neutral tone |
| `render` | "REND" pill, neutral tone |
| `source` | "SRC" pill, neutral tone |

Optional. Could omit to keep the card calm. Recommend: omit; let the icon convey type.

### 7.4 Source label

Only shown when `m.source_project_slug && m.source_project_slug !== currentSlug`. Format: **"from «source project title or slug»"** in mono-9, `text-fuchsia-deep`.

### 7.5 Action rail

- `Reveal` — opens the file's containing folder in Finder (F4 already wired correctly).
- `Move` — opens the Move picker (see 7.6).
- `Remove` — removes the membership row only. Toast: **"Removed «filename» — original still on disk."**

All three are `text-text-secondary` mono-9 pills with `border-line` ghost styling.
On Remove hover: red border + text. On Reveal/Move hover: fuchsia border.

### 7.6 Move action

Click `Move` → opens a small modal (NOT the full-screen Library picker — Move is just picking a destination project, no clip selection).

```
┌──────────────────────────────────────────┐
│ Move to project                      [✕] │
│ Choose a destination for «launch.mp4».    │
│                                          │
│ [🔍 search projects…  ]                  │
│                                          │
│ ┌──────────────────────────────────────┐ │
│ │ ◯ My First Campaign      Earn · 5    │ │
│ │ ◯ Walk Test              Manual · 0  │ │
│ │ ◯ Old Imports            Import · 23 │ │
│ └──────────────────────────────────────┘ │
│                                          │
│              [Cancel]    [Move →]        │
└──────────────────────────────────────────┘
```

After Move: `moveMembership(from, to, ...)` writes; toast: **"Moved «filename» to «target project»."**; the card disappears from current grid (membership left this project); target project's grid shows it on next mount.

### 7.7 Clip cards (project's own clips) — Move/Remove?

A project's OWN clips (in `project.clips`, written by the import/clip pipeline) live on disk inside the project folder. **Move/Remove on these is destructive** — would orphan files. **Decision: hide Move and Remove for own-clip cards.** Only show Reveal. The user can still open the workstation (`Open Workspace`) to manage own-clips via the existing per-clip surfaces (BottomCockpit, Reaction, etc.).

This matches v0.7.76 behaviour (Move/Remove only on memberships) — formalising it here.

---

## 8. Toast / success / error states

All toasts via the existing `lc:toast` CustomEvent host (already at App level). Spec:

| Action | Trigger | Copy | Kind | Duration |
|---|---|---|---|---|
| Create Project | After `create_blank_project` resolves | "Created «Project name»." | ok | 2.4s |
| Add file (single) | After `addMembership` resolves | "Added «filename» to «Project»." | info | 2.4s |
| Add file (multi) | After N memberships | "Added N files to «Project»." | info | 2.4s |
| Add file (duplicate detected) | `addMembership` hit existing id | "«filename» is already attached — bumped to top." | info | 2.4s |
| Add from Library success | After Add N clicked | "Added N clips to «Project»." | ok | 2.4s |
| Finder drop while picker open | App.tsx race guard | "Close the file picker before dropping a file." | warn | 2.4s |
| Move success | After `moveMembership` | "Moved «filename» to «target Project»." | ok | 2.4s |
| Remove success | After `removeMembership` | "Removed «filename» — original still on disk." | info | 2.4s |
| Reveal failure | `openSmart` throws | "Couldn't open Finder — «humanError»." | warn | 2.4s |
| Create Project failure | RPC error | "Couldn't create project: «humanError»." | warn | 2.4s |

Inline error (NOT toast):
- Add file fails because Tauri dialog returns null (user cancelled) → no toast, no error. Silent.
- Library picker RPC errors during load → render an inline error inside the modal: **"Couldn't load Library. Retry?"** + retry button.
- ProjectDetail's `sidecar.getProject(slug)` fails (slug deleted / Project.load throws) → existing error banner (`ProjectDetail.tsx:432-444`) — unchanged.

---

## 9. Disabled / loading states

| Surface | Loading | Disabled |
|---|---|---|
| Project Detail header | Title `animate-pulse` block + button skeleton row | All action buttons (Resume, Add file, Add from Library, Open folder) `disabled` until `loading === false` |
| Add file button (top-level + header) | `disabled` while OS picker is open (pickerOpenRef) | n/a |
| Add from Library button | `disabled` while the modal is opening (~one tick) | n/a |
| Library picker | Skeleton 6 dashed tiles | Add button disabled when `selected.size === 0` |
| Project Files grid | Inherit from ProjectDetail loading state | n/a |
| Drop zone | Calm state visible during loading; drops are queued? **Decision:** no — drops while `loading === true` are dropped with a toast "Loading project — try again in a moment." |
| Move modal | "Loading projects…" line | Move button disabled until a destination is selected |

---

## 10. Capture flow (F1 follow-up)

Today (post-F1):
- Click "Resume" on a blank Project → workstation opens with a "Capturing into «Project name» · back to project" pill.
- User pastes URL / drops video → import pipeline runs (IG-001) → new project created per pipeline.
- User clicks "back to project" → returns to original blank Project, which is still empty.
- User must manually use Add from Library to find the just-imported clip.

### 10.1 Final intent (designed here, NOT wired yet)

After a successful workstation ingest while `activeCaptureContext` is set:
1. The pipeline produces its own project per IG-001 (unchanged).
2. The new project's clips are **auto-attached** as memberships to the origin Project (the one named in `activeCaptureContext`).
3. Toast: **"Added N clips to «Project name» from Workspace."**
4. The capture pill grows a "Back to «Project»" prominent CTA (already there) AND a sub-link **"View attached →"**.

### 10.2 Wiring sketch

This needs a small new App.tsx subscription:
- After the existing `lc:library-refresh` fires (which signals a new project landed in the on-disk list),
- AND `activeCaptureContext` is non-null,
- AND the new project's `created_at` is later than `activeCaptureContext.armedAt`,
- THEN fetch that project's clips via `sidecar.getProject` and bulk-add memberships to `activeCaptureContext.slug`.

Edge cases:
- Multiple projects land in rapid succession (e.g. cancel-and-retry): use the most recent by `created_at`.
- Capture pill cleared before pipeline completes: skip auto-attach (consistent with "back to project" being a user-initiated exit).
- Capture project is deleted while user is in workstation: addMembership succeeds against a non-existent project; the row is orphaned but harmless. Acceptable — `addMembership` doesn't stat the target project.

### 10.3 Rename of "Resume" → "Open Workspace"

For blank Projects (no clips, no source path), the button label is **"Open Workspace"** instead of "Resume" (Resume implies pre-existing work). For populated Projects, keep **"Resume"**.

Logic already exists in F1 — just the label needs a conditional swap.

---

## 11. Hand-walk checklist (the contract the implementation must pass)

To be performed against the freshly-installed app after the next build.

### 11.1 Create + open
- [ ] Projects tab loads. Header shows `Organise your clips around campaigns, clients, and earning goals.` + New Project / Add file (NO top-level Add from Library button — that's removed; F5 unchanged).
- [ ] Click New Project. Modal opens; name "Hand Walk", Manual, goal "verify". Create.
- [ ] Project Detail mounts. Title "Hand Walk", Manual pill, 0 clips, goal visible.

### 11.2 Empty Project state
- [ ] Files section shows the "Three ways to fill it" empty-state grid (§4): Open Workspace + Add file + Add from Library tiles.
- [ ] Footer hint: "Or drag files or Library clips anywhere on this screen."

### 11.3 Add file (Finder picker)
- [ ] Click Add file → Finder picker → pick any single file.
- [ ] Toast: "Added 1 file to Hand Walk."
- [ ] Empty state replaced by Project Files grid with 1 card.
- [ ] Re-select same file → toast: "«filename» is already attached — bumped to top."

### 11.4 Add from Library
- [ ] Click Add from Library → **full-viewport modal opens** with skeleton tiles.
- [ ] After load: clips appear as cards with thumbs, source-project labels, type pills.
- [ ] Search "first" → grid filters live to clips whose title or source matches.
- [ ] Click Earn chip → only Earn-sourced clips remain.
- [ ] Tick 3 clips → button reads "Add 3 clips to Hand Walk".
- [ ] Click Add → modal closes, toast "Added 3 clips to Hand Walk", grid has 3 new cards from prior projects with "from «source»" labels.

### 11.5 Drag Finder file into Project
- [ ] Drag a video file from Finder over Project Detail.
- [ ] Drop zone (and the surrounding body — it's a window-level event) lights fuchsia.
- [ ] Copy swaps to "Drop here to attach to Hand Walk".
- [ ] Release.
- [ ] Toast + new card.

### 11.6 Drag Library clip into Project
- [ ] **Cross-tab note:** this gesture is impossible today because Library tab and Projects tab are mutually exclusive views (audited in PROJECTS_MANAGER_GAPS_AND_FIXES §4 Bug 2b). The Add from Library picker REPLACES this gesture. The hand-walk item is satisfied by the picker.
- [ ] *If* (future) a Library mini-rail is added inside ProjectsTab, the same drag handler in ProjectDetail.onDropFromCard handles it; no UX change needed.

### 11.7 Project Files grid updates immediately
- [ ] Add file / drag / picker — in all three, the grid updates without a manual refresh (existing `lc:memberships-changed` event).
- [ ] Open another window of the app (if possible) → events fire across windows? No — Tauri windows have separate JS contexts. Out of scope.

### 11.8 Move item to another Project
- [ ] Right-click or click `Move` on a card.
- [ ] Move modal opens with a project list (search-filterable).
- [ ] Pick a target → toast "Moved X to «target»".
- [ ] Card disappears from current grid; appears in target's grid on mount.

### 11.9 Remove item without deleting source
- [ ] Click `Remove` on a membership card.
- [ ] Card disappears, toast "Removed X — original still on disk."
- [ ] In Finder, confirm the source file still exists.

### 11.10 Reveal item in Finder
- [ ] Click `Reveal` on a card.
- [ ] **Finder opens to the containing folder.** Not Quick Look. Not the default app.

### 11.11 Open Project folder
- [ ] Click `Open folder` in the header.
- [ ] Finder opens at `~/LiquidClips/projects/hand-walk/`.

### 11.12 Return from workstation/capture back to Project
- [ ] On Hand Walk (blank), click `Open Workspace`.
- [ ] Workstation mounts; "Capturing into Hand Walk · back to project" pill visible at top-center.
- [ ] Paste a YouTube URL → pipeline runs to completion.
- [ ] Toast: "Added N clips to Hand Walk from Workspace."
- [ ] Click "back to project" pill → Hand Walk Detail; the newly imported clips appear as memberships in the grid with "from «pipeline-project-slug»" labels.

---

## 12. Implementation plan — visual-only vs logic

### 12.1 Visual-only (no behavior change, just rendering changes)

| # | Change | File | Risk |
|---|---|---|---|
| V1 | Drop zone copy + size + state styling (calm, Finder-hover, Library-hover) | `ProjectDetail.tsx` | None |
| V2 | Empty Project "three tiles" grid | `ProjectDetail.tsx` | None |
| V3 | ProjectFileCard polish (size, action rail spacing, source-label label) | `ProjectDetail.tsx` (inner `ProjectFileCard`) | None |
| V4 | Library picker modal layout (full-viewport, skeleton, search, chips, clip card) | `ProjectDetail.tsx` (rewrite picker subsection) OR new `AddFromLibraryModal.tsx` | None |
| V5 | Rename "Resume" → "Open Workspace" on blank Projects | `ProjectDetail.tsx` | None |
| V6 | Move modal (simplified destination picker, separate from Library modal) | `ProjectDetail.tsx` | None |
| V7 | Toast copy alignment per §8 | `ProjectDetail.tsx`, `ProjectsTab.tsx`, `App.tsx` | None |

### 12.2 Logic changes

| # | Change | File | Risk |
|---|---|---|---|
| L1 | Library picker fetches ALL projects' clips in parallel and flattens | `ProjectDetail.tsx` picker section | Low — N parallel `getProject` calls; existing RPC; no sidecar change |
| L2 | Hide Move/Remove on own-clip cards (memberships only) | `ProjectDetail.tsx` `ProjectFileCard` props | Low |
| L3 | Auto-attach captured clips after workstation ingest while `activeCaptureContext` is set | `App.tsx` — new `useEffect` subscribed to `lc:library-refresh` | **Medium** — touches App.tsx near IG-001 boundaries. Must be additive: read the new project on `lc:library-refresh`, call `addMembership` for each clip, leave `handleImportDirect` / pipeline untouched |
| L4 | Drop-while-loading toast | `App.tsx` drop handler | Low |
| L5 | `Cmd/Ctrl + A` / `Cmd/Ctrl + F` / `Esc` keyboard for picker | `ProjectDetail.tsx` picker | Low |

### 12.3 Out of scope (defer)

- Cross-tab drag (Library tab → Projects tab while dragging) — physically impossible without a persistent sidebar; **defer**.
- Cover-frame extraction for external video memberships — requires ffmpeg; **defer**.
- Batch-select multiple cards in Project Files grid — useful but out of scope.
- A sidecar `list_library_clips` RPC for performance — only needed if user has > 50 projects; defer.
- File-existence stat-check on every membership render (already deferred from v0.7.73 scope).
- Drop zone accepting multiple Finder paths in one drop (already handles arbitrary N).

---

## 13. Smallest patch plan (the order to wire after this doc is approved)

### Sprint 1: Library picker rewrite (the biggest UX win)
- Refactor `ProjectDetail.tsx` picker section into a self-contained component or sub-tree.
- Replace 2-step (project → clips) with 1-step flat clip grid.
- Parallel `getProject` fetch with skeleton.
- Search + filter chips.
- Selection state + Add N button.
- Empty states per §6.7.
- Keyboard per §6.9.

### Sprint 2: Project Detail polish
- New empty-state "three tiles" grid (§4).
- Drop zone copy + size + state styling (§5).
- "Resume" → "Open Workspace" on blank Projects (V5).
- Hide Move/Remove on own-clip cards (L2).
- Toast copy alignment (V7).

### Sprint 3: Move modal
- Extract Move action to a small dedicated modal (§7.6).
- Replace the current reuse-the-Library-picker pattern.

### Sprint 4: Capture flow auto-attach
- App.tsx subscription that auto-attaches the most recently imported project's clips to `activeCaptureContext.slug` (§10.1).
- Toast (§8 row).
- Capture pill "View attached →" sub-link.

### Sprint 5 (defer if time-bound): keyboard, batch select, performance escape hatch.

---

## 14. Iron-gate compliance review

- **IG-001 import pipeline:** untouched. Sprint 4 reads completed projects via `lc:library-refresh` and writes memberships AFTER the pipeline lands; no edit to `handleImportDirect`, no edit to `method_import_ready_clips`, no edit to `project.py` factories.
- **IG-002 sidecar RPC contract:** no new RPCs. Picker uses existing `listProjects` + `getProject`.
- **IG-005/006 cockpit handoffs:** Project Detail surfaces are outside the cockpit's `BottomCockpit` / `ReactionControls` ownership. Capture pill is window-level fixed and doesn't mount inside ClipPreview. No conflict.
- **IG-008 / IG-011 room scrollability:** Project Detail mounts under `<RoomShell roomKey="library" align="top">`. The new modal picker is `fixed inset-0` (z-50) — outside the RoomShell scroll wrap. No regression.
- **IG-014 auth-keychain invariant:** zero auth changes. `assert-no-passive-keychain.sh` + `test:invariant` must stay green; no new Keychain reads in any of V1–V7 or L1–L5.

---

## 15. Final report request

Per Daniel's directive:

1. **Final intended UX** — see §3–§10.
2. **Current gaps against that UX** — see §16.
3. **Files that need wiring** — see §17.
4. **Smallest patch plan** — see §13.
5. **Visual-only vs logic split** — see §12.1, §12.2.

---

## 16. Current gaps (post-v0.7.76 install) against the final UX

| UX item | Current state (live app) | Gap | Fix sprint |
|---|---|---|---|
| Project Detail layout | matches §3 broadly, but action rail crowded | minor polish | Sprint 2 |
| Empty Project state | shows "This Project is empty" text only, no 3-tile grid | replace with §4 design | Sprint 2 |
| Drop zone calm state | shows dashed strip with two lines | size + copy update | Sprint 2 |
| Drop zone Finder hover | F2 wired (zone lights fuchsia on `tauri://drag-enter`) | copy swap to "«Project name»" not yet done | Sprint 2 |
| Drop zone Library hover | works (existing `application/x-liquidclips-asset`) | copy swap not yet done | Sprint 2 |
| After-drop behaviour | toast + card appear | duplicate-detection toast copy generic ("Bumped to most recent" not yet wired) | Sprint 2 |
| Add from Library | **2-step project → clips picker, looks like project rows** | full rewrite per §6 | **Sprint 1 (P0)** |
| Project Files cards | thumb + path + actions present | source label format / hide Move/Remove on own-clips | Sprint 2 |
| Move action | reuses Library picker UI | extract to dedicated modal per §7.6 | Sprint 3 |
| Remove copy | toast says "Removed from project" | refine to "Removed X — original still on disk." | Sprint 2 |
| Reveal | F4 wired correctly | none | done |
| Open folder | works | none | done |
| Capture flow | F1 pill works; no auto-attach | add §10.1 auto-attach | Sprint 4 |
| Toast copy | partial alignment with §8 | per-action copy update | Sprint 2 |
| Disabled/loading | partial | apply §9 spec | Sprint 2 |

**Critical (P0) gap:** the Library picker rewrite. Without this, Daniel's "Add from Library is broken" verdict stands.

---

## 17. Files needing wiring (the next implementation pass)

| File | Sprints touched | Iron-gate concern |
|---|---|---|
| `desktop/src/components/projects/ProjectDetail.tsx` | 1 (picker), 2 (empty state + drop zone + cards), 3 (Move modal) | None — file is not gated |
| `desktop/src/components/projects/AddFromLibraryModal.tsx` (NEW) | 1 | None |
| `desktop/src/components/projects/MoveToProjectModal.tsx` (NEW, optional) | 3 | None |
| `desktop/src/App.tsx` | 4 (capture auto-attach subscription) | Must stay clear of IG-001 (`handleImportDirect`, `method_import_ready_clips`) — additive read of `lc:library-refresh` only |
| `desktop/src/components/projects/ProjectsTab.tsx` | minor (toast copy alignment) | None |
| `desktop/src-tauri/Cargo.toml` (optional version bump) | n/a | None |
| `docs/PROJECTS_MANAGER_GAPS_AND_FIXES.md` | post-implementation update | n/a |
| `docs/PROJECTS_DRAG_DROP_ADD_FROM_LIBRARY_FINAL_UX.md` | this file (the contract) | n/a |

**No sidecar files.** No `python-sidecar/*` files. No `sidecar.ts` RPC additions. IG-002 contract untouched.

---

## 18. What ships when

The Iron Gate is satisfied when Sprints 1 + 2 + 3 land. Sprint 4 (capture auto-attach) is high-value but optional for the gate — the user still has Add from Library to manually attach after capture.

Daniel approves the design (this doc) → wire Sprints 1–3 → validation gates → build → install → hand-walk.

**This doc is the contract. No further wiring without it.**

---

## Stop condition reached

Awaiting Daniel's approval of the final UX before any code change.
