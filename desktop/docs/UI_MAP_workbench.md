# UI Map — Workbench (v0.7.5)

Governed by `~/.claude/skills/user-outcome-lens/`. This file is the **contract**.
Code that violates it loses, not the other way round.

When a future audit (via `user-journey-lens`) finds an element here that no
longer has the anchor it claims, the element gets cut or moved — the map is
not retconned to fit the code.

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

### Conflicts resolved

- *"Static tile"* vs *"controls on `<video>`"* → poster default; controls only after explicit click.
- *"Workbench is the product"* vs *"Grid as fallback"* → Workbench unconditional; tier-gating moved to publish quota, not view mode.
- *"Single source of truth for clip rendering"* vs *"ClipPreview has window/modal modes"* → ClipPreview keeps modal mode only; Workbench tile is its own minimal component.

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

- Every new file in this v0.7.5 sprint must declare which OUTCOMES, NAVIGATIONS, or SIMPLICITY demands it serves in its top comment.
- No new interactive element ships without a tag in this map. If you want to add one, edit this map first, then write the code.
- Future `user-journey-lens` audits compare the built surface against this map. If an element's anchor was cut from the map, the element gets cut from the code.
- The map is the contract. PRs that violate it get the change reverted, not the map rewritten.
