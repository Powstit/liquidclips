# Shell Freeze — Backlog

**Status:** 28/30 journey steps PASS in headless. Five of seven freeze
screenshots are evidence-grade; two (`freeze-03`, `freeze-04`) capture
the wrong DOM moment because of script-only selector / close-overlay
bugs. None of the open items below are shell regressions — they are
either script harness gaps or a single sidecar-only console error that
is expected in browser preview. Daniel's Tauri-native eyes-on walk is
still the final gate.

**Pass status as of 2026-06-17:** journey 28/30, screenshots 5/7
evidence-grade.

---

## Severity legend

| Severity | Meaning |
|----------|---------|
| **S0** | Shell regression — blocks ship until fixed. |
| **S1** | Script harness gap — journey result is misleading, but live app is correct. |
| **S2** | Cosmetic / log-only noise — accepted for ship. |

No S0 items are open.

---

## B-01 · `freeze-03-editor-split-overlay.png` does not show the split canvas

* **Severity:** S1 (script harness).
* **Evidence:** `screenshots/freeze/freeze-03-editor-split-overlay.png`
  captures the Editor overlay with the **Captions** rail tab still
  active. Layout rail never opened, split toggle never fired, so
  `.lc2-engine-canvas.split` was absent at screenshot time. The screenshot
  is a real editor view — just not the variant promised by the filename.
* **Root cause:** `scripts/capture-freeze.cjs:204-218`
  scans `document.querySelectorAll("button")` for `/^layout$/i`. The
  editor rail tabs are role-based, not raw `<button>` elements — the
  query misses them, the Layout panel stays closed, and the second
  `split`-text scan picks up the timeline "Split" button (which splits a
  clip at the playhead, not the layout). The split-canvas class never
  attaches.
* **Reproduce:** `node scripts/capture-freeze.cjs` (vite preview on
  :4173). Inspect `journey-log.json` for step 12 = FAIL.
* **Fix sketch:** switch the selector to
  `[role="tab"], button, a` and match against `aria-label` /
  `data-rail-tab` instead of trimmed text; or expose a stable
  `data-engine-rail-tab="layout"` hook on the tab button. Either is a
  one-line patch in `capture-freeze.cjs` once the rail tab carries a
  test id.

## B-02 · `freeze-04-publish-modal.png` is a duplicate of `freeze-03`

* **Severity:** S1 (script harness).
* **Evidence:** `screenshots/freeze/freeze-04-publish-modal.png` is
  pixel-identical to `freeze-03`. Steps 14 (click) + 15 (DOM exists) +
  16-18 (interact) all PASS, so `.lc-publish-modal` *is* mounted — it
  just isn't in the captured viewport.
* **Root cause:** two stacked harness bugs:
  1. `scripts/capture-freeze.cjs:229-239` (step 13, "Close overlay")
     trivially returns `true` after dispatching a synthetic
     `Escape` keydown that the editor overlay does not listen for. The
     overlay stays open, so the subsequent "Publish via Ayrshare"
     click lands on the editor's *Post to* rail button instead of the
     Home/Engine cockpit CTA, and the PublishModal mounts inside the
     editor's stacking context.
  2. The PublishModal portal target sits outside the editor's
     `position: fixed` overlay, but the screenshot is fired
     `fullPage: false` with `defaultViewport: 1440x960` — when the
     modal mounts behind the editor's stacking layer it never enters
     the captured rect.
* **Reproduce:** `node scripts/capture-freeze.cjs`. Compare
  `freeze-03` ↔ `freeze-04` SHA — identical.
* **Fix sketch:**
  * Replace the synthetic-Escape fallback with a real close-button
    selector. The editor overlay exposes `.lc2-engine-overlay-close`
    (script already lists this); verify the selector matches in the
    current build, or add a `[data-engine-overlay-close]` hook.
  * After step 15, force a 1-frame `await wait(50)` then re-query the
    modal's bounding rect; only screenshot once
    `getBoundingClientRect().top` is in viewport. Or switch to
    `fullPage: true` for `freeze-04` only.

## B-03 · `step 8 — Select a clip` reports FAIL even though selection happens

* **Severity:** S1 (script harness).
* **Evidence:** `journey-log.json` step 8 = FAIL, but step 9 (vertical
  thumb present) and step 10 (CampaignContextStrip visible) both PASS,
  and `freeze-02-engine-handoff-cockpit.png` shows the cockpit
  rendering with a selected clip thumb. The grid auto-selects the
  handoff clip on mount, so the user-flow effect is correct.
* **Root cause:** `scripts/capture-freeze.cjs:154-176` queries
  `[data-clip-card], .lc2-engine-clip-card, .lc2-engine-clipcard,
  .lc2-clip-card, .lc2-engine-clip` — none of these match the
  EngineClipGrid card element. The fallback `[data-engine-slot="clip
  grid"]` block also misses.
* **Reproduce:** same as B-01. Step 8 always FAIL even after re-run.
* **Fix sketch:** grep the real class in
  `src/components/engine/EngineClipGrid.tsx` (or add a
  `data-engine-clip-card` test id to the card root) and update the
  selector list in `capture-freeze.cjs`.

## B-04 · `[invaders] read failed, treating as zero` console error

* **Severity:** S2 (browser-preview noise, expected).
* **Evidence:** `journey-log.json.consoleErrors` lists this once per
  Home visit (4× total across the run):
  ```
  console: [invaders] read failed, treating as zero
  TypeError: Cannot read properties of undefined (reading 'invoke')
  ```
* **Root cause:** the invader counter persists via a Tauri sidecar
  RPC. In vite-preview the `window.__TAURI__.invoke` global is
  undefined, the read fails, and the catch path correctly logs a
  warning before defaulting to zero. The shell already handles the
  failure as a no-op.
* **Why accepted:** identical surfaces hit identical RPC failure paths
  in Tauri's WebKit — only the cause differs (no sidecar process at
  preview time). Live Tauri runs do not emit this error.
* **Action:** none for this freeze. Track separately if invader
  persistence is ever ported off the sidecar.

## B-05 · `step 27 — Open Whop submission ↗` records "popup blocked in headless"

* **Severity:** S2 (headless-only).
* **Evidence:** step 27 PASS, note column reads
  `popup blocked in headless; local record verified next`.
* **Why accepted:** puppeteer's headless shell blocks `window.open`
  popups by policy. Step 29 confirms the local submission ledger has
  the entry, so the user-visible effect is verified by side-channel.
  Live Tauri will route through `openSmart` → system browser; this
  path is exercised in `freeze-01` (browser overlay).
* **Action:** none — leave the note in the journey log for future
  agents to recognise the pattern.

---

## Out of scope for this freeze

* Real Whop / Ayrshare provider wiring — Phase 7 hardening, not Phase
  freeze.
* `data-*` test-id rollout across engine rail tabs and clip cards.
  Worth a single focused PR after ship if regression testing becomes
  a habit.
* Tauri-native walk — Daniel owns this. The headless harness only
  proves the React shell is intact; window-chrome behaviour, native
  drag-drop, sidecar IPC paths, and notification permissions still
  need eyes-on verification in the signed `.app`.
