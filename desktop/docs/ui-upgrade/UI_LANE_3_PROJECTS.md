# UI Lane 3 — Projects

**Lane status:** `START NOW — visual-only, no editor collision`
**Owner:** Kimi C
**Read first:** `desktop/docs/UI_UPGRADE_MASTER_SCOPE.md`, `docs/PROJECTS_MANAGER_GAPS_AND_FIXES.md` (Sprints 1–4 baseline), `docs/PROJECTS_DRAG_DROP_ADD_FROM_LIBRARY_FINAL_UX.md` (final UX contract).
**Validation gates:** `npx tsc -b`, `npm run test:invariant`, `bash scripts/assert-no-passive-keychain.sh`.

> **The Projects manager is already shipped through Sprint 4 (v0.7.76 hand-walked).**
> Lane 3 is a **light polish pass only** — atmosphere plate, brand-token alignment, copy + button taxonomy adoption, and a few P2/P3 niceties. **NO architectural changes. NO new modals. NO Sprint 5 work.**

---

## 1. Scope

Sprints 1–4 of the Projects manager already delivered:
- Sprint 1: AddFromLibraryModal (full-viewport modal, flat clip grid, search, filter chips, multi-select, empty states, keyboard).
- Sprint 2: Drop-zone state copy (V1), 3-tile empty state grid (V2), grid card width 200px (V3), Reveal-in-Finder fix (V4), "Open Workspace" label on blank Projects (V5), toast copy alignment (V7).
- Sprint 3: MoveToProjectModal (centered destination-only modal, search, current-project excluded).
- Sprint 4: Capture auto-attach (workstation-imported clips auto-attach to origin Project).

Lane 3 polishes:
- Atmosphere plate adoption.
- Button taxonomy adoption (apply Lane 1's `.btn-*` classes).
- Skeleton + empty + error state class adoption (Lane 1's shared classes).
- Project card hover / focused state alignment with Lane 2's ClipCard chips.
- A small set of P2/P3 niceties documented in §5.

---

## 2. Files owned by this lane

| File | Why |
|---|---|
| `desktop/src/components/projects/ProjectsTab.tsx` | Projects list, empty state, filter chips, top header |
| `desktop/src/components/projects/ProjectDetail.tsx` | Project Detail view + drop zone + Project Files grid |
| `desktop/src/components/projects/ProjectCard.tsx` | Per-project tile in list |
| `desktop/src/components/projects/NewProjectModal.tsx` | New Project create modal |
| `desktop/src/components/projects/AddFromLibraryModal.tsx` | Sprint 1 modal — visual polish only |
| `desktop/src/components/projects/MoveToProjectModal.tsx` | Sprint 3 modal — visual polish only |
| `desktop/src/components/projects/ProjectsLockedScreen.tsx` | Free-tier locked state |
| `desktop/src/lib/projectMemberships.ts` | NO changes — store contract |
| `desktop/src/lib/dropContext.ts` | NO changes — drop routing |

## 3. Files forbidden to this lane

- All editor-blocked files (master §7).
- All `components/earn/*` (Lane 4).
- `App.tsx`, `index.css`, `SideNav.tsx`, `RoomShell.tsx`, `Splash.tsx`, `FirstRun.tsx`, `WorkstationRoom.tsx`, `AvatarPanel.tsx`, `AvatarOrbit.tsx` (Lane 1).
- `Settings.tsx`, `UpgradeLockCard.tsx`, `PublishModal.tsx`, `PlatformIcon.tsx`, `FailureCard.tsx`, `SidecarCrashOverlay.tsx`, `CommunityTab.tsx`, `schedule/*` (Lane 5).
- `python-sidecar/*`, `lib/sidecar.ts`, `lib/activation.ts`, `lib/authStorage.ts`, `App.tsx`.

---

## 4. Target demo / brand references

| Surface | Reference | Strictness |
|---|---|---|
| Projects list / cards | `desktop/docs/demo-pages.html` Projects deck | **CONTRACT** (IG-012) |
| Project Detail | `desktop/docs/demo-pages.html` Project Detail | **CONTRACT** (IG-012) |
| ProjectCard chrome | `desktop/docs/demo-pages.html` project card (matches Library card sibling) | **CONTRACT** |
| Atmosphere plate | `desktop/docs/BRAND_ATMOSPHERE_QUEUE.md` — Projects uses `.deck-clips` atmosphere (shares with Library per the deck taxonomy) | REFERENCE |

---

## 5. Page-by-page UI outcomes

### 5.1 ProjectsTab (projects list)

**Current state (post-Sprint 2 V2 + V5):**
- Header: eyebrow "PROJECTS" + H1 "Organise your clips around campaigns, clients, and earning goals." + New Project / Add file / Refresh.
- Filter chips: All / Earn / Manual / Imports / Archived with counts.
- Search input.
- Empty state: "Create a Project" primary + "or import a clip in Workspace" text link (F5 cleanup landed).
- Card wall: motion grid, `auto-fill, minmax(260px, 1fr)`.

**Cold-customer issues:**
- Header H1 is good but the eyebrow + 3 buttons row visually competes with the H1.
- Filter chips work but the count badges feel cramped.
- File-target picker (when 2+ projects exist) renders as an inline `<section>` — visual chrome doesn't match Modal pattern.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Header row | Use Lane 1's `.btn-primary` for New Project and `.btn-secondary` for Add file. Refresh icon button gets `aria-label="Refresh"` + `title="Refresh projects"` |
| H1 | Preserve copy. Add atmosphere plate behind the page via Lane 1's deck class (`.deck-clips`) once Lane 1 lands the hook |
| Filter chips | Existing `HudChip` — preserve. Count badge spacing: `ml-1.5` (current) is fine; mono-text-[10px] preserved |
| Search input | Preserve. Use Lane 1's `.btn-ghost` styling for the search container |
| Empty state | Use Lane 1's `.empty-state` class (replaces hard-coded `rounded-2xl border border-dashed border-line bg-paper-elev/40 p-6`). Primary CTA `.btn-primary`. Secondary `.btn-ghost` text-link |
| File-target picker | Convert from inline `<section>` to a centered modal (same chrome as MoveToProjectModal). New file: keep the picker structure but mount with `fixed inset-0 z-50 flex items-center justify-center` |
| Card wall | Preserve motion grid. Minor: bump `minmax(260px, 1fr)` → `minmax(280px, 1fr)` for slightly more breathing room on action rail |

**Cold-customer next action:** "Click New Project, drop a video, or import in Workspace."

**Files:** `ProjectsTab.tsx`.

---

### 5.2 ProjectDetail (project detail surface)

**Current state (post-Sprint 1 + 2 + 3):**
- Header: eyebrow + H1 + pills + 6-button action rail (Open Workspace/Resume + Add file + Add from Library + Open folder + [Whop brief + Submit if Earn]).
- Bounty context block (Earn only).
- Source block.
- Project Files: drop zone with 3 state copy (V1) + 3-tile empty state (V2) + 200px grid (V3) + ProjectFileCard.
- Mounted modals: AddFromLibraryModal (Sprint 1), MoveToProjectModal (Sprint 3).

**Cold-customer issues:**
- Action rail with 4–6 pills can wrap awkwardly on narrow window.
- Drop zone copy is correct per Sprint 2 V1, but the calm-state appears too quiet — first-timer may not see it.
- 3-tile empty state has good copy but each tile uses inline button styling that doesn't match Lane 1's tile pattern.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Action rail | Use Lane 1 button taxonomy: Resume / Open Workspace = `.btn-primary` (fuchsia pill); Add file = `.btn-secondary`; Add from Library = `.btn-secondary`; Open folder = `.btn-ghost`; [Open Whop brief] = `.btn-ghost`; [Submit clip] = `.btn-secondary` |
| Action rail wrap | On window < 900px, action rail should not horizontal-scroll; wrap cleanly with `flex-wrap gap-2` (current) — preserve |
| Drop zone calm state | Existing copy preserved per Sprint 2 V1. Increase `py-8 px-6` → `py-10 px-8` for stronger visual presence. Background opacity unchanged |
| Drop zone hover (Finder) | Preserve copy + fuchsia border. Add `scale-[1.005]` (already there) |
| Drop zone hover (Library) | Preserve copy + fuchsia border |
| Empty Project 3-tile grid | Preserve copy + structure. Each tile uses Lane 1's `.btn-ghost` border but with the icon halo and 2-line sub-copy (current). Apply `.empty-state` class to the wrapper |
| ProjectFileCard | Preserve Sprint 2 chrome. Optional: align status pill with Lane 2's chip rail naming (EXT / REND / SRC / CLIP) for consistency — defer if Lane 2 not yet shipped |
| Move/Remove action rail (per Sprint 2 L2) | Hidden on own-clip cards — preserve |
| Toasts | Preserve Sprint 2 V7 alignment ("Added X to Project", "Removed X — original still on disk", "Moved X to Y", etc.) |

**Files:** `ProjectDetail.tsx`.

---

### 5.3 ProjectCard

**Current state (per-project tile in list):**
- HUD bracket corners + type pill + RPM chip (Earn) + cover thumb / placeholder + title + clips_count chip + goal line + action rail (Open Folder + Archive + Delete).
- HTML5 drop target for `application/x-liquidclips-asset`.

**Cold-customer issues:**
- Type pill (Earn / Manual / Import) doesn't visually distinguish Earn (fuchsia-soft already correct) but Manual + Import look identical (`bg-paper-elev/80`).
- Status badge (in progress / done / failed / archived) is text only — no chip background.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Type pill | Earn = `bg-fuchsia-soft/40 text-fuchsia-deep` (current — preserve). Manual = `bg-paper-elev/80 text-text-secondary` (current). Import = add subtle `border border-line/50` to distinguish from Manual |
| Status badge | Convert from text-only to small chip: in progress = `bg-paper-elev/40 text-text-tertiary`; done = `bg-fuchsia-soft/30 text-fuchsia-deep`; failed = `bg-[var(--color-danger)]/20 text-[var(--color-danger)]`; archived = `bg-paper-elev/40 text-text-tertiary` |
| Cover thumb | Preserve. Hover thumb gets `border-fuchsia` (current — preserve) |
| Drop hover ring | Preserve outline + bg fuchsia-soft (current) |
| Action rail | Open Folder / Archive / Delete icons preserve. Delete hover → `border-[var(--color-danger)]` (current — preserve) |
| Title hover | Existing `group-hover:text-fuchsia-deep` — preserve |
| Goal line | Existing 2-line clamp — preserve |

**Files:** `ProjectCard.tsx`.

---

### 5.4 ProjectsLockedScreen (free-tier locked state)

**Current state:** Eyebrow + H1 + locked copy + Upgrade primary + Browse Earn / Open Library secondaries.

**Cold-customer issues:**
- Already passes the 5-question test. Minor polish: button taxonomy adoption.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Upgrade primary | `.btn-primary` with arrow → |
| Browse Earn / Open Library | `.btn-secondary` |
| H1 | "Organise clips into campaigns, clients, and earning goals." (current — preserve) |
| Body | "Projects are included with Liquid Clips Pro…" (current — preserve) |

**Files:** `ProjectsLockedScreen.tsx`.

---

### 5.5 NewProjectModal (create blank project)

**Current state:** Centered modal — name input + type radio (Manual/Content/Client/Import) + goal input + Cancel / Create.

**Cold-customer issues:**
- Type radio offers 4 options but no help text explaining each type.
- Goal is "optional" — cold customer doesn't know if it matters.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Modal chrome | `bg-paper-warm` (current — preserve). Backdrop blur. |
| Name input | Preserve. Placeholder "e.g. Sunday reel batch" (current) |
| Type radio | Existing 2x2 grid with `label + hint`. Hints currently: "Free-form workspace.", "Recurring publishing goal.", "Work organised per client.", "Container for imported clips." — preserve |
| Goal input | Label "Goal · optional" (current — preserve). Add a small "Skip if you're just exploring" sub-hint at right side of label |
| Buttons | Cancel = `.btn-secondary`; Create = `.btn-primary` with arrow → |

**Files:** `NewProjectModal.tsx`.

---

### 5.6 AddFromLibraryModal (Sprint 1 polish)

**Current state:** Full-viewport modal with skeleton tiles → clip grid + search + Earn/Manual/Imports filter chips + multi-select + "Add N clips to Project" CTA.

**Cold-customer issues:**
- None major — Sprint 1 hand-walked clean.
- Polish: bottom action bar `.btn-primary` adoption + tile selection state minor refinement.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Modal chrome | Existing `fixed inset-0 z-50 flex flex-col bg-paper/95 backdrop-blur-md` — preserve |
| Header | Preserve eyebrow + H2 + close X |
| Search + filter chips | Preserve. Filter chip uses Lane 1's chip pattern when standardized |
| Skeleton tiles | Use Lane 1's `.skeleton` class on inner blocks |
| Clip tile | Preserve aspect-video thumb + checkbox top-left + title + source-project + type pill |
| Selected state | Preserve `border-fuchsia bg-fuchsia-soft/30` |
| Bottom bar | Cancel = `.btn-secondary`; Add N = `.btn-primary` |
| Empty states (No Library clips / search no results / filter no results) | Preserve copy. Use Lane 1's `.empty-state` for container |

**Files:** `AddFromLibraryModal.tsx`.

---

### 5.7 MoveToProjectModal (Sprint 3 polish)

**Current state:** Centered modal — search + destination project list (current excluded) + "Move to Project name" CTA.

**Cold-customer issues:** None major.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Modal chrome | Preserve |
| Header | Preserve eyebrow + H2 + filename highlight |
| Search | Preserve |
| Destination row | Preserve radio dot + project name + clip count + type |
| Selected state | Preserve `border-fuchsia bg-fuchsia-soft/30` |
| Buttons | Cancel = `.btn-secondary`; Move to {Target} = `.btn-primary` |
| Empty / search-no-results | Use Lane 1's `.empty-state` |

**Files:** `MoveToProjectModal.tsx`.

---

## 6. Copy improvements

| Surface | Old | New |
|---|---|---|
| NewProjectModal goal sub-hint | (none) | "Skip if you're just exploring" |
| ProjectsTab empty state | Preserve copy — no change |
| ProjectDetail action rail labels | Preserve — Sprint 2 V5 already correct |
| Toasts | Preserve Sprint 2 V7 alignment |

---

## 7. Icons / accents

- Preserve lucide icons used in Sprints 1–4 (FilePlus, Layers, Plus, RefreshCw, Search, ArrowLeft, ExternalLink, FileImage, FileVideo, FolderOpen, Play, Send, CheckSquare, Square, X).
- No new icons.

---

## 8. Buttons / cards / tables specific to Lane 3

- Apply Lane 1's button taxonomy classes throughout the lane's surfaces.
- Card chrome: preserve existing `.library-card` + HUD bracket pattern (IG-007 sibling).
- No tables in Projects.

---

## 9. Cold-customer hand-walk for this lane

Run after Lane 3 ships:

- [ ] **Open Projects** as free-tier user → ProjectsLockedScreen renders → 3 CTAs with consistent button styling.
- [ ] **Open Projects** as paid user → header eyebrow + H1 + 3 header buttons using `.btn-primary` / `.btn-secondary`.
- [ ] **Empty state** → "Create a Project" primary + "or import a clip in Workspace" link.
- [ ] **Click New Project** → modal opens; type radio + 1-line hint per option; goal input + "Skip if you're just exploring" sub-hint.
- [ ] **Create blank** → Project Detail mounts; action rail uses `.btn-primary` (Open Workspace) + 4 `.btn-secondary` / `.btn-ghost`.
- [ ] **Drop zone** → calm-state padding feels generous; copy reads "Drop files or Library clips into this Project".
- [ ] **3-tile empty state** → Open Workspace / Add file / Add from Library tiles with icon halo + sub-copy.
- [ ] **Add file** → Finder picker → cards appear; toast "Added 1 file to {Project}".
- [ ] **Add from Library** → full-viewport modal → search / chips / select → "Add N clips to {Project}" `.btn-primary`.
- [ ] **Move** → centered modal → search + destination list → "Move to {Target}" `.btn-primary`.
- [ ] **Project card chrome** in list → status badge is a chip (not plain text); type pill distinguishes Earn / Manual / Import.
- [ ] **Validation gates** all green.
- [ ] **No Keychain prompt** at any point.

---

## 10. Cross-lane requests

Lane 3 may need:

- **From Lane 1:** `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, `.empty-state`, `.skeleton`, `.error-banner` classes. Lane 3 cannot ship before Lane 1 lands these.
- **From Lane 2:** ClipCard chip rail naming for cross-surface consistency (REACT / CAPTIONED / EARN). Lane 3's ProjectFileCard adopts the same.

Lane 3 may receive requests from:

- **Lane 4:** Earn project detail (when a bounty is started → a Project is created) re-uses Lane 3's ProjectDetail. Lane 4 verifies bounty context block continues to render correctly.

---

## 11. Validation commands

```bash
cd /Users/dipdip/code/jnr/desktop
npx tsc -b
npm run test:invariant
bash scripts/assert-no-passive-keychain.sh
```

No `brand-kit-drift-check.sh` unless Lane 3 modifies `index.css` (it should not — Lane 1 owns).

---

## 12. Iron-gate compliance

- **IG-001** (Import pipeline): untouched. Lane 3 reads existing `project.clips` only.
- **IG-002** (Sidecar RPC contract): no new RPCs. Lane 3 uses existing `listProjects`, `getProject`, `createBlankProject`, etc.
- **IG-007** (ClipCard structure): ProjectFileCard chrome is sibling to ClipCard — preserve `.library-card` HUD bracket pattern.
- **IG-008** (RoomShell scroll): ProjectsTab + ProjectDetail mount under `<RoomShell roomKey="library" align="top">` — preserve.
- **IG-012** (Brand-token parity): no `index.css` change in Lane 3.
- **IG-014** (Auth-keychain invariant): zero auth changes.

---

## 13. What's NOT in this lane

- Sprint 5 / 6 / 7 work on Projects — defer.
- New project actions beyond what Sprints 1–4 ship — defer.
- Project sharing / collaboration — defer.
- Project export — defer.
- Atmosphere plate asset generation — separate lane (gpt-image-1 queue).

---

## 14. Stop condition

Lane 3 ships when:
- All §5 page-by-page outcomes pass.
- §9 hand-walk is green per Daniel.
- §11 validation gates clean.
- §12 iron-gate compliance verified.

No commit, push, tag, release, or `latest.json` update without Daniel's explicit per-batch approval.

**End of Lane 3 sub-doc.**
