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

## IG-008 — Cockpit room scrollability + BottomCockpit clearance

**Locked at:** v0.7.43
**Files:**
- `src/components/cockpit/RoomShell.tsx` — the wrap class around every routed room (sentinel at top)
- `src/components/cockpit/WorkstationRoom.tsx` — the workstation room's root padding (sentinel above the root `<div>`)

**Why this is locked:** The fixed BottomCockpit (IG-005/006, rendered via `createPortal(document.body)` at `position: fixed; bottom: 0`) sits on top of every room's lower zone. RoomShell vertically centered content on `h-full` with no `overflow-y`, so the moment a room's content height exceeded the viewport (and the BottomCockpit further reduced the usable viewport), the lower tiles became physically unreachable — no scroll bar, and centered-flex content clipped above the scroll origin. Daniel hit this 2026-06-10 trying to click Thumbnails/Script from the Workstation home.

**What survived the loop:**
- RoomShell wrap MUST include `overflow-y-auto`. Without it, tall content is silently truncated.
- Vertical centering uses `items-[safe_center]` (CSS `align-items: safe center`), NOT plain `items-center`. The `safe` keyword tells the browser to fall back to start-alignment when content overflows, so the scroll origin remains at the top instead of the centered midpoint where the top of the content is clipped.
- Any cockpit room that sits on screens with BottomCockpit visible MUST add bottom padding ≥ BottomCockpit overlay height. Current convention: `pb-48` (192px). This pairs the room's content edge with the cockpit's top edge so nothing hides behind it.

**Do NOT:**
- Remove `overflow-y-auto` from RoomShell's wrap (reintroduces unreachable content).
- Switch RoomShell back to `items-center` from `items-[safe_center]` (the centered-clip bug returns on tall content).
- Drop `pb-48` from `WorkstationRoom`'s root, or any future cockpit room's root that the BottomCockpit overlays. Reduce below `pb-40` only after measuring the live cockpit height on the smallest supported window.
- Move the bottom-padding contract into RoomShell itself. Different rooms wrap different parents (some embed inside a panel that already pads, some don't); each room owns its own clearance.

**Do:**
- When adding a new routed room that the BottomCockpit overlays, copy the `pb-48` + sentinel comment pattern from `WorkstationRoom.tsx`.
- If BottomCockpit's height changes materially, update this gate's clearance value AND the affected rooms in the same commit.

**Sign-off:** Daniel 2026-06-10 (v0.7.43 — Thumbnails/Script tiles trapped behind the cockpit; fix landed same day, gated immediately to prevent regression)

---

## IG-009 — Cloud release flow (auto-update + GitHub release)

**Locked at:** v0.7.49
**Files:**
- `desktop/scripts/cloud-ship.sh` — the proven build → sign → tar → minisign → upload → tag → GH release chain. Sentinel at the top + end of file.
- `desktop/scripts/sign-clean-macos-app.sh` — the macOS-Desktop-FinderInfo resign workaround that cloud-ship calls.
- `desktop/scripts/strip-xattrs.sh` — the `beforeBundleCommand` xattr stripper.
- `desktop/src-tauri/tauri.conf.json` — the `updater.endpoints` + `updater.pubkey`. Changing these breaks every existing install.

**What survived the loop:**
1. **`tauri build --bundles app,dmg`** in ONE cargo pass. Splitting these into two builds means cargo compiles twice + the .dmg gets built from the unsigned .app (Gatekeeper warning).
2. **`sign-clean-macos-app.sh`** workaround for the macOS "resource fork, Finder information, or similar detritus not allowed" failure. This hits Tauri's auto-codesign step on dev machines where `target/` lives under iCloud File Provider OR the Desktop dir holds `com.apple.FinderInfo` xattrs. The fix rsyncs into a clean workdir under `~/LiquidClipsBuild/sign-clean/`, strips xattrs, signs in there, leaves the result for downstream steps. Verified survives v0.7.46, v0.7.47, v0.7.48, v0.7.49.
3. **Repack .dmg from the signed clean .app** via `hdiutil create -format UDZO` + `codesign --sign` on the .dmg itself. The .dmg Tauri produced earlier in step 1 is discarded because it contains the unsigned .app.
4. **`tar --no-xattrs`** is mandatory. Bare `tar` embeds FinderInfo into the tarball which corrupts the updater payload on extract on the user's machine — Tauri silently fails to install and the user stares at a blank "installing" state with no progress.
5. **minisign via `TAURI_SIGNING_PRIVATE_KEY` env var** (NEVER `--private-key <path>` flag). Tauri 2.x rejects our key file with `"failed to decode base64 secret key: Invalid symbol 46, offset 34"` when passed via the flag — the byte format works only via env. The legacy `release.sh` + `ship.sh` still use the flag and are therefore broken on Tauri 2.x; cloud-ship.sh is the replacement.
6. **Upload to `api.jnremployee.com/updates/upload`** with all six `x-release-*` headers + `x-internal-secret`. Empty `x-release-signature` → backend 400 silently rejects. BOTH arch slots mandatory (`darwin-x86_64` + `darwin-aarch64`) — the same universal binary serves both.
7. **Verify manifest on both hosts × both arches.** The backend (`api.jnremployee.com`) is the source of truth; the brand-aligned proxy (`updates.liquidclips.app`) is what installed apps hit per `tauri.conf.json`. A broken Vercel rewrite at the proxy means users can't update even if the backend upload "worked."
8. **Tag + GH release with .dmg attached.** The marketing site at `liquidclips.app` only sees a new version when `getLatestRelease()` (in `liquidclips-marketing/src/lib/latest-release.ts`) finds it on `api.github.com/repos/Powstit/liquidclips/releases/latest`. Vercel ISR caches for 10 min — new releases appear on the site within that window. Uploading to the auto-update manifest alone is invisible to new-install visitors.

**Do NOT:**
- Swap `TAURI_SIGNING_PRIVATE_KEY` env var for `--private-key <path>` flag (breaks signing).
- Skip `--no-xattrs` on the tar (breaks Tauri install on user machines).
- Bypass sign-clean and ship the Tauri auto-signed .app directly (codesign rejects on machines with FinderInfo on the bundle).
- Upload to only one arch slot or only one host.
- Skip the GH release (new website visitors stay on the previous version forever).
- Reuse the `release.sh` or `ship.sh` scripts on Tauri 2.x without first patching them to the IG-009 contract.

**Do:**
- Add NEW post-ship steps (e.g. notarization via `xcrun notarytool`, Sentry release notification) as siblings BELOW the existing chain. The script already has the `LIQUIDCLIPS_NOTARY_PROFILE` hook for notarization — supply an `AC_PASSWORD` keychain profile to enable.
- Bump the gate version in this section + the sentinels when materially changing the chain.

**Sign-off:** Daniel 2026-06-11 (v0.7.49 — cloud release flow proven across v0.7.48 + v0.7.49, locked here before the legacy `ship.sh` / `release.sh` get patched)

---

## IG-010 — v0.8.0 non-blocking architecture (5 hangs → 5 background paths)

**Locked at:** v0.8.0-pre
**Files:**
- `desktop/python-sidecar/sidecar.py` — the 5 `method_start_*` definitions, their `method_cancel_*` pairs, AND the dispatcher `METHODS` dict entries.
- `desktop/src/lib/sidecar.ts` — the 10 background bridge functions + their progress/complete/error event listener bridges + matching types.
- `desktop/src/lib/useGlobalBakeEvents.ts` — singleton-listener hook; listeners MUST attach on mount (`useEffect`), NOT lazily inside `waitForBake`.
- `desktop/src/components/clips-feed/ClipCard.tsx` — the canonical non-blocking call-site pattern (`startOverlayBake` + `waitForBake` fire-and-forget).

**Why it exists:**
v0.8.0 Phase 1.4 shipped the backend infrastructure for non-blocking versions of the 5 operations that previously froze the sidecar's stdin dispatcher (ingest URL, lift transcript, pick more clips, regenerate clip, apply overlay template). The audit caught three latent bugs the day the work landed: (a) all 10 dispatcher entries were missing — every future caller would get `"unknown method"`; (b) `useGlobalBakeEvents` lazy-attached listeners after `startOverlayBake` had returned, leaving a race where fast bakes silently hung for the 5-min timeout; (c) the TS bridge had no `onIngestComplete/Error` or `onLiftComplete/Error` listeners, so the UI couldn't react to those lifecycles even when wired. All three fixed before any user-visible regression. This gate locks the architectural contract so future agents cannot regress it.

**What survived the loop:**
1. **Background-thread isolation.** Every long-running operation runs in `threading.Thread(daemon=True)`. The stdin dispatcher returns `{"started": true}` immediately. NEVER block the dispatcher on download / ffmpeg / OpenAI / filesystem IO.
2. **Cancel pairing.** Every `start_X` has a matching `cancel_X` that flips a `threading.Event`. The worker polls the event + writes the existing `.lift_cancel` file marker so yt-dlp / ffmpeg pipelines pick it up via their hooks. NEVER add a `start_X` without its `cancel_X`.
3. **Three event families pattern.** Background workers emit `<verb>_progress`, `<verb>_complete`, `<verb>_error` events. The TS side MUST have matching `on<Verb>Progress/Complete/Error` listener bridges + types. If one is missing, the UI can't react to that lifecycle.
4. **Dispatcher registration is the only path to runtime.** The `METHODS` dict at the bottom of `sidecar.py` is the live contract. A method definition without a dispatcher entry is dead code that fails with `"unknown method"`.
5. **Listener attach on mount, NOT on first call.** `useGlobalBakeEvents` (and siblings) MUST register Tauri listeners via `useEffect(() => { void ensureListeners(); }, [])` BEFORE any `start_*` RPC fires. Lazy attachment leaks fast events between RPC return and listener registration.
6. **Singleton listener + per-key promise map.** One Tauri `listen<T>` per event family across the entire app. In-flight operations are keyed by `slug:idx` (bakes) or `url` (ingest/lift). Resolves on event match, rejects on duplicate-key, times out as last resort. No per-component listeners.
7. **Old blocking methods stay registered (transitional).** `ingest_url`, `lift_transcript`, `pick_more_clips`, `regenerate_clip`, `apply_overlay`, `apply_overlay_template` remain in the dispatcher as compatibility paths for call sites not yet migrated. Don't delete them until every call site uses the `start_*` equivalent. Migration order owned in `docs/v0.8.0_INTERFACE_SPEC.md`.
8. **Sentinels protect both the methods AND the dispatcher entries.** A diff that removes the dispatcher line for any of the 10 `start_*/cancel_*` methods, OR removes a TS bridge/listener, will be refused by the pre-commit hook unless `IRON_GATE_OVERRIDE=1` with justification.

**What is gated vs. what is in-progress:**
- **GATED:** the architectural pattern. Every new long-running operation MUST conform. Every existing one MUST keep its `start_*/cancel_*/three-events/dispatcher-entry/on-mount-listener` quintuple intact.
- **IN-PROGRESS (not gate-violating):** the call-site migration. As of v0.8.0-pre, only ClipCard layout swap + existing reaction bake are wired through. App.tsx URL paste / lift transcript / file drop, ResultsGrid pickMoreClips, ClipPreview regenerateClip + applyOverlayTemplate, masterActions.ts still call blocking RPCs. Migrating each IS the rest of v0.8.0 Phase 1. The gate doesn't refuse those migrations — it requires they FOLLOW the pattern.

**Do NOT:**
- Add a `method_start_X` to `sidecar.py` without ALSO adding it to the `METHODS` dispatcher dict in the same commit (the original Kimi miss).
- Add a `start_X` bridge to `sidecar.ts` without the matching `onXComplete`/`onXError` listener bridges + types (Kimi's miss for ingest + lift).
- Use `void ensureListeners()` lazily inside a Promise constructor in any new `useXEvents` hook. Always `useEffect` on hook mount.
- Migrate a call site to the blocking RPC under any "but it's simpler" pretext.
- Delete the legacy blocking method definitions until EVERY call site uses the background path. Untracked call sites will crash with "unknown method."
- Add a per-component Tauri event listener directly inside a component effect when a shared `useXEvents` hook exists.

**Do:**
- When introducing a new long-running operation, ship FOUR components in ONE commit: (1) `method_start_X` + `method_cancel_X` in `sidecar.py`, (2) dispatcher entries for both, (3) TS `startX/cancelX` bridges + `onXProgress/Complete/Error` listeners + types, (4) hook entry in the matching `useXEvents` (or new sibling hook).
- When migrating a call site, swap `await sidecar.X(...)` for `await sidecar.startX(...); await waitForX(...)`. Preserve the surrounding error UI + state machine.
- Bump the gate version when materially changing the contract (different event format, threading→asyncio, etc.).

**Sign-off:** Daniel 2026-06-11 (v0.8.0-pre — non-blocking architecture locked here before further call-site migration. Quoted instruction: "ensure it never ever drifts.")

---

## IG-011 — Webview room height cascade (RoomShell stretch contract)

**Locked at:** v0.7.50
**Files:**
- `desktop/src/components/cockpit/RoomShell.tsx` — the `align="stretch"` variant in the type union + `items-stretch` mapping in the inner flex.
- `desktop/src/App.tsx` — the `<RoomShell roomKey="earn" align="stretch">` mount.
- `desktop/src/components/earn/EarnPanelMount.tsx` — the `containerRef` div + ResizeObserver + `panelReady`-gated `pushRect` pattern that depends on a non-zero container rect.

**Why it exists:**
v0.7.40 fixed a blank-Earn report by giving the RoomShell motion div an explicit `h-full` (commit 3118b27). Days later, the IG-008 two-layer scroll wrap (commit c7a4a1f) moved the inner flex to `min-h-full` so list-style rooms can overflow. That broke Earn again — `min-h-full` is NOT a definite parent height for CSS height-percentage resolution; EarnTab's `h-full` collapsed to intrinsic (0px because EarnPanelMount renders an empty containerRef div), the ResizeObserver reported a 0×0 rect, Rust pinned the native webview to 0×0, and Earn looked blank. The fix added `align="stretch"` to RoomShell and switched Earn to use it. This gate locks the pattern so the next refactor of RoomShell or addition of a webview-style room can't regress it again.

**What survived the loop:**
1. **`align="stretch"` is the contract for webview rooms.** Any room that pins a native Tauri child webview behind a measured React container MUST request `align="stretch"` on RoomShell. Default `center` and `top` both leave the cross-axis on `items-start` / `items-center`, neither of which stretches children to fill — webview rooms then collapse to 0 height. Earn is the canonical case; future Browse-Rewards-as-a-room, Bounty-Workspace-as-a-room, or any other native-webview surface uses the same contract.
2. **The IG-008 two-layer scroll pattern stays.** IG-011 does NOT replace or weaken IG-008. The outer wrap is still a block scroller with `overflow-y-auto`. The inner wrap is still a flex column with `min-h-full`. IG-011 only adds a cross-axis alignment variant. Both gates can coexist on the same file (RoomShell.tsx).
3. **The container div in webview-mount components MUST stay `h-full w-full`** (or equivalent). `align="stretch"` stretches RoomShell's child (e.g. EarnTab) to definite height, but EarnTab → EarnPanelMount → containerRef must cascade that height down. Any intermediate wrapper that ditches `h-full` re-breaks the chain.
4. **`panelReady`-gated pushRect.** EarnPanelMount's resize effect depends on `panelReady` (set true when `openEarnPanel` resolves). The first pushRect fires after open succeeds so the webview isn't pinned to a stale fallback rect. This timing is part of the contract — moving the resize effect to fire before panelReady reintroduces the original v0.7.40 race.
5. **The ResizeObserver itself stays attached to the containerRef.** Removing the observer (or moving it to a parent) leaks fast resize events between paint and IPC, leaving the webview misaligned during window drags. v0.7.8 fix E2 rAF-coalesced this; that coalescer is part of the gate.

**Do NOT:**
- Remove the `align="stretch"` option from RoomShell or change it to anything other than `items-stretch` (e.g. `flex-1`, `items-end` — only `items-stretch` gives the definite height the height-percentage chain needs).
- Drop `align="stretch"` from the EarnRoomShell call site in App.tsx without a replacement that provides a definite container height (e.g. inline `min-h-screen` would also work, but switching variants without explicit override = bug).
- Change EarnPanelMount's containerRef div away from `h-full w-full` — that's where the cascade lands.
- Wire a new webview-style room (Bounty Workspace, Browse Rewards as a room, future Whop embed, etc.) without `align="stretch"`. Use the existing Earn pattern.
- Replace `panelReady`-gated pushRect with eager pushRect; the open/resize race comes back.
- Remove the IG-008 `min-h-full` two-layer pattern thinking IG-011 obsoletes it; both gates protect different concerns. IG-008 = scrollability; IG-011 = webview cascade.

**Do:**
- When adding a new room that mounts a native child webview, pass `align="stretch"` to RoomShell and ensure the cascade `h-full → flex-1 min-h-0 → h-full w-full containerRef` is unbroken.
- When refactoring RoomShell, preserve the type union `"center" | "top" | "stretch"` exhaustively and the mapping to `items-center | items-start | items-stretch`.
- Bump this gate's version if the contract changes (e.g. switching to a CSS Grid-based room shell that handles height differently).

**Sign-off:** Daniel 2026-06-11 (v0.7.50 — quoted instruction: "iron gate it pls." Locked immediately after the blank-Earn fix so the regression class can't return through a future RoomShell rewrite.)

---

## IG-012 — Brand kit single source of truth (canonical CSS ↔ demo mirrors)

**Locked at:** v0.7.50
**Files:**
- `desktop/src/index.css` — canonical `@theme` token block (the source of truth).
- `desktop/docs/demo-pages.html` — inline Tailwind CDN config (the canonical visual reference, all 9 surfaces).
- `desktop/docs/demo.html` — inline Tailwind CDN config (workspace + cockpit demo).
- `desktop/docs/demo-thumbnail.html` — inline Tailwind CDN config (5× Thumbnail Setup hero).
- `desktop/scripts/brand-kit-drift-check.sh` — the drift detector that runs on every commit touching a gated file.

**Why it exists:**
v0.7.50 introduced the demo HTML reference set so any agent or human can open `docs/demo-pages.html` and see exactly what every surface should look like — the canonical visual contract. The risk is that the brand tokens (`#ff1a8c` fuchsia, `#0b0b10` paper, etc.) get edited in `src/index.css` for a brand reason but the demos drift out of sync — over time the references become inaccurate and the "canonical look" gradually doesn't match the live app. This gate refuses any commit that changes a token in one place without updating all the others.

**What the contract enforces:**
1. **Canonical block** in `src/index.css` wrapped in `IRON GATE IG-012` sentinels: the fuchsia ladder + paper ladder + ink ladder.
2. **Mirror blocks** in each demo file: identical hex values, also wrapped in `IRON GATE IG-012` sentinels.
3. **`scripts/brand-kit-drift-check.sh`** runs from `.git/hooks/pre-commit` whenever a staged file matches `src/index.css` OR any `docs/demo*.html`. It refuses the commit if any of the 8 tracked hexes (`fuchsia`, `fuchsia-bright`, `fuchsia-deep`, `paper`, `paper-warm`, `paper-elev`, `ink`, `ink-soft`) appears in canonical but is missing from a mirror's IG-012 range (or vice versa).

**What's gated vs. what's free:**
- **GATED:** the 8 core brand hexes + the IG-012 sentinel comments themselves.
- **NOT gated:** atmosphere plate gradients, animation durations, per-surface vibe colours (cyan-cool, warn amber). Those evolve independently per surface. The drift check is scoped to the load-bearing brand tokens only.

**Do NOT:**
- Change a hex value in `src/index.css` without changing it in every demo mirror in the same commit.
- Remove the IG-012 sentinel comments (the iron-gate-precommit hook refuses this regardless).
- Bypass `LENS_OVERRIDE=1` to ship a drift commit without a real reason — that's how the demos rot.
- Use `LENS_OVERRIDE` for token additions without subsequently mirroring; the drift check is permissive on new tokens (it only checks the 8 named ones) but you should still mirror anything load-bearing.

**Do:**
- When adding a new core brand colour, add it to `src/index.css`, every demo mirror, AND the `CANONICAL_HEXES` array in `scripts/brand-kit-drift-check.sh` in the same commit.
- Run `bash scripts/brand-kit-drift-check.sh` locally before committing brand-kit changes to catch drift before the hook does.
- Bump the gate version when materially changing what's in the canonical (e.g. moving to OKLCH, retiring a colour).

**Sign-off:** Daniel 2026-06-11 (v0.7.50 — quoted instruction: "hard wire this to brand kit". Locked so the canonical demos can never silently drift away from the live brand tokens.)

---

## IG-013 — Apple notarisation chain (release.yml → notarize.sh)

**Locked at:** v0.7.50
**Files:**
- `.github/workflows/release.yml` (REPO ROOT, NOT `desktop/.github/`) — the orchestrator. Imports the Developer ID cert, codesigns with hardened runtime, calls notarize.sh with the three Apple secrets in env, stapler-staples after.
- `desktop/scripts/notarize.sh` — the script that runs `xcrun notarytool submit --wait` + `xcrun stapler staple`. Detects `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` env vars (CI path) or falls back to the keychain profile `LIQUIDCLIPS_NOTARY` (local path; intentionally NOT set up so local cloud-ship.sh skips notarisation).
- GitHub Actions secrets on `Powstit/liquidclips`: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` (set 2026-06-02; same set used by the `apple-actions/import-codesign-certs@v3` step).

**Why it exists:**
Daniel set this up on 2026-06-02 and explicitly flagged that future agents (including me) keep proposing to "re-set up Apple notarisation" instead of recognising it's already wired through GH Actions. v0.7.49 went out unnotarised because the CI run hung on the macOS-13 Intel runner for 9.5 hours, then I claimed the cloud-ship local flow + asked Daniel for an app-specific password — both wrong. This gate locks the canonical chain so no agent can drift toward "let me set this up locally" or "let me re-wire the secrets" again.

**What survived the loop:**
1. **Cert import via `apple-actions/import-codesign-certs@v3`** at release.yml:128-131 reading `APPLE_CERTIFICATE` + `APPLE_CERTIFICATE_PASSWORD`. NEVER swap for `apple-actions/import-codesign-certs@v2` or hand-rolled `security import`.
2. **Keychain register step** at release.yml:138-148 puts `signing_temp.keychain` on the list and runs `security find-identity -v -p codesigning | grep "Developer ID"` so a missing cert FAILS LOUDLY instead of falling through to an unsigned build.
3. **Codesign nested binaries with hardened runtime** at release.yml:160-170: `codesign --force --options runtime --timestamp --sign "$IDENTITY" "$bin"` followed by `codesign --verify --strict --verbose=2`. Hardened runtime is mandatory; Apple rejects without it. The verify pass catches detached signatures before notarytool runs.
4. **notarize.sh detects CI env vars** at notarize.sh:30-36: when `APPLE_ID` + `APPLE_PASSWORD` + `APPLE_TEAM_ID` are all set, uses `--apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID"`. Otherwise falls back to `--keychain-profile "${NOTARY_KEYCHAIN_PROFILE:-LIQUIDCLIPS_NOTARY}"` for local use. NEVER hard-code one mode — both paths must keep working.
5. **`xcrun notarytool submit --wait`** at notarize.sh:46-50. The `--wait` flag makes the call synchronous so the script blocks until Apple's verdict instead of polling. NEVER omit `--wait` (the older `--poll` flow is deprecated and the bare submit returns immediately without status).
6. **`xcrun stapler staple` after submit succeeds**. Apple's ticket must be attached to the artifact or Gatekeeper has to fetch it online — which fails on machines behind corporate proxies. NEVER skip the staple step "to save time."
7. **The DMG, not the .app, is what gets notarised + stapled**. Apple accepts .dmg / .pkg / zipped .app, but we ship .dmg; tickets are stapled to the .dmg directly.
8. **The 5 GH Actions secrets MUST stay configured**. Removing or renaming any one of `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` breaks the notarisation flow without warning. Rotate the app-specific password at appleid.apple.com if compromised — keep the secret NAME the same.

**Do NOT:**
- Recommend `xcrun notarytool store-credentials` locally as a solution to "my install shows a Gatekeeper warning." The fix is "kick the workflow" not "set up the local keychain profile." Daniel intentionally does NOT have a local keychain profile.
- Generate a new app-specific password and ask Daniel to set it up "for the first time." It IS set up since 2026-06-02. The memory file at `~/.claude/projects/-Users-dipdip/memory/liquid_clips_apple_notarization.md` is canonical.
- Bypass the `notarize.sh` env-var detection branch with a one-off `xcrun notarytool` call in CI YAML inline. The script's branch is the contract.
- Skip the codesign hardened-runtime step. Without `--options runtime`, Apple rejects the artifact at the notarytool submit step with a confusing "asset has issues" error.
- Push a release tag from a branch that has BOTH cloud-ship.sh AND release.yml racing. cloud-ship publishes an unnotarised DMG; release.yml's notarised DMG should overwrite when CI completes. If you cancel CI mid-flight, the unnotarised DMG sits there until the next ship.
- Switch from `apple-actions/import-codesign-certs@v3` to an unversioned `@main` ref. Apple-actions has shipped breaking changes between majors; v3 is the proven version.

**Do:**
- When notarisation appears stuck, check `gh run list -R Powstit/liquidclips --workflow Release` first. Hung runners are the usual cause, not bad wiring. `gh run cancel <id>` + re-tag + push is the canonical unstick.
- When testing locally, use `cloud-ship.sh` which intentionally skips notarisation — fast iteration. CI handles the notarised version for the public release.
- When rotating the app-specific password (Apple expires them after 60 days of disuse), update the `APPLE_PASSWORD` GH secret in place. Don't add a NEW secret.

**Sign-off:** Daniel 2026-06-11 (v0.7.50 — quoted instruction: "iron gate the logic" after I twice forgot the notarisation chain was already wired and tried to re-set it up locally. Locked so the goldfish-memory pattern can't return.)

---

## IG-014 — Auth-Keychain Invariant (no passive Keychain reads)

**Locked at:** v0.7.58
**Canonical doc:** `desktop/docs/auth-keychain-invariant.md`
**Files (the only files allowed to contain Keychain-capable patterns):**
- `desktop/src/lib/authStorage.ts` — central module + dev-mode runtime guard.
- `desktop/src/lib/activation.ts` — Connect-desktop callback (the one allowed write site for LICENSE_JWT under the new namespace).
- `desktop/src/lib/sidecar.ts` — the RPC wrapper definition (never invoked passively).
- `desktop/python-sidecar/secrets_store.py` — keychain dispatch + namespace split.
- `desktop/python-sidecar/sidecar.py` — the `method_secret_*` handlers.
- `desktop/python-sidecar/whop_client.py` — calls `_license_jwt()` from the explicit Whop activation surface.
- `desktop/scripts/assert-no-passive-keychain.sh` — pre-commit gate.
- `desktop/tests/no-passive-keychain.test.mjs` — static-assertion fixture.
- `desktop/docs/auth-keychain-invariant.md` — canonical statement.
- `desktop/docs/IRON_GATES.md` — gate registry (this file).
- `CLAUDE.md` (repo root) — agent guide that references the invariant.
- `desktop/src/components/NotificationBell.tsx` — JSDoc-only references to the prior pattern.

**Why it exists:**
macOS Keychain ACLs key on the signed-binary identity. Every release build produces a fresh signature, so the first time a rebuilt binary touches an item written by a prior binary, macOS prompts for the user's login password. Pre-v0.7.58 the desktop called `sidecar.licenseJwtRead()` from boot, mount, drawer-open, polling, focus, visibilitychange, AND every user submit handler — boot alone could stack ~10 prompts. Users perceived the app as broken / untrustworthy. Daniel's v0.7.58 directive: "Make this impossible to regress."

**What survived the loop:**
1. **Central `authStorage.ts` module.** Single source of truth. Exports `getCachedLicenseJwt` (safe sync accessor), `licenseJwtPresence` (presence-file mirror, no keychain), `requireCachedLicenseJwtOrThrow` + `CachedJwtUnavailableError` (safe sync accessor that throws when the cache is empty so submit handlers can surface `RECONNECT_PROMPT_COPY` inline), `primeLicenseJwtCache` / `invalidateLicenseJwtCache` (auth-action-only), and `readLicenseJwtForAuthAction({ explicitAuthAction: true, callerLabel })` (the ONE path that touches Keychain; dev-mode runtime guard throws on `explicitAuthAction !== true`).
2. **Keychain SERVICE namespace split.** `LICENSE_JWT` lives under `app.liquidclips.auth.v1`. BYO API keys + onboarding flag stay under `app.liquidclips.desktop`. Dispatch in `secrets_store.py::_service_for`. `delete_secret("LICENSE_JWT")` strips BOTH the new namespace AND the legacy slot so explicit sign-out / reset cleans up after itself.
3. **`scripts/assert-no-passive-keychain.sh` pre-commit gate.** Blocks any commit that re-introduces `licenseJwtRead(` / `allowKeychainRead: true` / `sidecar.secretGet` / `method_secret_get` / `keyring.get_password.*LICENSE_JWT` / `account.jnremployee.com` outside the approved-auth-files list. Pre-commit hook at `.githooks/pre-commit` runs the script with `cwd=desktop/`. No bypass.
4. **`tests/no-passive-keychain.test.mjs` static-assertion fixture.** Runs as `npm run test:invariant`. Seven assertions: (a) no disallowed pattern outside approved files, (b) the five mount-sensitive surfaces never call `licenseJwtRead`, (c) those surfaces import `getCachedLicenseJwt`, (d) `ScheduleQueue` carries no polling intervals, (e) no `account.jnremployee.com` outside approved files, (f) `LICENSE_JWT` is namespaced under `app.liquidclips.auth.v1`, (g) `authStorage` exports the full safe-accessor surface.
5. **Dev-mode runtime guard inside `readLicenseJwtForAuthAction`.** When `import.meta.env.DEV === true`, throws if `explicitAuthAction !== true`. Also logs `{ method, keyName, serviceNamespace, callerLabel, explicitAuthAction }` to the console so a regression is loud during local development.
6. **Five-and-only-five allowed auth actions:** Sign in, Sign out, Reconnect account, Connect-desktop callback, Explicit "Reset login session". All other code paths use the cache.
7. **`scripts/assert-no-passive-keychain.sh` portable to macOS bash 3.2.** No `mapfile`, no associative arrays — uses POSIX while-read loops and a temp-file violation accumulator.
8. **No `useVisibilityInterval` / `setInterval` polling in `ScheduleQueue.tsx`.** Polling was the second-largest source of passive Keychain reads after mount. Removed entirely; manual refresh via the existing retry button (cache-only).
9. **User-facing copy.** The reconnect string is canonical: `RECONNECT_PROMPT_COPY = "Please sign in again to reconnect your account."` Surfaces import this from `authStorage`; do not paraphrase. The legacy `account.jnremployee.com` URL was scrubbed from `whop_client.py:177` — the only user-visible occurrence outside the partner-dashboard CTA.

**Do NOT:**
- Add a new direct `sidecar.licenseJwtRead()` caller in any unapproved file. Pre-commit + test fixture will block the commit.
- Pass `allowKeychainRead: true` to anything. That flag has been removed from `authedFetch`'s signature; reintroducing it is a regression.
- Re-introduce `useVisibilityInterval` or any polling pattern that calls `void load()` — the queue refresh contract is "manual only."
- Read the legacy `app.liquidclips.desktop` namespace for `LICENSE_JWT` from any code path. Legacy items stay orphaned until the user explicitly signs out / resets.
- Rename the SERVICE constants (`SERVICE_AUTH`, `SERVICE_BYO`, `SERVICE_AUTH_LEGACY`) without coordinating across every approved file. The pre-commit gate and the test fixture both name them.
- Bypass the dev-mode runtime guard by passing a literal `true` from a passive caller. The `callerLabel` is logged; a CI run will surface the regression.

**Do:**
- For mount / drawer-open / poll-free refresh paths: call `getCachedLicenseJwt()`. Empty → render reconnect UI using `RECONNECT_PROMPT_COPY`.
- For submit / action / row-click paths: call `requireCachedLicenseJwtOrThrow()`. Catch `CachedJwtUnavailableError` and surface `err.message` inline (toast, banner, or per-row chip).
- If adding a new sixth-allowed auth action: discuss with Daniel first. If green-lit, add the file to the approved list in BOTH `scripts/assert-no-passive-keychain.sh` AND `tests/no-passive-keychain.test.mjs` in the same commit, and use `readLicenseJwtForAuthAction({ explicitAuthAction: true, callerLabel: "auth.<flow>" })`.
- Update `desktop/docs/auth-keychain-invariant.md` whenever the approved list changes — the doc is the canonical statement that the gate enforces.

**Sign-off:** Daniel 2026-06-13 (v0.7.58 — quoted instruction: "Make this impossible to regress. This Keychain bug must become a permanent repo invariant, not something we 'remember'." Locked so the desktop's "10 password prompts at boot" failure mode can't re-emerge through a future refactor.)

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
