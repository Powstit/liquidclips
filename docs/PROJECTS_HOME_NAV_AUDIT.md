# Projects as a First-Class Home Item — UX Architecture Audit

Date: 2026-06-14
Scope: should "Projects" be promoted to a primary home nav item, and what is the cheapest way to ship it?

## TL;DR

**You already have it. It's called "Library".** The UI surface, the
`sidecar.listProjects` RPC, the filter/search/archive/delete/quick-preview
flow, and the bounty-project metadata (`whop_bounty_id/title/reward_per_unit`)
are all live in `desktop/src/components/library/LibraryTab.tsx` and mounted
in `App.tsx` at `view.kind === "library"`. Daniel's "Projects" home item is
a **rename + reframe** of an existing tab, plus a small sidebar rewire — not
a new build.

## 1. Current Home / navigation structure

`desktop/src/components/nav/SideNav.tsx:24-130` defines the side-rail nav.
The active set today:

| key | label | mounted view | file |
|---|---|---|---|
| `workstation` | Workstation | empty / running / results / canceled / failed / drop flows | App.tsx many |
| `library` | **Library** | `LibraryTab` (lists all projects) | `library/LibraryTab.tsx` |
| `earn` | Earn | `EarnTab` (public bounty browser + 5 sub-tabs) | `earn/EarnTab.tsx` |
| `community` | Community | `CommunityTab` | `CommunityTab.tsx` |
| `schedule` | Schedule | `SchedulePage` | `schedule/SchedulePage.tsx` |
| `learn` | Learn | `DoctrineLibrary` | `learn/DoctrineLibrary.tsx` |

The `View` union (`App.tsx:124-144`) already carries a `{ kind: "library" }`
member. Nav clicks fire `setView({ kind: "library" })` (`App.tsx:1527-1528`)
and the renderer mounts `<LibraryTab>` inside the `library` RoomShell
(`App.tsx:1603-1611`).

## 2. Where the new "Projects" item should live

**Rename Library → Projects in place.** Keep the nav slot, the view kind,
the renderer, and the underlying RPC. Two physical changes:

1. **SideNav label**: `label="Library"` → `label="Projects"` (`SideNav.tsx:101`).
   Optionally swap `iconSrc={libraryBadge}` (`SideNav.tsx:104`) for a new
   `projectsBadge` asset later — not required for v0.7.71.
2. **View kind**: leave `view.kind === "library"` as-is for now (cross-file
   rename is ~10 references and adds churn for zero user-visible benefit). If
   you want to clean it up later, do it as a single targeted refactor commit
   in v0.7.72+ — not now.

A cross-component rename of "Library" → "Projects" in tooltips, breadcrumbs,
and comments is a separate copy pass; the nav label is the only one that
matters for the customer-perception bump.

Daniel's broader home structure (Earn / **Projects** / Create / Import /
Script / Thumbnail) — only Projects exists today as a real item. **Create /
Import / Script / Thumbnail** are concepts that map to existing flows
(Workstation drop, URL paste, Lift Transcript, thumbnail generator) but
don't have their own nav slots yet. Promoting them is a separate v0.7.72+
home-redesign decision; out of scope for now.

## 3. Do we have enough project data to power a Projects page?

**Yes. Already proven by the existing LibraryTab.**

`sidecar.listProjects(limit, includeArchived)` (`sidecar.ts:776-777`) returns
`ProjectLibrarySummary[]`. Each summary (`sidecar.ts:613-637`) carries:

- `slug, root, source_filename, created_at, updated_at`
- `intent` (the workflow type)
- `clips_count, done, imported, reacted_count`
- `whop_bounty_id, whop_bounty_title` (nullable)
- `archived, archived_at, cover_thumb_path`
- `source_exists, pipeline_failed` (v0.7.8 health flags)

Backend method: `python-sidecar/sidecar.py:481` `method_list_projects` scans
the projects directory, skips `.lc-tombstone-*` dirs (5s undo window),
returns enriched summaries with health flags.

**Note**: `ProjectLibrarySummary` is missing some Whop fields that
`BountyProjectSummary` exposes (`whop_bounty_reward_per_unit`,
`whop_bounty_currency`). Either:
- (a) extend `ProjectLibrarySummary` to mirror those two fields (5-line
  python + 2-line TS) — preferred
- (b) keep `listBountyProjects` separate and merge in the UI when needed

(a) is the cheaper unification for v0.7.71.

## 4. What Projects should show for…

### Whop bounty projects (project.json has `whop_bounty_id`)
- Cover thumb + bounty title (prefer `whop_bounty_title` over
  `source_filename`)
- RPM chip (`whop_bounty_reward_per_unit` once exposed)
- Health badge (running / done / failed)
- Clip count
- "Resume bounty →" CTA

### Manual campaigns (project.json with `intent !== "import"` and no
`whop_bounty_id`)
- Cover thumb + `source_filename` or user-supplied title (if we ever wire
  brief-attached projects)
- Intent badge
- Same health/clip/resume chrome

### Imported clips with no campaign (project.json with `intent === "import"`)
- Cover thumb + filename
- "Imported" badge
- "Attach to campaign →" CTA (defers — needs the bounty→project bridge
  proposed in `EARN_CUSTOMER_EXPERIENCE_ARCHITECTURE.md`)

The same `LibraryTab` already supports filter/search/archive/delete on all
three. The grouping is purely a visual change (section headers or a filter
chip): "Bounty projects" / "Manual campaigns" / "Imports". `LibraryWall`
already has a `LibraryFilter` enum; add three new filter values + a
`filteredBy` derivation in `LibraryTab.tsx`.

## 5. Minimal implementation plan

**No new backend. No Earn rewrite. Reuses existing Project data.**

| step | file | change | ~LOC | when |
|---|---|---|---|---|
| 1 | `desktop/src/components/nav/SideNav.tsx:101` | label `Library` → `Projects` | 1 | now (commitable) |
| 2 | (optional) `SideNav.tsx:104` | swap nav badge asset | 0 (asset only) | v0.7.71 |
| 3 | `desktop/src/lib/sidecar.ts` `ProjectLibrarySummary` + `python-sidecar/sidecar.py method_list_projects` | add `whop_bounty_reward_per_unit, whop_bounty_currency` | 7 | v0.7.71 |
| 4 | `desktop/src/components/cockpit/LibraryWall.tsx` | add filter chips: All / Bounty / Manual / Imports | ~20 | v0.7.71 |
| 5 | `desktop/src/components/cockpit/LibraryCard.tsx` | RPM chip when `whop_bounty_id` set | ~10 | v0.7.71 |
| 6 | `desktop/src/components/earn/EarnSidebar.tsx` SavedBriefsRow | swap data source: `sidecar.listProjects(5, false)` filtered to bounty projects → 3-row preview that navigates to Projects on click | ~30 | v0.7.71 |

Total: ~70 lines spread across 5 files. No backend changes (sidecar method
extension is additive). No new components. No Earn UI rewrite. No CSS work.

## 6. Now vs v0.7.71

### Now (before commit) — optional micro-fix
- **Step 1 only**: `Library` → `Projects` nav label. One line.
- Rationale: shipping v0.7.70 with the OLD label means a v0.7.71 release
  will quietly rename it. If you want users to feel one consistent change
  ("Projects exists as a home item"), do the rename in v0.7.70 so the
  v0.7.71 Earn-sidebar rewire is the second visible upgrade, not the first.
- Risk: cosmetic only. No code paths depend on the label string.
- **If you want a true zero-touch commit of v0.7.70**, skip step 1 and bundle
  it with the rest in v0.7.71.

### v0.7.71
- Steps 2–6: badge swap, schema extension, filter chips, RPM chip,
  Earn-sidebar rewire.
- All independent and shippable individually.
- Combined with the 6-step "workstation bridge" from
  `EARN_CUSTOMER_EXPERIENCE_ARCHITECTURE.md`, v0.7.71 becomes the
  "Earn-to-Projects-to-Submission unified workstation" release.

### Defer (v0.7.72+)
- Cross-file rename of `view.kind === "library"` → `"projects"`.
- New nav items for Create / Import / Script / Thumbnail (each requires a
  home-screen redesign and surface mapping).
- Imports-with-no-campaign "Attach to campaign →" action (needs the
  Project ↔ CampaignBrief unification first).

## Is "Projects as a home item" better than only wiring "Your Campaigns" inside Earn?

**Yes, but only because Library already gives you the home item for free.**

If Projects had to be built from scratch, the answer would be "wire Your
Campaigns first; it's smaller". But the work is already done — `LibraryTab`
is the Projects page. The only delta is a label change and three small
unification wires.

The benefit of promoting it:
- Users discover their own work outside of Earn (the bounty-browsing context)
- The Earn sidebar becomes a *preview* of recent projects (3 rows) instead
  of a parallel storage system that nothing writes to
- Imports without a campaign get a real home (no more orphan clips lost in
  the Workstation)
- Future home items (Create/Import/Script/Thumbnail) get a sibling pattern
  to follow

The downside is **zero** because nothing in the current Library experience
is hidden or moved. The rename is additive.

## Files involved

- `desktop/src/components/nav/SideNav.tsx`
- `desktop/src/components/library/LibraryTab.tsx`
- `desktop/src/components/cockpit/LibraryWall.tsx`
- `desktop/src/components/cockpit/LibraryCard.tsx`
- `desktop/src/components/cockpit/LibraryQuickPreview.tsx`
- `desktop/src/lib/sidecar.ts` (`listProjects` + `ProjectLibrarySummary`)
- `desktop/python-sidecar/sidecar.py` (`method_list_projects`)
- `desktop/src/components/earn/EarnSidebar.tsx` (for the Step 6 rewire)
- `desktop/src/App.tsx` (only if you want the cross-rename in v0.7.72+)

## What should NOT be touched
- Public Earn browsing (works)
- Backend `/whop/bounties/public` route (works)
- Brand tokens (IG-012)
- Auth gating model (works for actions)
- `LibraryTab` data layer — already battle-tested
