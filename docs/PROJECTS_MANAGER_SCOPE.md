# Projects Manager — v0.7.73 scope

Read-only audit + forward-looking implementation plan. Repo:
`/Users/dipdip/code/jnr`. Local-first. No backend, no DB, no schema
migrations, no DnD library, no new sidecar methods unless explicitly
named below.

Daniel's goal: *"A user can create a Project, add clips to it, drag
clips into it, move clips between Projects, open the folder, and
understand the earning/outcome context."*

---

## 1. Current Projects implementation — what exists today

| Concern | File | What it does | Limit |
|---|---|---|---|
| Projects tab | `desktop/src/components/projects/ProjectsTab.tsx:46-298` | Lists `sidecar.listProjects(200, true)` results, filter chips (all / earn / manual / imports / archived), search box, archive + delete handlers, broadcast-aware (`lc:library-refresh` at L82-87). | No "New Project" button (L176-186 is only Refresh). No DnD. No path to create a project without first running the clip pipeline. |
| Project card | `desktop/src/components/projects/ProjectCard.tsx:39-228` | TYPE pill (`Earn` / `Manual` / `Import` via `classifySummary` L27-31), status, RPM pill, clip count, open / open-folder / archive / delete. | No drop target. No drag-source. No rename. |
| Project detail | `desktop/src/components/projects/ProjectDetail.tsx:47-372` | Reads `sidecar.getProject(slug)` + `useMemberships(slug)`, header w/ Resume/Add clip/Open folder/Submit, bounty context, sources, clips count summary, attached-from-library rows w/ Remove. | `onAddClip` (L51) currently jumps to workstation (App.tsx:1638 → `kind: "empty"`). No "Add from Library" picker. No drop target. No rename. No goal/outcome edit. |
| Memberships store | `desktop/src/lib/projectMemberships.ts:1-246` | `$APPDATA/project_memberships.json` v1; `addMembership` (idempotent), `removeMembership`, `moveMembership` (already implemented L176-211), `listMemberships*`, `useMemberships` hook, broadcasts `lc:memberships-changed` on every write (L84-90). | Asset_type union is `clip | render | source | external` — no `local_file` type, but `external` covers Finder drops. |
| Add-to-Project picker | `desktop/src/components/cockpit/LibraryQuickPreview.tsx:52-84,150-229` | Lazy-loads non-archived projects, attaches via `addMembership` w/ `source_project_slug = project.slug`. | One-way only (Library → Project). No inverse (Project → pick from Library). |
| `sidecar.Project` type | `desktop/src/lib/sidecar.ts:556-579` | Carries id, slug, root, source_path, source_filename, created_at, brief, intent, all `whop_bounty_*`, stages, clips. | No `title`, `goal`, `outcome`, `tags`, `notes` fields. `brief` is the only user-editable freeform string. |
| `sidecar.listProjects` | `sidecar.ts:782-783`, `sidecar.py:481-617` | Reads `~/LiquidClips/projects/`, returns `ProjectLibrarySummary[]`. Skips tombstoned + `.archived`-marked. | Limit cap 500 server-side. |
| `sidecar.getProject` | `sidecar.ts:781`, `sidecar.py:472-477` | Calls `Project.load(slug)` → raises `ValueError("project not found: {slug}")` if dir missing. | Will throw if slug doesn't resolve under `CLIPS_HOME/projects/`. |
| `Project.create` | `python-sidecar/project.py:521-576` | Validates source path (must live in user video dirs), slugifies, disambiguates with `-2/-3`, creates SUBDIRS, writes project.json via `proj.save()`. | **Requires a real `source_path`** — `_validate_source_path` (L530-535) rejects empty / non-existent. Cannot create a blank/empty project today. |
| `Project.create_imported_pack` | `project.py:579-750` | Multi-file imported-clip path used by `handleImportDirect`. Requires ≥1 file with a video stream. | Same — requires real files. |
| `Project.load` | `project.py:752-834` | Loads project.json, scrubs unsafe source_path, marks unavailable clips, recovers stale running stages. | Tolerant of missing/empty `clips`, `brief`, all `whop_*` fields, and a blanked `source_path` (L789-793). **`source_filename`, `id`, `slug`, `created_at` are required by L814-819** — `KeyError` if missing. |
| App.tsx routing | `App.tsx:128-134, 157, 1622-1641` | `View` union has `{ kind: "projects" }` and `{ kind: "project"; slug }`. Mounted under `RoomShell roomKey="library" align="top"`. | `onAddClip` (1638) routes to `{ kind: "empty" }` (workstation) — loses Project context. |
| Tauri drag-drop | `desktop/src-tauri/tauri.conf.json:24` → `"dragDropEnabled": true`; `App.tsx:799-899` | Single global `tauri://drag-enter/leave/drop` listener at App level. Drops route through `setView({ kind: "choosing-intent", source: { kind: "file", path }, brief })`. | Only ONE drop handler in the whole app; **always** routes to clip pipeline. Project surfaces cannot intercept. |
| `lc:toast` host | `App.tsx:64`, `components/GlobalToastHost.tsx:97` | Window CustomEvent bus mounted at root. | Use for confirmations. |
| `lc:library-refresh` | `App.tsx:2304`, `ProjectsTab.tsx:82-87` | Cross-tab refresh broadcast. | ProjectDetail does NOT yet listen — confirmed. |

---

## 2. Create New Project — minimal safe implementation

### Where the button goes
`ProjectsTab.tsx:176-186` (header right rail) — replace the lone Refresh button with `[+ New Project] [Refresh]`. New Project opens an inline `CreateProjectModal` (new tiny component, ≤120 LOC, same modal language as `LibraryQuickPreview`).

### Required fields the user enters
- **Name** (required, freeform string, max 120 chars).
- **Type** (radio): `Manual` (default), `Content`, `Client`. **`Import`** is implicit (set when first file lands); **`Earn`** is only created from the Earn flow (already wired via `startRun` + `bounty`). Do not expose Earn here.
- **Goal** (optional, ≤300 chars, freeform).

### Path to add a sidecar method? Yes — `method_create_blank_project`
Cannot reuse `start_run` (requires source_path) or `create_imported_pack` (requires ≥1 video file). The minimum surgical change to the sidecar:

```python
# python-sidecar/sidecar.py — new method, ~30 LOC
def method_create_blank_project(params: dict[str, Any]) -> dict[str, Any]:
    name = params.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("create_blank_project requires `name` (str)")
    project_type = params.get("project_type") or "manual"  # manual|content|client
    goal = params.get("goal") if isinstance(params.get("goal"), str) else None
    project = Project.create_blank(name=name.strip(), project_type=project_type, goal=goal)
    return {"project": project.to_dict()}
```

And in `python-sidecar/project.py`, a sibling factory:

```python
# project.py — alongside create_imported_pack (~50 LOC)
@classmethod
def create_blank(cls, name: str, project_type: str = "manual",
                 goal: str | None = None,
                 projects_root: Path | None = None) -> "Project":
    root_base = projects_root or (CLIPS_HOME / "projects")
    root_base.mkdir(parents=True, exist_ok=True)
    base_slug = _validate_slug(slugify(name) or "project")
    candidate = root_base / base_slug
    i = 2
    while candidate.exists():
        candidate = root_base / f"{base_slug}-{i}"
        i += 1
    _resolve_within(root_base, candidate.parent)
    candidate.mkdir(parents=True)
    for sub in SUBDIRS:
        (candidate / sub).mkdir()
    now = time.time()
    stages = {s: StageState(status="pending") for s in STAGES}
    proj = cls(
        id=uuid.uuid4().hex,
        slug=candidate.name,
        root=candidate,
        source_path="",  # tolerated by Project.load L789-793
        source_filename=name,  # title-fallback at ProjectCard.tsx:66-67
        created_at=now,
        stages=stages,
        clips=[],
        brief=goal,  # piggyback brief field for goal (v0.7.73)
        intent="clips",
    )
    proj.save()
    return proj
```

⚠️ **verify**: `Project.load` (`project.py:781-793`) gracefully scrubs empty `source_path` to `""`. Confirmed safe for blank projects. `to_dict()` returns it as `""`. ProjectDetail's `basename(project.source_path)` (line 281) returns `""` — already guarded by `|| project.source_filename || "—"`.

### Sidecar TS wrapper
Add to `sidecar.ts:731+` near `startRun`:
```ts
createBlankProject: (name: string, projectType: "manual"|"content"|"client", goal?: string) =>
  sidecarCall<{ project: Project }>("create_blank_project", { name, project_type: projectType, ...(goal ? { goal } : {}) }),
```

### Slug origin
`slugify(name)` already exists in `project.py` (used by `create` L539). Disambiguated by `-2/-3` suffix. No timestamp suffix needed (collision counter already correct).

### After-create
`ProjectsTab` `onNewProject` handler → call `sidecar.createBlankProject(...)` → on resolve, `onOpenProjectDetail(project.slug)` (already wired at L51, 1625). Window dispatches `lc:library-refresh` so the card list refreshes when user navigates back.

### Risks
- `brief` field doubling as goal is a soft semantic overload. Acceptable for v0.7.73; if `goal` proves load-bearing, promote to a real field in v0.7.74 (adds one optional string to `Project` dataclass, one to `to_dict`, one to `save`). Back-compat is free because Python `data.get("goal")` returns None on legacy projects.
- New sidecar method = IG-002 territory (sidecar RPC iron gate). **Run** `grep -n "IRON GATE" python-sidecar/sidecar.py` first; the gate locks the EXISTING dispatcher contract, not new method additions. Adding a `method_create_blank_project` registered through the same METHODS dict pattern preserves the contract.

---

## 3. Add clips to Project — three paths

### Path A — Add existing clip from Library (inverse of LibraryQuickPreview)
**Half-built**: `LibraryQuickPreview.tsx:52-84` opens FROM a Library card and picks a target project. **Missing**: from `ProjectDetail`, an "Add from Library" picker that lists every Library clip and lets the user multi-select.

Implementation: new component `desktop/src/components/projects/AddFromLibraryPicker.tsx` (~100 LOC). Wired into `ProjectDetail.tsx:202-207` — change the existing "Add clip" button to open a 2-option mini-menu: `Add from Library` / `Import file`. Each writes via `addMembership({ project_slug, asset_type: "clip", asset_path, source_project_slug })`. Use `sidecar.listProjects(200, false)` + flatten `project.clips[]` from each, OR (cheaper) just list other projects' summaries and pick one whole project's clip via `sidecar.getProject(slug)` on click. **Recommend the cheaper path** for v0.7.73.

### Path B — Add local file from Finder
Re-use Tauri's existing `tauri://drag-drop` listener. Problem: today it's hard-coded to route into the clip pipeline (`App.tsx:894`). Fix: the global listener inspects an in-memory `dropContextRef` (new ref) that ProjectDetail sets on mount via a module-scoped `setDropContext("project", slug)` exported from a tiny new `lib/dropContext.ts` helper. When set, the listener writes `addMembership({ project_slug: slug, asset_type: "external", asset_path: path })` instead of routing to `choosing-intent`. On ProjectDetail unmount, context clears.

⚠️ **verify**: confirm `tauri://drag-enter` payload doesn't include paths (Tauri 2 only sends paths on `drag-drop`). If it does, we can preview-validate.

### Path C — Add imported source/video (tagged to project_slug)
Reuse `handleImportDirect` (`App.tsx:481-531`) verbatim. Add an optional param `targetProjectSlug?: string`. If set, after `sidecar.importReadyClips(paths)` resolves with `{ project }`, **also** write one membership per imported clip into `targetProjectSlug` pointing at the *source* project's clip paths. The source project still owns the files (pipeline truth); the target project gets the references. Tradeoff: an "Import to this Project" button in ProjectDetail creates a sibling project + tags it. This is fine — it preserves the import pipeline as the single source-of-files truth.

### Storage model per path
| Path | What's written | Where the file lives |
|---|---|---|
| A | membership row | original project folder |
| B | membership row | original Finder location (asset_path = abs path) |
| C | new imported pack project + membership row in target | imported pack folder (copy in clips/) |

### File-missing semantics
`projectMemberships.ts` has NO stat-check today. ProjectDetail renders `basename(m.asset_path)` (L332) regardless of file existence. **v0.7.73 add**: a lightweight `fs.exists(m.asset_path)` check in the row render, plus a `missing` badge. **Out of scope** if it bloats — defer to v0.7.74.

---

## 4. Drag/drop into Project

### Tauri side (already wired)
- Config: `tauri.conf.json:24` → `"dragDropEnabled": true`
- Events: `tauri://drag-enter`, `tauri://drag-leave`, `tauri://drag-drop` (`App.tsx:801-803, 812`)

### Three in-app drag gestures (HTML5 — no library)

#### G1: LibraryCard → ProjectCard (same window)
- **Source**: `LibraryCard.tsx` — add `draggable={true}` on outer `motion.article` + `onDragStart={(e) => e.dataTransfer.setData("application/lc-library-clip", JSON.stringify({ slug: project.slug, root: project.root, cover_thumb_path }))}`.
- **Target**: `ProjectCard.tsx` — add `onDragOver={(e) => { e.preventDefault(); setHover(true); }}`, `onDragLeave={() => setHover(false)}`, `onDrop={(e) => { const raw = e.dataTransfer.getData("application/lc-library-clip"); if (!raw) return; const src = JSON.parse(raw); addMembership({ project_slug: project.slug, asset_type: "clip", asset_path: src.cover_thumb_path || src.root, source_project_slug: src.slug }); }}`.
- **Visual**: `data-drop-hover="true"` attribute toggles a fuchsia border via existing `.library-card-corner` utilities.
- **Toast**: dispatch `lc:toast` with `kind: "info"`.

#### G2: ProjectCard → ProjectCard (move between projects)
- Source: `ProjectCard.tsx` — same `draggable={true}` + custom mime `application/lc-project-membership` carrying `{ from_slug, asset_path, asset_type, clip_id? }`. **However** — moving a *whole project* into another project is semantically wrong (a project isn't an asset). Replace G2 with: drag any **membership row** from `ProjectDetail.tsx:322-348` into the Projects tab sidebar / another open ProjectCard. Mime: `application/lc-membership`. Drop handler: `moveMembership(from, to, asset_path, asset_type, clip_id)`. Already in store at `projectMemberships.ts:176-211`.

#### G3: Finder file → ProjectDetail body
- See §3 Path B. Uses existing Tauri listener + module-scoped `dropContext`.
- **Visual**: ProjectDetail wraps its body in a div that listens to `lc:drag-active` window event (dispatched from App's `tauri://drag-enter`/leave) and toggles a dashed fuchsia border.

### Refresh after any drop
`addMembership` / `moveMembership` already dispatch `lc:memberships-changed` (`projectMemberships.ts:84-90`). `useMemberships` hook auto-refreshes (`projectMemberships.ts:237-242`). ProjectsTab listens to `lc:library-refresh` only — **add** `lc:memberships-changed` listener so card counts reflect adds (cards don't show count yet; future enhancement).

---

## 5. Move vs attach-to-multiple — decision

| Action | Verb | Implementation | Already wired? |
|---|---|---|---|
| Add to Project (multi-attach) | `addMembership` (idempotent on `project_slug+asset_path`) | `projectMemberships.ts:130-160` | Yes |
| Move to Project | `moveMembership(from, to, asset_path, type, clip_id?)` | `projectMemberships.ts:176-211` | Yes (no UI yet) |
| Remove from Project | `removeMembership(slug, path)` | `projectMemberships.ts:162-171` | Yes (ProjectDetail row Remove button) |
| Delete asset (file from disk) | OUT OF SCOPE v0.7.73 — destructive, distinct from Remove, needs confirm dialog | — | — |

UI gesture for Move: dropdown on each membership row in `ProjectDetail.tsx:322-348` next to Remove → "Move to…" → list of other projects → click target → `moveMembership(...)`.

---

## 6. Folder model — pick A, B, or C

**Pick C (Hybrid)** for v0.7.73.

| Model | Pros | Cons | Verdict |
|---|---|---|---|
| A — physical containment | Filesystem = truth, no orphan rows | Forces copy/move; **breaks** `Project.create_imported_pack` ownership of `clips/` dir; conflicts with `_validate_source_path` allow-list | Reject |
| B — pure metadata, files where they are | Zero file moves, additive | Orphan rows when user moves files in Finder | Reject (no stat-check today) |
| C — hybrid: source files stay; Project owns metadata + memberships; reveal-in-Finder via `openSmart` | Least invasive; preserves IG-001 import pipeline; preserves single-owner project folder; matches what `projectMemberships.ts` already implements | Same orphan-row risk as B, mitigated by lightweight existence check on render | **Pick** |

Justification: every other model requires touching the iron-gated import pipeline (IG-001) or the Project class invariants (`Project.create` requires real source). C is a pure additive layer that respects every existing contract.

---

## 7. Project Detail actions — build now vs defer

| Action | Verdict | Notes |
|---|---|---|
| Rename Project | Build now | Sidecar method NOT required — `addMembership`-equivalent: edit `project.json` in-place via `@tauri-apps/plugin-fs` `writeTextFile` to project root. ⚠️ **verify** Tauri capability allows writes to `~/LiquidClips/projects/*`. If not, add `method_rename_project` sidecar method (~15 LOC, mutates `whop_bounty_title` or new `display_title` field). Recommend the sidecar method — safer than rewriting an atomic-written JSON from JS. |
| Edit goal/outcome | Build now | Piggyback `brief` field (already user-editable string). If `outcome` is wanted separately, add new optional sidecar method `method_update_project_meta(slug, name?, goal?, outcome?)` ~25 LOC. |
| Add clip / source | Build now | §3 Path A + B. |
| Add from Library | Build now | §3 Path A. |
| Import file | Build now | §3 Path C. |
| Open folder | Already built | `ProjectDetail.tsx:86-96` |
| Resume | Already built | `App.tsx:1637` |
| Move clip | Build now | Dropdown on membership row, calls `moveMembership` (store ready). |
| Remove clip | Already built | `ProjectDetail.tsx:107-113`. Tighten copy from "Remove" → "Remove from project" so the user knows the file isn't deleted. |
| Submit / Track for Earn | Already wired via Resume | `ProjectDetail.tsx:227-237` |
| Archive Project | Already built | `ProjectCard.tsx:207-215`, `sidecar.setProjectArchived` |
| Delete Project | Already built | `ProjectsTab.tsx:139-159` tombstone trio |

⚠️ Out of scope: any action that physically moves files, drag-drop libraries, schema migrations, sidecar methods beyond `create_blank_project` (mandatory) and optionally `update_project_meta` (recommend for rename + goal/outcome).

---

## 8. Main dashboard Projects tile — what it should do

Today: `WorkstationRoom.tsx:141-148` renders Tile with hard-coded subtitle `"organise clips around goals"`.

### v0.7.73 (ship)
Count-only enhancement. New `useProjectCount()` hook (~25 LOC) calls `sidecar.listProjects(200, false)` once at mount, returns active count. Tile subtitle becomes:
- `"organise clips around goals"` when count === 0 or hook still loading
- `"${n} active project${n === 1 ? "" : "s"}"` when count > 0

Refresh on `lc:library-refresh`.

### v0.7.74 (defer)
Subtitle = latest project's title. Requires sort + truncate logic; not worth the LOC budget for a dashboard tile.

---

## 9. Social/platform state — audit

- **`Project.whop_bounty_platforms`** (`sidecar.ts:572`, `project.py:513`) = accepted-platforms list set when project is created from a Whop bounty.
- ProjectDetail already renders these as Pills (`ProjectDetail.tsx:183-187`).
- Schedule channel-connection state lives in `desktop/src/components/schedule/*` (separate per-platform OAuth/API state, NOT mirrored into `Project`).

### v0.7.73 decision
- Render `whop_bounty_platforms` as accepted-platform pills on **ProjectCard too** (currently only on Detail). Implement in `ProjectCard.tsx` between the title meta row (L180-194) and the action rail.
- For non-Earn projects, render NOTHING (platforms is null).
- Keep the existing "connect channels in Schedule → Channels" hint (`ProjectDetail.tsx:354-356`). **Do not** fake connection state. **Do not** add any social auth wiring.

---

## 10. Exact v0.7.73 implementation plan (numbered, smallest-first)

| # | Step | LOC | Risk |
|---|---|---|---|
| 1 | Create blank project sidecar method + `Project.create_blank` factory + TS wrapper | ~90 | M (touches sidecar.py + project.py; adjacent to IG-001 but additive) |
| 2 | `CreateProjectModal` + wire New Project button in ProjectsTab header | ~140 | L |
| 3 | "Add from Library" picker in ProjectDetail (mirror of LibraryQuickPreview, opposite direction) | ~120 | L |
| 4 | HTML5 drag/drop: LibraryCard source → ProjectCard target | ~50 | L (zero deps; HTML5 native) |
| 5 | Tauri Finder drop into ProjectDetail via `lib/dropContext.ts` module-scoped ref | ~60 | M (modifies the SINGLE global drag-drop handler in App.tsx:812 — must preserve P1 #22 picker race guard + the existing intent-picker routing as the default branch) |
| 6 | Move-to-Project dropdown on membership row + drag membership-row → ProjectCard | ~80 | L |
| 7 | Tighten Remove copy ("Remove from project, file stays") + add `lc:toast` on every membership write | ~20 | L |
| 8 | ProjectDetail listens to `lc:memberships-changed` + `lc:library-refresh`; ProjectsTab listens to `lc:memberships-changed`; Projects tile count via `useProjectCount` | ~60 | L |

Total: ~620 LOC across ~10 files.

---

## 11. Exact files to touch

| File | Function / component | Change |
|---|---|---|
| `desktop/python-sidecar/sidecar.py` | new `method_create_blank_project` (after L457) + register in METHODS dict | step 1 |
| `desktop/python-sidecar/project.py` | new `Project.create_blank` classmethod (after `create_imported_pack` ~L750) | step 1 |
| `desktop/src/lib/sidecar.ts` | new `createBlankProject` wrapper near L740 | step 1 |
| `desktop/src/components/projects/ProjectsTab.tsx` | header L176-186 → add `[+ New Project]` button + state `createModalOpen`; render `<CreateProjectModal>` conditionally; add `lc:memberships-changed` listener near L82-87 | steps 2, 8 |
| `desktop/src/components/projects/CreateProjectModal.tsx` | NEW file — name, type radio (manual/content/client), optional goal textarea, Cancel + Create | step 2 |
| `desktop/src/components/projects/AddFromLibraryPicker.tsx` | NEW file — lists projects + lets user pick a clip; calls `addMembership` | step 3 |
| `desktop/src/components/projects/ProjectDetail.tsx` | Replace `onAddClip` (L202-207) with mini-menu → `AddFromLibraryPicker` OR `handleImportDirect`; wrap body in `onDragOver`/`onDrop` (step 5); add Move dropdown to membership rows (L322-348); tighten Remove copy (L340-346); listen to `lc:memberships-changed` + `lc:library-refresh` | steps 3, 5, 6, 7, 8 |
| `desktop/src/components/projects/ProjectCard.tsx` | Add `draggable` + `onDragStart` on outer article; add `onDragOver`/`onDragLeave`/`onDrop` handlers; render `whop_bounty_platforms` pills | steps 4, 9 |
| `desktop/src/components/cockpit/LibraryCard.tsx` | Add `draggable={true}` + `onDragStart` w/ custom mime `application/lc-library-clip` on outer article | step 4 |
| `desktop/src/lib/dropContext.ts` | NEW module — `setDropContext({ kind: "project", slug } \| null)` + `getDropContext()`; module-scoped ref | step 5 |
| `desktop/src/App.tsx` | Modify the existing `tauri://drag-drop` listener (L812-899) to check `getDropContext()` first; if context is `project`, call `addMembership` instead of routing to `choosing-intent`. Preserve P1 #22 picker race guard. | step 5 |
| `desktop/src/components/cockpit/WorkstationRoom.tsx` | Update Projects Tile (L141-148) — accept dynamic subtitle | step 8 |
| `desktop/src/lib/useProjectCount.ts` | NEW hook — `sidecar.listProjects(200, false)` on mount + `lc:library-refresh` listener | step 8 |

---

## 12. Validation

### Type-check + build
```bash
cd /Users/dipdip/code/jnr/desktop
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
python -c "import ast; ast.parse(open('python-sidecar/sidecar.py').read()); ast.parse(open('python-sidecar/project.py').read())"
bash scripts/brand-kit-drift-check.sh
```

### Iron-gate check before edit
```bash
grep -n "IRON GATE" desktop/python-sidecar/sidecar.py desktop/python-sidecar/project.py desktop/src/App.tsx
```
Expected hits: IG-001 (import pipeline, project.py:438-ish region), IG-002 (sidecar RPC dispatcher), IG-010 (background bridges). New `method_create_blank_project` is additive — does not delete/move existing locked code.

### Manual hand-walk
1. Launch app → navigate Projects tab → click **+ New Project**.
2. Type name "Test Manual", select type Manual, type goal "ship this", click Create.
3. Verify ProjectDetail opens with title "Test Manual", goal in description, 0 clips, type pill = Manual.
4. Click **Open folder** → Finder opens `~/LiquidClips/projects/test-manual/`.
5. Confirm `project.json` exists and is valid JSON with `slug: "test-manual"`, `brief: "ship this"`, `clips: []`, `source_path: ""`.
6. Open Library tab → drag a LibraryCard onto a ProjectCard in the Projects tab (use a second window or split nav). Toast: "Added to Test Manual."
7. Back to Projects → open Test Manual → see attached row in "attached from library".
8. From ProjectDetail: click **Move to…** dropdown on the row → pick a second project → membership moves, both ProjectDetails refresh.
9. Drag a video from Finder into ProjectDetail body → drop target highlights → membership row appears with asset_type=external.
10. Drag a video into ProjectsTab (not ProjectDetail) → routes through normal intent picker (unchanged behaviour — `dropContext` is null).
11. Click **Open Whop brief** on an Earn project (regression — must still work).
12. Click **Remove** on a membership row → row disappears; verify file still exists on disk via Finder.
13. From WorkstationRoom (home) → Projects tile subtitle reads e.g. "3 active projects".
14. Refresh Projects → New Project still works after refresh (no stale state).
15. Quit + relaunch app → all created projects + memberships persist.

### Regression guards
- `tauri://drag-drop` default-path (no context) still routes to intent picker for a video drop on home/workstation.
- `lc:library-refresh` still fires on project archive/delete.
- IG-001 import pipeline unchanged (`handleImportDirect` + `method_import_ready_clips` byte-identical).
- `Project.load` of a legacy bounty project still parses correctly.

---

## Out of scope (do not propose for v0.7.73)

- CRM features, contact lists, client management
- Database / SQLite / schema migrations
- DnD libraries (react-dnd, dnd-kit, etc.)
- File-existence stat sweep for every membership row on render (defer to v0.7.74)
- Latest-project subtitle on the dashboard tile (defer)
- Delete-asset-from-disk action (defer; Remove-from-project is sufficient)
- Splitting `brief` into separate `goal` + `outcome` Project fields (defer; piggyback `brief` for v0.7.73)
- New social auth or Schedule channel wiring
- Drag whole-Project cards as if they were assets
- Backend bounty route changes, auth/checkout, social auth, notifications, Whop public browsing
