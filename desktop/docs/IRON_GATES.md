# Iron Gates — locked sections of the codebase

These sections survived multiple rounds of regressions and are now **frozen**.
Touching them without an explicit override from Daniel is a regression risk —
each one has a story behind why it's gated. Read the gate before editing.

## How to recognise a gated section

- The file contains a sentinel comment shaped like:
  `// ───── IRON GATE IG-XXX (vX.Y.Z) ─────`
  or  `# ───── IRON GATE IG-XXX (vX.Y.Z) ─────`
- The sentinel always cross-references this file (`docs/IRON_GATES.md`).
- The pre-commit hook will refuse a diff that removes a sentinel line unless
  `IRON_GATE_OVERRIDE=1` is set in the environment with a justification.

## The contract you accept by editing inside a gate

1. **Read the gate entry below FIRST** — understand what shipped and why.
2. **Justify the change in the commit message** under a `Iron-gate-override:` trailer.
3. **Add a new gate entry** (or bump the existing one's version) once your change ships.
4. **Don't touch the sentinel comments** unless you are bumping the gate.

If the user has not explicitly authorized the change on this turn, STOP and ask.

---

## IG-001 — Import pipeline

**Locked at:** v0.7.13
**Files:**
- `python-sidecar/sidecar.py` — `method_import_ready_clips` and the cover-frame ffmpeg call inside `project.py`
- `src/App.tsx` — `handleImportDirect`, `importReadyClips` promise wrapper, the import-tile loading state, double-click guard
- `src/components/Splash.tsx` (related: the import-tile is rendered inside Workspace mount paths)

**What survived the loop:**
- 60-second `Promise.race` timeout around `importReadyClips` so a hanging sidecar never strands the UI.
- `humanError(e)` wrapping on the catch (was raw `String(e)` leaking `FileNotFoundError` text).
- Double-click guard on the import tile (`isImporting` flag) so a fast double-click doesn't fire two parallel imports.
- Cover-frame ffmpeg call at import time so imported clips have a thumbnail (was rendering as a silent black square).
- `<video onError>` plate on every imported-clip preview surface (iCloud placeholders, 0-byte files).

**Do NOT:**
- Change the 60-second timeout.
- Remove the cover-frame ffmpeg call.
- Swap `humanError()` back for `String(e)` / `e.message`.
- Touch the double-click guard logic without re-walking the race.

**Do:**
- Add NEW import sources (URL paste, drag-and-drop variants) as siblings, not replacements.
- Add NEW post-import processing as a separate pipeline stage.

**Sign-off:** Daniel 2026-05-29 (v0.7.13 F1–F7 ship)

---

## IG-002 — Sidecar RPC contract

**Locked at:** v0.7.13 (with additions through v0.7.25)
**Files:**
- `python-sidecar/sidecar.py` — the methods map at the bottom of the file (line ~2855) plus every `method_*` function it references.
- `src/lib/sidecar.ts` — the entire RPC surface (1100+ lines). Each method on the `sidecar` object is paired with a Python `method_*` of the same snake_case name.

**What survived the loop:**
- Stable wire format: newline-delimited JSON over stdin/stdout, `{method, params, id}` request → `{result, id}` or `{error, id}` response.
- Lazy imports inside Python method bodies (faster-whisper, openai, yt-dlp) so cold-start stays fast.
- `withTimeout` wrappers on long-running calls (`lift_transcript` 600s, others use defaults).
- Error shapes pass through `humanError()` consistently — UI never sees raw Python tracebacks.
- Auto-restart: dropped sidecar gets one retry (Rust + TS, see `src-tauri/src/sidecar.rs` and the TS wrapper).

**Do NOT:**
- Rename an existing method without bumping both files in lock-step.
- Change a method's params shape without versioning (add `v2_method_name`, don't mutate).
- Remove a method that any UI surface still calls — grep first.
- Break the lazy-import discipline (heavy modules at function scope, not file scope).
- Touch the auto-restart retry cap.

**Do:**
- Add NEW methods at the bottom of the methods map.
- Add NEW fields to a method's response object (UI is forward-tolerant to extra fields).

**Sign-off:** Daniel 2026-05-29 (v0.7.13 ship + M6 sidecar restart)

---

## IG-003 — Cinematic intro

**Locked at:** v0.7.4
**Files:**
- `src/components/Splash.tsx` — the intro mount surface
- `src/lib/intro.ts` — intro firing logic (one-shot per session, persisted dismiss)
- `src/assets/intro/intro.mp4` and `src/assets/intro/intro-splash.mp4` — the actual assets

**What survived the loop:**
- Intro fires exactly once per fresh-launch session.
- Skip button appears after the first user-input event (per Daniel's "let me skip" request).
- Dismiss persisted to localStorage so a returning user isn't re-watching every launch.
- Background darker than v0.7.3 so the assets don't wash out on bright displays.
- No autoplay-with-sound — muted start to satisfy WebKit autoplay policy.

**Do NOT:**
- Swap the intro asset paths without re-walking the Tauri asset bundling.
- Remove the dismiss-persistence.
- Add a "skip after Ns" auto-dismiss (we tried this; it skipped before the kicker frame).

**Do:**
- Add NEW intro variants (e.g. seasonal) behind a feature-flag tile, not in-place.

**Sign-off:** Daniel 2026-05-29 (v0.7.4 intro firing verify)

---

## IG-004 — Auth + activation bridge

**Locked at:** v0.4.21 desktop bridge + v0.7.x satellite Clerk
**Files:**
- `src/lib/activation.ts` — the central activation helper used by every "sign in" entry
- `src/lib/backend.ts` — the 401-handling path that flips the app to needs-activation and clears the stale LICENSE_JWT exactly once
- `src-tauri/src/lib.rs` — the `junior://` deep-link plugin registration (and the dev-build alias)
- Backend repo (out of tree): `/desktop/connect` endpoint that mints the LICENSE_JWT against an `x-internal-secret` header.

**What survived the loop:**
- One-shot 401-handler: even if many concurrent RPCs all 401, the activation prompt only flashes once.
- `secretDelete("LICENSE_JWT")` runs exactly once per 401 burst (gated by an in-flight flag).
- Challenge + deep-link bridge: desktop opens browser, server posts back via `junior://activation` deep link, sidecar receives + verifies, keychain stores.
- Clerk satellite-domain config (`account.liquidclips.app`) so the cookie crosses webview boundaries.

**Do NOT:**
- Reintroduce static API key auth — OAuth client-credentials is the locked Shopify-2026 / Clerk path (see memory `shopify_2026_auth`).
- Remove the in-flight flag on the 401 handler (two flashes of the activation prompt was a real reported bug).
- Mutate the deep-link URL scheme (`junior://`) without updating BOTH the Rust registration AND the backend redirect target.
- Add a fallback "manual paste your JWT" flow — Daniel killed this twice; the bridge is the bridge.

**Do:**
- Add NEW post-activation hooks (e.g. analytics ping, welcome toast) as listeners on the existing event.

**Sign-off:** Daniel 2026-05-31 (v0.4.21 activation bridge + Clerk satellite ship)

---

## IG-005 — Workspace UI design (cockpit + cards + Reaction)

**Locked at:** v0.7.27 (the canonical clip-view shipped after the cockpit rebuild)
**Files:**
- `src/components/cockpit/BottomCockpit.tsx` — the persistent bottom panel
- `src/components/clips-feed/ReactionControls.tsx` — shared per-clip writer for `clip.overlay`
- `src/components/clips-feed/ClipCard.tsx` — display-only card surface
- `src/components/ResultsGrid.tsx` — focusedIdx + multi-select wiring, modal mount, cockpit mount
- `src/components/ClipPreview.tsx` — keyboard-Enter "full editor" modal (reaction studio uses `ReactionControls`)
- `docs/clip-dashboard-demo.html` — the canonical visual reference

**What survived the loop:**
- ONE writer for `clip.overlay` — `ReactionControls`, mounted in exactly one place at a time (modalOpen suppression in BottomCockpit).
- Plain click = focus; shift/cmd-click = multi-select; focus follows every click.
- Persistent fixed-bottom cockpit via `createPortal(... document.body)` so parent transforms don't break `position: fixed`.
- Caption pin draft writes through to `sidecar.updateClipMeta({ pinned_comment })` on blur — never lost on close.
- Bulk-write semantics: caption pin fans out to every `effectiveIdxs`; Reaction edits the focused clip ONLY (and the cockpit subline says so).
- `whenKey` projects into `ScheduleWhen` and prefills the schedule popover via `initialWhen` (kept in sync via useEffect on `[initialWhen]`).
- ClipsBulkToolbar is gone — its actions belong to the cockpit. Don't bring it back.
- ClipPreview modal demoted: no programmatic drill-in from cockpit; only keyboard Enter + the "Burn / edit" caption pill route here.

**Do NOT:**
- Reintroduce a per-card edit row, per-card scheduler, per-card layout picker — these are cockpit jobs.
- Mount `ReactionControls` in two surfaces at the same time. The `modalOpen` prop is load-bearing.
- Replace `pickOverlaySource` with a custom picker — the existing one handles cancel + excludeIdx correctly.
- Pipe a `scrollTo` prop into ClipPreview again — Reaction Studio is the first section now, scrolling is moot.
- Default a layout when only a source is picked (compact "Pick ▸" must stay inert until a layout tile is clicked).

**Do:**
- Add new cockpit modules in the same row pattern (`<Module title="…" eyebrow={…} sub={…}>`).
- Add new modal-only power features inside ClipPreview without changing what the cockpit shows.

**Sign-off:** Daniel 2026-06-08 (v0.7.25 → v0.7.28 cockpit rebuild + lens-clean ship)
**Bumped to v0.7.29:** Daniel 2026-06-08 (v7 panel adopted via cockpit-v7-panel.html + cockpit-v7-collapse.html, post-Impeccable critique. New shape: status strip + caption inline + ReactionControls body + side-column CTA, collapsible to 54px via `\` chord)

---

## IG-006 — Cockpit handoff contracts

**Locked at:** v0.7.29
**Files:**
- `src/components/cockpit/BottomCockpit.tsx` — handoff trigger points + `modalOpen` suppression
- `src/components/clips-feed/ReactionControls.tsx` — OWN/DELEGATE boundary on `clip.overlay`
- `desktop/docs/cockpit-handoffs.md` — the canonical four-bucket ledger (OWN / DELEGATE / WATCH / AVOID)
- `desktop/docs/cockpit-handoffs-demo.html` — visual reference for all 5 handoff states

**What survived the loop:**
- Single-writer rule for `clip.overlay` — ReactionControls is the canonical writer. `modalOpen` prop suppresses the cockpit's mount when ClipPreview is open. No dual-mount race.
- Four-bucket model: every clipper action sorted into OWN, DELEGATE, WATCH, or AVOID.
- Per-handoff invariants: trigger explicit, conflicting controls dim, return path is `onProjectChange(nextProject)`, single writer per clip field.
- The ⋮ menu groups handoffs into Per-clip · Project · Vanity · Navigation with keyboard chords.
- Bake state contract on `clip.overlay.bake_status` (pending/error/idle) feeding the cockpit's pending/error strips. Mirrors the import-pending pattern.

**Do NOT:**
- Mount ReactionControls in two surfaces simultaneously.
- Add a cockpit-side `caption_style` writer (CaptionDrawer owns it).
- Reintroduce per-card schedulers or per-card layout pickers (cockpit owns those).
- Skip the `modalOpen` suppression when adding new modals that edit `clip.overlay`.
- Auto-trigger handoffs mid-task. Every DELEGATE needs an explicit user gesture.

**Do:**
- Add new ⋮ menu items per the four-section vocabulary (Per-clip · Project · Vanity · Navigation).
- Add new WATCH-bucket status indicators by surfacing fields already on `Clip` / `Project` / `Channel`.
- Add new DELEGATE surfaces by following the four-invariant protocol.

**Sign-off:** Daniel 2026-06-08 (v0.7.29 ship + handoff scope authored)
**Bumped to v0.7.30:** Daniel 2026-06-08 (3-bug section pass: Publish-now → Connect handoff, legacy TAKE ACTION header cut, Reaction pending strip wired via client-side onBusyChange + server-side bake_status="error" on ffmpeg fail. Four lenses clean.)

**Sealed gate covers:**
- The cockpit's Publish/Schedule flow is the ONLY path to channel routing; no parallel toolbars
- `SchedulePopoverInline` empty-state routes to Settings via `onConnectChannels` callback
- Reaction layout clicks ALWAYS surface visible pending feedback (teal sweep strip with elapsed timer + Cancel placeholder) — synchronous RPC compensated client-side via `ReactionControls.onBusyChange`
- ffmpeg failures persist `clip.overlay.bake_status="error"` + `bake_error` so the red strip + Retry survive reloads
- `Clip.overlay.bake_status / bake_started_at / bake_error` are the canonical bake-state fields (IG-002 additive)

---

## IG-007 — ClipCard structure (workbench grid card)

**Locked at:** v0.7.32
**Files:**
- `src/components/clips-feed/ClipCard.tsx` — the workbench grid card (sentinel at line 1)
- `src/index.css` — `.library-card` class (no tilt transform; static rest state)

**What survived the loop:**
- Outer `<article>` uses ONLY `library-card relative` (plus dynamic ringClass).
  Adding `p-4 gap-3 rounded-2xl flex flex-col` reintroduces the workbench-
  background-bleed gap where horizontal "lines" appeared at the top of the
  card (a literal day-loss bug Daniel called out 2026-06-09).
- HUD corner spans use the TWO-class pattern (`library-card-corner library-
  card-corner-tl` etc.). Base class carries position-absolute + drop-shadow +
  border-style:dashed + z-index. Single-class form (`library-card-corner-tl`
  alone) renders broken corners.
- Inner thumbnail container: `aspect-[9/16] overflow-hidden rounded-2xl`. No
  `bg-paper-warm` fallback — fills cleanly to match demo `.lc-thumb`.
- Variant B rest state: `<video>` ONLY mounts when `isHovered &&
  previewMotionOn`. Otherwise renders `<img src={thumbSrc}>` if present, else
  the brand fuchsia/purple radial-gradient placeholder. Imported clips never
  show the source video's first-frame chrome.
- Below-thumb meta: `mt-3 px-1.5` (matches demo `.lc-meta`).
- No "01" indicator, no above-thumb checkbox+virality+theme+time row, no
  "TITLE" eyebrow above the title.
- `.library-card` has NO 3D perspective tilt — `transform: none`.

**Do NOT:**
- Add padding (`p-4`, `p-3`, `p-2`) or flex utilities (`flex flex-col`,
  `gap-3`) to the outer `<article>` — creates a transparent frame that
  bleeds workbench background as "lines."
- Drop the base `library-card-corner` class from the corner spans (single-
  class form breaks HUD bracket rendering).
- Reintroduce the 3D parallax tilt on `.library-card` (cursor-driven
  rotate makes the wall feel unstable; brand wants static rest).
- Mount `<video>` at rest (shows first-frame artifacts on imported clips).
- Re-add the above-thumb row, the "01" indicator, or the "TITLE" eyebrow
  (Daniel called these out as visual noise; they were AI-grammar tells).

**Do:**
- Add new conditional chips/badges via the existing TR/BL/BR slots.
- Polish typography or spacing on the below-thumb meta within demo budgets.
- Mirror new structural changes in LibraryCard.tsx — they're sibling cards.

**Sign-off:** Daniel 2026-06-09 (v0.7.32 — full day spent finding the lines;
locked the structure after the literal demo-copy fix landed)

---

## Adding a new gate

1. Pick the next free `IG-NNN`.
2. Append a new section to this file using the same template.
3. Add a sentinel comment at every covered file/line range:
   ```
   // ───── IRON GATE IG-NNN (vX.Y.Z) — see docs/IRON_GATES.md ─────
   // <short reason this block is locked>
   ```
4. Commit with a `Iron-gate-add:` trailer referencing the new gate ID.

## Removing a gate (rare)

Only when the section has been comprehensively refactored AND the original bug
class is gone. Add a `Iron-gate-retire:` trailer and DELETE the sentinel
comments in the same commit so the pre-commit hook accepts the diff.
