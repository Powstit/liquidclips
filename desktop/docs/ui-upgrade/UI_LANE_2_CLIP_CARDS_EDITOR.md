# UI Lane 2 — Clip Cards + Editor

**Lane status:** `WAIT FOR KIMI REACTION — touches editor/reaction surfaces`
**Owner:** Kimi B (after Daniel confirms Kimi Reaction is done)
**Read first:** `desktop/docs/UI_UPGRADE_MASTER_SCOPE.md` §7 (editor-blocked files), `desktop/docs/IRON_GATES.md` IG-005, IG-006, IG-007, IG-010.
**Validation gates:** `npx tsc -b`, `npm run test:invariant`, `bash scripts/assert-no-passive-keychain.sh`.

> **DO NOT BUILD until Daniel posts: "Kimi Reaction is done."**
> This sub-doc may be written and reviewed; no Lane 2 code edits happen before that signal.

---

## 1. Scope

Lane 2 polishes the **clip-editing experience** end-to-end after Kimi Reaction lands the wiring fix:

- **Clip cards** in every grid (Library, workbench, results, project files where applicable) — visual + interaction polish.
- **ClipPreview** modal — drawer pattern, tabbed surface, calmer chrome.
- **ReactionControls** — visual polish only (NOT functional re-wiring; Kimi owns that).
- **OverlaySourcePicker** — visual polish + cold-customer copy.
- **ResultsGrid** — workbench surrounding chrome.
- **ClipsBulkToolbar** — bulk action HUD.
- **InlineScheduler** — inline schedule UI on cards.
- **BottomCockpit** — calm, premium cockpit feel.

This is the lane that determines whether a cold customer can sit down, drop a video, and produce a publishable clip without asking Daniel what to click.

---

## 2. Files owned by this lane (after Kimi unblocks)

| File | Why |
|---|---|
| `desktop/src/components/clips-feed/ClipCard.tsx` | IG-007 workbench grid card |
| `desktop/src/components/ClipPreview.tsx` | IG-005 keyboard-Enter editor modal |
| `desktop/src/components/clips-feed/ReactionControls.tsx` | IG-005 + IG-006 single-writer; **visual chrome only** |
| `desktop/src/components/OverlaySourcePicker.tsx` | provider picker + cold-customer copy |
| `desktop/src/components/clips-feed/ClipsBulkToolbar.tsx` | bulk action HUD |
| `desktop/src/components/clips-feed/InlineScheduler.tsx` | inline schedule UI |
| `desktop/src/components/ResultsGrid.tsx` | workbench grid surface |
| `desktop/src/components/cockpit/BottomCockpit.tsx` | persistent cockpit |
| `desktop/src/components/cockpit/AvatarOrbit.tsx` reaction-related slots only — coordinate with Lane 1 |
| `desktop/src/components/clips-feed/ReactionStudioModal.tsx` (if extracted by Kimi) | wrapper |
| `desktop/src/components/clips-feed/LayoutIcon.tsx` + variants | visual polish only |
| `desktop/src/components/clips-feed/PreviewVideo.tsx` (if exists) | visual chrome |

## 3. Files forbidden to this lane

- Anything `components/projects/*` (Lane 3 — except where Lane 3's `ProjectFileCard` re-uses Lane 2's card primitives; coordinate via §10).
- Anything `components/earn/*` (Lane 4).
- `App.tsx`, `index.css`, `SideNav.tsx`, `Splash.tsx`, `FirstRun.tsx`, `RoomShell.tsx`, `WorkstationRoom.tsx` (Lane 1).
- `Settings.tsx`, `UpgradeLockCard.tsx`, `PublishModal.tsx`, `PlatformIcon.tsx`, `FailureCard.tsx`, `SidecarCrashOverlay.tsx`, `CommunityTab.tsx`, `schedule/*` (Lane 5).
- All `python-sidecar/*`, `lib/sidecar.ts`, `lib/activation.ts`, `lib/authStorage.ts`, `lib/useGlobalBakeEvents.ts`.

---

## 4. Target demo / brand references

| Surface | Reference | Strictness |
|---|---|---|
| ClipCard structure | `desktop/docs/clip-dashboard-demo.html` (IG-007 canonical) | **CONTRACT** |
| Workbench grid | `desktop/docs/demo.html` workbench section | **CONTRACT** (IG-012) |
| Reaction Studio modal | `desktop/docs/clip-dashboard-demo.html` reaction section | REFERENCE |
| BottomCockpit | `desktop/docs/cockpit-handoffs-demo.html` + `cockpit-v7-panel.html` (per IG-005 sign-off) | REFERENCE |
| OverlaySourcePicker tabs | `desktop/docs/clip-dashboard-demo.html` overlay tabs | REFERENCE |

---

## 5. Page-by-page UI outcomes

### 5.1 ClipCard (workbench grid card — IG-007)

**Current state:** Per IG-007 sentinel at `ClipCard.tsx:1` — outer `<article>` uses ONLY `library-card relative`. 4 HUD bracket spans. Inner aspect-9:16 thumb. Below-thumb meta `mt-3 px-1.5`. NO "01" indicator, NO above-thumb checkbox row, NO "TITLE" eyebrow. Static rest state (no 3D tilt).

**Cold-customer issues (assume Kimi Reaction has wired):**
- Action icons on the card are present but their hover hints are minimal — cold customer doesn't know what each does.
- Status chips (export-ready, reaction-applied, captions-applied, bounty-attached) lack a unified visual language.
- Double-click should open ClipPreview — Kimi Reaction will land this; Lane 2 only ensures the affordance is discoverable.
- Selected vs focused state distinction is subtle.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Outer `<article>` | Unchanged per IG-007. NO padding/flex utilities added. NO 3D tilt. |
| HUD corners | Unchanged per IG-007 — two-class pattern preserved. |
| Inner thumb | Unchanged per IG-007. `<video>` only mounts on hover + `previewMotionOn`; otherwise `<img src={thumbSrc}>` or brand fuchsia/purple radial-gradient placeholder. |
| Below-thumb meta | Unchanged per IG-007 (`mt-3 px-1.5`). |
| Action icon rail | Standardize to 4 mono-icon buttons (lucide): `Edit2` (open editor), `Sparkles` (reactions), `Captions` (captions), `Send` (publish/schedule). Each icon gets a `title="…"` tooltip. Order is fixed left-to-right. |
| Status chip rail | Below the thumb, above title. Show up to 3 chips simultaneously, in this order if applicable: **READY** (fuchsia, when export-ready) / **REACT** (neutral, when reaction applied) / **CAPTIONED** (neutral, when captions baked) / **EARN** (fuchsia-soft, when attached to a bounty project). Each chip is `rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em]`. |
| Selected state | Outer ring: `ring-2 ring-fuchsia ring-offset-2 ring-offset-paper`. Already used in `LibraryCard.tsx` selectMode — apply to ClipCard for consistency. |
| Focused state (keyboard) | `outline outline-2 outline-fuchsia outline-offset-1 rounded-[inherit]` |
| Hover affordance | Existing subtle scale on `LibraryCard`. ClipCard preserves IG-007 — no scale, only outer ring on hover within the card chrome. |
| Double-click hint | If Kimi Reaction's editor wiring requires it, add a small "Double-click to edit" mono caption that appears for the first 3 cards a session, then dismisses (localStorage flag) |
| Platform glyphs | If clip has scheduled posts, show platform glyphs at top-left of card via `PlatformIcon`. Glyphs from Lane 5's PlatformIcon unification pass. |
| Bounty/reward chip | If `clip.project.whop_bounty_id`, show fuchsia-soft "EARN" chip with optional RPM amount |
| Captions state | "CAPTIONED" chip when `clip.overlay.applied_paths` includes a captions key OR clip has `caption_style` set |
| Reaction state | "REACT" chip when `clip.overlay.applied_paths` has any value |

**Logic touch?** Lane 2 reads `clip.overlay.applied_paths` and existing state — no writes. Writes are Kimi Reaction's territory.

**Cold-customer next action:** "Double-click to edit, or click an icon."

---

### 5.2 ClipPreview (editor modal → drawer)

**Current state:** Fullscreen modal mounted on keyboard Enter from workbench. Reaction Studio mounts inside (IG-005 canonical).

**Cold-customer issues:**
- Fullscreen modal hides spatial context — when user closes, they don't know where they were.
- Tabs (Edit / Preview / Analytics / History) are described in 2027 vision but not implemented.

**Target UI outcomes (this lane, immediate ship):**

| Element | Outcome |
|---|---|
| Modal vs drawer | Keep modal pattern (true-drawer pattern is 2027 vision; defer). Add subtle "Back to workbench" affordance top-left. |
| Modal chrome | `bg-paper-warm` body, `border-line` border, atmosphere plate behind body at 0.10 opacity (when asset queue lands `state-cmd-k.png` or equivalent) |
| Tab strip (above editor controls) | Two tabs only for this pass: **Edit** (default) and **Preview** (full-bleed playback). Defer Analytics + History to a future lane. |
| Edit tab body | Existing controls preserved (Reaction Studio + captions + ratio + layout + trim + metadata + b-roll). Visual chrome polish only — no logic change. |
| Preview tab body | Full-bleed `<video>` with calm controls — play/pause, scrubber, volume, fullscreen icon. No editor controls. Subtle "Back to Edit" chip top-right. |
| Close button | Top-right X with `title="Close (Esc)"`. Esc keyboard binding preserved. |
| Save behavior | Existing IG-005 contract — Reaction Studio writes `clip.overlay`; ClipPreview does NOT add a second writer. |

**Files:** `ClipPreview.tsx`.

**Logic touch?** Visual + tab structure only. No editor writes.

**Cold-customer next action:** "Edit captions, swap layout, add a reaction, or preview the result."

---

### 5.3 ReactionControls (visual chrome only — Kimi owns logic)

**Current state:** Sits at `ClipPreview.tsx`'s editor body OR (when modal closed) at `BottomCockpit.tsx`. Single writer for `clip.overlay` per IG-005.

**Cold-customer issues:**
- Free-tier users see the locked tile — Sprint 1 free-tier paywall flow needs cold-customer copy.

**Target UI outcomes (Lane 2 — visual only):**

| Element | Outcome |
|---|---|
| Layout tile rail | Preserve existing layout tiles (None / Full / Reaction / Compare / Stack — whatever IG-005 surface ships). |
| Locked layout tile | When `isFreeTier && layout !== "none"`, render the tile with `border-fuchsia/50 bg-fuchsia-soft/30` + lock icon top-right + tooltip "Pro unlocks this layout — see plans". On click: `openUpgradeWhenSignedIn()` (existing). |
| Assets / Sparkles button | Preserve existing visual chrome. Lane 5's PlatformIcon unification does not touch this. |
| Pending bake strip | Preserve the teal sweep strip with elapsed timer + Cancel (IG-006 contract). |
| Error strip | Red strip + Retry button (IG-006 contract). |
| Cold-customer empty state | When user opens ReactionControls for the first time on a clip with no overlay, show a 1-line hint: "Pick a layout, then add an Asset to start." Dismiss permanently on first action. |

**Files:** `ReactionControls.tsx` (visual chrome only). NO writes to `clip.overlay`. NO listener changes (Kimi owns).

**Logic touch?** Zero. Visual + copy + free-tier paywall display only.

**Cold-customer next action:** "Pick a layout, then add an Asset."

---

### 5.4 OverlaySourcePicker

**Current state:** Tabs include provider (GIPHY / Pexels / Pixabay), This Project, Upload, Local. Free-tier preview vs paid-tier full.

**Cold-customer issues:**
- Provider tabs labeled with the provider name only — cold customer doesn't know what they'll see.
- "Add your Pexels/Pixabay/Giphy key in Settings → API keys" copy currently routes to Settings but the cold customer doesn't know that surface yet.
- "Local overlays are coming soon" copy needs honesty about timeline.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Tab strip | Provider tabs (GIPHY / Pexels / Pixabay), "This Project", "Upload", "Local". Order preserved per current. Each tab has a 1-line sub-copy below the tab name explaining what it does. |
| GIPHY tab cold copy | "Reaction GIFs from GIPHY. Requires a free GIPHY key." |
| Pexels tab cold copy | "Free stock video and images. Requires a free Pexels key." |
| Pixabay tab cold copy | "Free stock photos and videos. Requires a free Pixabay key." |
| This Project tab cold copy | "Pick another clip from this project as an overlay." |
| Upload tab cold copy | "Upload your own image, GIF, or short video from your Mac." |
| Local tab cold copy | "Locally bundled reaction packs. Coming with the next release." |
| Missing-key state | If user clicks a provider tab without a key, show: "Add your {provider} key to search. Get one at {provider docs URL} and paste it into Settings → API keys." Two buttons: "Open Settings" + "Get a {provider} key" (external link). |
| Result grid | Preserve existing grid; polish thumbnails (16:9 aspect, `rounded-xl`, hover `border-fuchsia`). |
| Selection state | Selected result: `border-fuchsia bg-fuchsia-soft/30` + checkmark top-right. |
| Apply button | `.btn-primary` (from Lane 1) reading `Add to clip →` when paid; `Sign in to add →` when signed-out; `Upgrade to add →` when free. |

**Files:** `OverlaySourcePicker.tsx`.

**Logic touch?** Visual + copy + cold-customer wayfinding only. Kimi owns the provider HTTP wiring.

**Cold-customer next action:** "Pick a tab → search → select → add to clip."

---

### 5.5 ClipsBulkToolbar

**Current state:** Floating bulk-action toolbar when ≥1 tile is selected.

**Cold-customer issues:**
- Floating chrome obscures cards; cold customer doesn't always realize it's there until they select.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Position | Docked to bottom of canvas (not floating mid-air). Slides up on selection ≥ 1, down on selection 0. |
| Background | `bg-paper-elev/95` + backdrop blur + top border `border-line/60` |
| Selection count | Left side: "N clips selected" + "Clear" ghost link. |
| Primary actions | Center: `.btn-primary` for the most common bulk action (Publish all). Secondary actions: Schedule, Add reaction, Add captions. |
| More menu | Right: `⋮` opening per-bucket actions (Compare, Merge, Tag — defer non-existent actions). |

**Files:** `ClipsBulkToolbar.tsx`.

**Logic touch?** Visual chrome + button taxonomy adoption only.

**Cold-customer next action:** "Pick clips, then click Publish."

---

### 5.6 InlineScheduler

**Current state:** Inline schedule UI on each clip card or in PublishModal.

**Cold-customer issues:**
- Schedule UI inline on cards can crowd the workbench.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Inline trigger | Small "Schedule" link on card hover; opens a compact popover (not the full PublishModal). |
| Popover | Date + time picker; "Schedule to {channels}" CTA; collapsed channel chips. |
| Disabled reason | Preserve v0.7.70's `title=` tooltip pattern (per UI_POLISH §4.1). |
| Copy | "Schedule to N channels" / "Pick a channel" / "Connect a channel in Schedule → Channels". |

**Files:** `InlineScheduler.tsx`.

---

### 5.7 ResultsGrid

**Current state:** Per `ResultsGrid.tsx` 697 lines — focused-idx + multi-select wiring, modal mount, cockpit mount.

**Cold-customer issues:**
- Empty results state (post-pipeline, no clips) lacks customer-friendly copy.
- Header chrome reads "developer dashboard".

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Header | Show project title + clip count + Refresh/Resume actions. Use Lane 1's button taxonomy. |
| Empty state | Use Lane 1's `.empty-state` class. Copy: "No clips yet — Resume to keep working, or pick a different project." Buttons: `.btn-primary` "Resume" + `.btn-secondary` "Back to Projects". |
| Loading state | Skeleton 8 dashed tiles (Lane 1's `.skeleton`). |
| Error state | Lane 1's `.error-banner` + Retry. |
| Grid | Preserve `auto-fill, minmax(…, 1fr)` per IG-007 ClipCard sibling. Bump min-card-width 180 → 200px for consistency with Project Files (Sprint 2 V3). |
| Click behavior | Single-click selects (existing). Double-click opens ClipPreview (Kimi wires). |

**Files:** `ResultsGrid.tsx`.

---

### 5.8 BottomCockpit

**Current state:** Persistent fixed-bottom panel via `createPortal(document.body)`. IG-005 + IG-006 contracts.

**Cold-customer issues:**
- Cockpit is dense; first-timer doesn't know what each module does.
- ⋮ menu items wired (per v0.7.70 — `lc:open-brief`, `lc:go-home`, `lc:go-earn`) but cold customer doesn't know they exist.

**Target UI outcomes:**

| Element | Outcome |
|---|---|
| Module headers | Each module's eyebrow uses mono-uppercase fuchsia (Lane 1's typography rhythm). |
| Module spacing | Increase gap between modules 4 → 6px to reduce visual density. |
| Collapsed state | Existing 54px collapsed via `\` chord (IG-005 v0.7.29 contract) — preserve. |
| ⋮ menu | Reorder to: Per-clip / Project / Vanity / Navigation buckets per IG-006. Each section has a mono-uppercase header. |
| Pending strip | Preserve IG-006 teal sweep with elapsed timer + Cancel. |
| Error strip | Preserve IG-006 red strip + Retry. |

**Files:** `BottomCockpit.tsx`. Visual chrome only; no IG-005/006 contract changes.

---

## 6. Copy improvements

| Surface | Old | New |
|---|---|---|
| OverlaySourcePicker missing-key | "Add your {provider} key in Settings to search…" | "Add your {provider} key to search. Get one at {provider docs}." + Open Settings button |
| OverlaySourcePicker local pane | "Local overlays are coming soon." | "Locally bundled reaction packs. Coming with the next release." |
| ReactionControls first-time hint | (none) | "Pick a layout, then add an Asset to start." (dismiss on first action) |
| ClipsBulkToolbar | (no copy beyond labels) | "N clips selected" + "Clear" |
| ResultsGrid empty | "No clips yet." | "No clips yet — Resume to keep working, or pick a different project." |
| BottomCockpit ⋮ menu | Section names (existing) | Mono-uppercase eyebrow per section |

---

## 7. Icons / accents

- Action icons in ClipCard rail: 4 lucide icons (Edit2, Sparkles, Captions, Send) consistent across every clip surface.
- Status chip glyphs: text only (no icons inside chips).
- Locked layout tile: `Lock` lucide icon top-right.
- BottomCockpit: preserve existing iconography.

---

## 8. Buttons / cards / tables specific to Lane 2

- All new buttons MUST use Lane 1's button taxonomy classes.
- ClipCard action icon rail: NOT styled as buttons — 28×28 icon-only with hover bg `bg-fuchsia-soft/30`.
- Status chips: `rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em]`.
- ClipsBulkToolbar: primary action uses `.btn-primary` (Lane 1).

No tables in Lane 2.

---

## 9. Cold-customer hand-walk for this lane

Run after Lane 2 ships (post-Kimi-Reaction-done):

- [ ] Open a project with rendered clips. Workbench grid renders.
- [ ] **ClipCard chrome** — IG-007 contract intact: no padding on outer article, 4 HUD corners, aspect-9:16 thumb.
- [ ] **ClipCard action rail** — 4 icons left-to-right (Edit2 / Sparkles / Captions / Send), each with a tooltip.
- [ ] **ClipCard status chips** — show only when applicable: READY / REACT / CAPTIONED / EARN.
- [ ] **Hover** — outer ring appears; thumb video plays muted on hover when previewMotionOn.
- [ ] **Single-click** — card selects (ring-2 ring-fuchsia).
- [ ] **Double-click** — ClipPreview opens (Kimi Reaction wires).
- [ ] **ClipPreview** — modal opens with Edit tab default; Preview tab shows full-bleed video.
- [ ] **ReactionControls** — locked layout tile shows lock icon for free tier; clicking opens upgrade.
- [ ] **First-time reaction hint** — visible on first clip opened in session; dismisses after click.
- [ ] **OverlaySourcePicker** — each tab has a 1-line sub-copy; missing-key state shows "Open Settings" + "Get a {provider} key".
- [ ] **ClipsBulkToolbar** — docked at bottom of canvas; appears on first selection; primary CTA is `.btn-primary`.
- [ ] **ResultsGrid empty** — copy reads "No clips yet — Resume to keep working, or pick a different project."
- [ ] **BottomCockpit ⋮ menu** — items reordered into Per-clip / Project / Vanity / Navigation buckets with mono-uppercase headers.
- [ ] **Validation** — `tsc -b` + `test:invariant` + `assert-no-passive-keychain.sh` all green.
- [ ] **IG-005 / IG-006 / IG-007 / IG-010** — contracts intact per `IRON_GATES.md`.
- [ ] **No Keychain prompt** at any point.

---

## 10. Cross-lane requests

Lane 2 may need:

- **From Lane 1:** `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, `.btn-locked`, `.skeleton`, `.empty-state`, `.error-banner` shared classes. Lane 2 cannot ship before Lane 1 lands these.
- **From Lane 5:** PlatformIcon unification (used by ClipCard's platform glyphs when clip has scheduled posts). Lane 2 references whatever PlatformIcon emits after Lane 5's unification.
- **From Lane 3:** ProjectFileCard chrome may need to mirror ClipCard chip rail style — Lane 3 and Lane 2 coordinate on the shared chip CSS.

Lane 2 may receive requests from:

- **Lane 5:** When PlatformIcon unification lands, Lane 2 verifies that ClipCard renders the unified glyph correctly.

---

## 11. Validation commands

```bash
cd /Users/dipdip/code/jnr/desktop
npx tsc -b
npm run test:invariant
bash scripts/assert-no-passive-keychain.sh
```

If `index.css` is touched (it shouldn't be — Lane 1 owns it): also run `bash scripts/brand-kit-drift-check.sh`.

---

## 12. Iron-gate compliance

- **IG-005** (Workspace UI design — cockpit + cards + Reaction): ReactionControls remains the ONE writer for `clip.overlay`. ClipPreview keyboard-Enter modal preserved. NO per-card scheduler / layout picker reintroduced.
- **IG-006** (Cockpit handoff contracts): four-bucket model preserved. Pending strip + error strip behavior unchanged. modalOpen suppression intact.
- **IG-007** (ClipCard structure): outer `<article>` uses ONLY `library-card relative`. NO `p-4 gap-3 rounded-2xl flex flex-col`. HUD corners use two-class pattern. Thumb container `aspect-[9/16] overflow-hidden rounded-2xl`. NO 3D tilt. NO above-thumb checkbox / virality / theme / time row. NO "01" indicator. NO "TITLE" eyebrow.
- **IG-010** (Non-blocking architecture): startOverlayBake fire-and-forget pattern preserved. useGlobalBakeEvents on-mount attach preserved. NO direct Tauri listeners inside per-component effects.

---

## 13. What's NOT in this lane

- True-drawer pattern for ClipPreview — defer to 2027.
- Tab additions beyond Edit + Preview — defer.
- Variable canvas / resizable tiles — defer.
- Sync Play / Stack / Tag actions — defer.
- Canvas minimap / undo timeline — defer.
- Provider HTTP wiring — Kimi Reaction owns.
- Auto-generation reactions — Kimi Reaction owns; if Kimi confirms missing, Lane 2 flags + ships disabled state with clear "Coming soon" copy.

---

## 14. Stop condition

Lane 2 ships when:
- Daniel confirms Kimi Reaction is done.
- All §5 page-by-page outcomes pass.
- §9 hand-walk is green per Daniel.
- §11 validation gates clean.
- §12 iron-gate compliance verified.

No commit, push, tag, release, or `latest.json` update without Daniel's explicit per-batch approval.

**End of Lane 2 sub-doc.**
