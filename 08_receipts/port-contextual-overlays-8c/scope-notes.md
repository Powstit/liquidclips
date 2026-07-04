# Scope notes · Port · Contextual overlays #8c (3 of 3)

## Section B port #8c · overlays 5–7 (final wave)

Closes Section B. Wires the shared `DemoOverlay` (landed in #8b) into
the last 3 target surfaces per Daniel's 2026-07-04 spec.

## Wire-ins landed (3 of 3)

### #5 · CancellationIntercept (retention modal)

- File: `desktop-2/src/routes/cancellation-intercept/CancellationIntercept.tsx`
- Trigger: `state === 'cancel-attempt'` only. `paused-then-back` and
  `already-cancelled` hide the overlay entirely — decision already
  made, no walkthrough needed.
- MP4: `/demos/05-cancellation-save.mp4` (on disk)
- Poster: `kade-hover` (§13g approved · matches the state's kadePose)
- Title: "Cancellation save walkthrough"
- localStorage: `demo-shown-cancellation`
- Overlay renders after the scrim block · sits fixed bottom-right
  outside the modal, does not obscure the CTA row or loss table.

### #6 · BrowseOverlay (in-app browser)

- File: `desktop-2/src/components/browser/BrowseOverlay.tsx`
- Trigger: mounts with the overlay (first-open per storageKey).
  BrowseOverlay itself is portalled to `document.body` when open,
  so the overlay renders on top of the webview slot without
  fighting the chrome header or the "esc to close" hint.
- MP4: `/demos/06-in-app-browser.mp4` (on disk)
- Poster: `kade-community-mode` (§13g approved)
- Title: "In-app browser tour"
- localStorage: `demo-shown-in-app-browser`
- Position: fixed bottom-right — same 24px margin as the other
  wire-ins, does not obscure the "Use in Engine" button.

### #7 · EmbedPreviewCard (campaign builder preview)

- File: `desktop-2/src/routes/campaign-builder/EmbedPreviewCard.tsx`
- Trigger: `showScrubber` (dev-walk mode). Production campaign-builder
  host route can gate on its own state via a wrapper. Rationale:
  EmbedPreviewCard is a leaf component with no route-level state,
  so binding to `showScrubber` keeps the overlay tied to the dev
  scrubber lifecycle without inventing new props.
- MP4: `/demos/07-cold-email-preview.mp4` (on disk)
- Poster: `kade-campaign-mode` (§13g approved)
- Title: "How the preview card works"
- localStorage: `demo-shown-campaign-builder`

## Brand-kit §13 compliance

- **§13c Whop lockup** — N/A on overlays (no paywall/affiliate chrome).
- **§13d Halo bleed** — 16px resting only, no pulse (per #8b spec).
- **§13e App-native viewport** — 360×220 fixed positioning fits the
  1040×680 minimum viewport with 24px margin.
- **§13g Kade posters** — 3 more from approved 24 (hover, community-mode,
  campaign-mode). All 7 posters across #8b+#8c come from the 24.
- **§13b Voice** — 0 `bounty` occurrences in rendered code (only
  §13b docstring guardrails self-reference the ban).

## Iron gates

- **IG-005 workspace UI** untouched. Overlays are additive fixed
  positioning that do not modify workspace layout.
- No `src-tauri/` changes.
- No changes to activation.ts, F5 scanner, whop-webhook, or any
  Layer 2/3 primitives.
- Grep for `IRON GATE` across the 3 target files returned 0 hits.

## Regression

- tsc --noEmit · green
- vitest run · 26 passed / 3 files
- No route/component contract changes · pure additive renders

## Status

3 of 3 wire-ins delivered. #8c fully closed. **Section B fully closed.**

All 7 mockup ports + demo overlay wire-ins are shipped local.
