# UI Map — Workbench (v0.7.8)

Governed by `~/.claude/skills/ship-lens/` (phases DESIGN → STATE → JOURNEY).
This file is the **contract**. Code that violates it loses, not the other
way round.

When a future audit finds an element here that no longer has the anchor it
claims, the element gets cut or moved — the map is not retconned to fit
the code.

---

## SURFACE: Workbench (single mode — no Grid, no ViewModeToggle)

### OUTCOMES the user came here for

- **#1** *"I want to see what each clip is."*
- **#2** *"I want this clip on these platforms."*
- **#3** *"I want this clip to look right."* (caption / ratio / layout)
- **#4** *"I want proof it shipped."*

### NAVIGATIONS in/out

- IN from Workspace: *"I just made clips — show me."*
- OUT to Settings → Connections: *"I want to connect Instagram / TikTok."*
- OUT to Earn: *"I want to see what I made from these."*

### SIMPLICITY demands

- *"I want to play this clip"* → click the tile (one click).
- *"I want to edit this clip"* → `E` or double-click (one gesture).
- *"I want to publish all selected"* → `Cmd-A` → Publish (two keystrokes).
- *"I want this clip gone"* → `Cmd-Backspace` (one keystroke).
- *"I want another window for this clip"* → click `+ window` → pick clip (two clicks).

### Elements (every one tagged — no entry without a tag)

| Element                                                         | Tag                       |
|-----------------------------------------------------------------|---------------------------|
| Tick checkbox on chrome                                         | `(S "select for batch")`  |
| Title (truncated, one line)                                     | `(O #1)`                  |
| Avatar stack on chrome (empty = fuchsia dot, bound = avatars)   | `(O #2)`                  |
| Static poster (default state)                                   | `(O #1)`                  |
| Hover-only overlay: LC score + "why"                            | `(O #3)`                  |
| Click-tile → play once                                          | `(S "play this clip")`    |
| Right-click menu (Open Edit / Reveal / Save copy / Play / Remove) | `(S "act on this tile")`|
| `E` / `Space` / `Cmd-Backspace` / `Cmd-A`                       | `(S)`                     |
| MasterToolbar: Schedule / Publish / Caption / Ratio / Layout / Edit-focused | `(O #2)(O #3)` |
| MasterToolbar: Remove (selection-scoped, two-step confirm)      | `(S "remove batch")`      |
| `+ window` tile (renders at next free 2×2 slot, opens clip picker popover) | `(S "add a window")` |
| Connection toast: "Instagram connected as @daniel"              | `(O #4)`                  |
| Publish toast: "Scheduled 12 clips across 3 channels"           | `(O #4)`                  |

### Cut list — what dies and why

| Cut                                                             | Reason                                                                 |
|-----------------------------------------------------------------|------------------------------------------------------------------------|
| Grid view + ViewModeToggle + tier-default branching             | Picks one and ships it — violates Simplicity.                          |
| ClipPreview header in window mode (number/score/theme/time/title/why/breakdown/captions chip/Close) | All `(O #3)` but cramped — moved to hover overlay + Edit drawer. |
| ClipPreview right pane (Reaction Studio / "for your post" / trim / action row) | All `(O #3)` — moved to Edit drawer.                            |
| `autoPlay loop` on the `<video>`                                | CONFLICT with "static tile" outcome — REMOVE.                          |
| Per-tile Close X button                                         | `(S)` yes, but creates 12 destructive buttons one click away — moved to `Cmd-Backspace` + right-click. |
| Per-tile bottom action row                                      | All `(S)` but six visible × twelve tiles = 72 buttons — moved to right-click + keyboard. |
| "Sound but no display" symptom                                  | Side effect of running two modes through one ClipPreview — gone with Grid. |
| **MasterToolbar Play all / Pause all (v0.7.8 W1)**              | Singleton `playingId` in WindowManager means at most ONE `<video>` mounts at a time. A master Play-all was a silent no-op (returned ok without actually playing). Static tile default wins; per-tile click is the play affordance. |
| **`WorkbenchView` union + `setView` mutator (v0.7.8 W4)**       | Map has been single-mode since v0.7.5. `view: "grid" \| "workbench"` was dead — no UI surfaced it, no consumer read it. Removed from `types.ts` + `useWorkbenchStore.ts`; legacy localStorage blobs that still carry the field are silently discarded on read. |
| **`ActiveVideoPool` + `MAX_ACTIVE_VIDEOS` + `promoteToPool` (v0.7.8 W5)** | Replaced by `useState<WindowId \| null>` in `WindowManager.tsx`. A 1-element pool with no eviction decision left to make wasn't earning its 100 lines. `activeVideoPool.ts` deleted. |
| **`clip.remix?.active_path` priority in `clipVideoPath` (v0.7.8 W6)** | No sidecar method writes `RemixState`. The branch was permanently unreachable — removed. `RemixState` type itself remains in `sidecar.ts` (out of this agent's ownership). |

### Conflicts resolved

- *"Static tile"* vs *"controls on `<video>`"* → poster default; controls only after explicit click.
- *"Workbench is the product"* vs *"Grid as fallback"* → Workbench unconditional; tier-gating moved to publish quota, not view mode.
- *"Single source of truth for clip rendering"* vs *"ClipPreview has window/modal modes"* → ClipPreview keeps modal mode only; Workbench tile is its own minimal component.
- **v0.7.8 W2** — *"Ratio control mutates store but renders never read it"* → ClipWindow's `videoSrc` memo now reads `windowState.ratio` and prefers `square_path` / `portrait_path` accordingly, with `vertical_path` as the fallback when the chosen ratio file doesn't exist yet.
- **v0.7.8 W3** — *"Captions re-bake doesn't refresh playing video"* → `videoSrc` includes `?cb=${clip.captions_updated_at}` and the `<video>` element keys on the resulting URL, so a sidecar `edit_captions` rewrite remounts the element and reloads the new mp4.

### Data States (phase 2 inventory)

The canvas reads a Clip from `project.clips[clipIdx]`. Every shape must render
or refuse:

| Shape                                                                  | Source                                  | Render path                                                                                       |
|------------------------------------------------------------------------|-----------------------------------------|---------------------------------------------------------------------------------------------------|
| Reframed clip with `vertical_path` + `thumbnails[0]`                   | `cut_from_source` happy path            | Poster = thumbnail image. Play = `<video src=vertical_path>`.                                     |
| Reframed clip with `vertical_path` but no `thumbnails`                  | Imported pack (`create_imported_pack`)  | Poster = paused `<video preload="metadata">` at `vertical_path` (ClipWindowPoster v0.7.7 fix #1). |
| Pre-reframe rough cut (`cut_path` only)                                | Fast Draft tail                         | Poster = paused `<video>` at `cut_path`. Play = same.                                              |
| Square/portrait variant (`square_path` / `portrait_path`)              | Reframe with non-default ratio          | v0.7.8 W2 — selected via `windowState.ratio`; falls back to vertical_path when missing.            |
| Captions re-baked (`captions_updated_at` bumps)                        | `edit_captions` RPC                     | v0.7.8 W3 — `videoSrc` cache-busts on the new timestamp; `<video key={videoSrc}>` remounts.        |
| Clip missing / shifted out of range                                    | `removeClip` while tile was open        | "clip not found" plate + paused chrome (no destructive auto-close).                                |

### Journey audit (phase 3) — per data state

- **Happy reframed clip** — ENABLES: select / play / edit / publish. PREVENTS: silent autoplay. BREAKS: none. STRANDS: none.
- **Imported pack no-thumb** — ENABLES: same flows. PREVENTS: empty "no preview" plate (fixed v0.7.7). BREAKS: none.
- **Cut-only rough cut** — ENABLES: play / publish via `clipVideoPath` falls back to `cut_path` is intentionally NOT in workbench publishing (vertical preferred); the user is steered to wait for reframe. STRANDS: none (fall-through is rendered + named).
- **Ratio variant** — ENABLES: master Apply ratio fans out; tile re-renders selected file. PREVENTS: visible no-op when picking a ratio (W2 root cause). STRANDS: ratio file missing → vertical fallback rendered.
- **Captions re-baked** — ENABLES: see new caption style without quitting the tile. PREVENTS: stale playback after Apply (W3 root cause). STRANDS: none (cache-busted URL forces remount).
- **Missing clip** — ENABLES: nothing destructive; the "clip not found" plate is a soft refusal. PREVENTS: crash on undefined Clip. STRANDS: user must close tile manually; intentional (no auto-remove).

---

## SURFACE: Edit drawer (canvas-scale modal, anchored to focused tile)

> **Map amendment (v0.7.5):** Originally specified as a tile-width slide-over.
> Re-implementing the editor's right-pane controls (caption picker, reaction
> layout, "for your post," trim) at 240px tile width would mean either
> downsizing every control past usability OR duplicating ~700 lines of
> ClipPreview's right pane. Decision: keep the canvas-scale modal
> presentation; preserve the navigation contract via the focused-window
> store binding (`E` / "Edit focused" enter from the focused tile, `Esc`
> cascade returns to it).

### OUTCOMES the user came here for

- **#3** *"I want this clip to look right."*

### NAVIGATIONS

- IN from Workspace tile: `E` / double-click / MasterToolbar "Edit focused".
- OUT to tile: `Esc` (with unsaved-changes confirm) or `Apply`.

### SIMPLICITY demands

- *"I want to change the caption style and see it"* → drawer mounts with caption pane active by default.
- *"I want to back out"* → `Esc` (with confirm only if dirty).

### Elements

| Element                                                | Tag                                  |
|--------------------------------------------------------|--------------------------------------|
| Caption style picker + custom palette                  | `(O #3)`                             |
| Ratio control                                          | `(O #3)`                             |
| Reaction layout + cell selector                        | `(O #3)`                             |
| "For your post": title / caption / pinned editor       | `(O #3)`                             |
| Trim details (read-only)                               | `(O #3)`                             |
| Apply (re-bake) button                                 | `(S "see my edit applied")`          |
| Discard button                                         | `(S "undo my edit")`                 |
| Esc handler with dirty confirm                         | `(N → tile)`                         |

### Cut list

| Cut                                                             | Reason                                                 |
|-----------------------------------------------------------------|--------------------------------------------------------|
| Schedule popover, Publish-now, Reveal, Save copy, Play, Remove  | All `(S)` but live in MasterToolbar / right-click — not the edit surface. |
| LC Score + "why" text                                           | `(O #1)` — belongs on the tile's hover overlay, not the editor. |
| Clip number "01 of 12"                                          | `(O #1)` — tile chrome shows it (or context already obvious). |

---

## SURFACE: Connect-channel flow (Settings → Connections + AccountBindingChip popover)

### OUTCOMES

- **#2** *"I want this clip on these platforms"* — pre-req is having a connected channel.
- **#4** *"I want proof it shipped"* — applied to the connect step itself: proof it linked.

### NAVIGATIONS

- IN from MasterToolbar "no channel selected" toast.
- IN from AccountBindingChip empty-state.
- IN from Settings → Connections row "Add account".
- OUT to external browser for OAuth.
- BACK via `liquidclips://channel-linked?cid=…` deep link.

### SIMPLICITY demands

- *"I want to connect Instagram in one click"* → "Connect Instagram" → browser opens → return → toast confirms.
- *"I want to know if it worked"* → toast lands within 1s of OAuth completion.

### Elements

| Element                                                | Tag                                  |
|--------------------------------------------------------|--------------------------------------|
| "Connect Instagram" / "Connect TikTok" buttons         | `(O #2)` `(S "one click to connect")` |
| Inline spinner + "Waiting for browser…" state          | `(O #4 — interim proof)`             |
| Global toast "Instagram connected as @handle"          | `(O #4)`                             |
| Global toast "Couldn't confirm — try Reconnect"        | `(O #4 — proof of failure)`          |
| 90s spinner timeout fallback                           | `(O #4 — proof of stuck state)`      |
| Avatar in AccountBindingChip after success             | `(O #2 — persistent proof)`          |
| `account-app/.../channel-linked/page.tsx` bounce page  | `(N → liquidclips://channel-linked)` — REQUIRED for TikTok age-gate. |

### Cut list

- Silent state-flip-on-popover-reopen (today's broken IG path) — replaced with the deep-link listener pattern.

### Conflicts

- *"OAuth completes in browser"* vs *"Toast appears in desktop"* — resolved via `liquidclips://` deep link + `junior:channel-linked` event subscriber.

---

## How this map governs the build

- Every new file in this v0.7.8 sprint must declare which OUTCOMES, NAVIGATIONS, or SIMPLICITY demands it serves in its top comment.
- No new interactive element ships without a tag in this map. If you want to add one, edit this map first, then write the code.
- Future ship-lens phase-3 audits compare the built surface against this map. If an element's anchor was cut from the map, the element gets cut from the code.
- The map is the contract. PRs that violate it get the change reverted, not the map rewritten.
