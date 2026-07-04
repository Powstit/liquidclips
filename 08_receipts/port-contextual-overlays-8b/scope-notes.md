# Scope notes · Port · Contextual overlays #8b (v2 · #1 unblocked)

## Section B port #8b · shared DemoOverlay + 4 of 4 wire-ins

Full delivery. Original blocker on #1 (BuildHero) resolved per
Daniel's 2026-07-04 unblock option (b): inserted into
`src/design-os/routes/CreateClips.tsx` (canonical Build tab hero).

## Shared component (landed)

- `desktop-2/src/components/demo-overlay/DemoOverlay.tsx`
- `desktop-2/src/components/demo-overlay/DemoOverlay.css`
- `desktop-2/src/components/demo-overlay/index.ts`

Props:
- `mp4Src`, `kadePosterSrc`, `title`, `storageKey`
- `onDismiss?`, `position?` (`fixed` | `inline`), `compact?`,
  `forceShow?`, `hint?`

Behaviour (matches Daniel's spec + Learn tab claude-2 fixes):
- `<video muted playsinline autoplay loop preload="metadata"
  poster="…">` · autoplays muted on mount
- First click → unmute + `currentTime = 0` + play
- Subsequent clicks → pause / resume toggle
- Dismiss (`✕`) → collapses to `?` pill · localStorage persists
- Pill → clicks re-open the overlay (storageKey removed)
- Poster fallback: `pointer-events: none · z-index: 0`. Video
  z-index 1. `.is-playing` class fades poster to opacity 0 on
  first `playing` event.
- 360×220 fixed bottom-right by default · slide-in animation

## Wire-ins landed (4 of 4)

### #1 · CreateClips (Build tab hero · canonical) — UNBLOCKED

- File: `desktop-2/src/design-os/routes/CreateClips.tsx`
- Trigger: `session.phase === "idle"` — no active run + no
  persisted session (useEngineSessionPersistence has already
  reconciled at mount, so idle means truly resumable-empty)
- MP4: `/demos/01-clipping.mp4` (511 KB, on disk)
- Poster: `kade-cutting-clips` (§13g approved)
- Title: "How clipping works"
- localStorage: `demo-shown-build`
- **Iron gate scan:** `grep IRON GATE` on CreateClips.tsx
  returned **0** hits — no sentinels block the insert.
- **IG-005 workspace UI:** preserved · overlay is additive only,
  sits fixed bottom-right, does not touch UploadPortal /
  EngineActions / SimPage layout.

### #2 · LoginActivation (route)
- Trigger: `uiState === 'idle' && snapshot.status === 'idle'`
  (fresh onboarding, no prior activation).
- MP4: `/demos/02-login-activation.mp4` (907 KB, on disk)
- Poster: `kade-reading-brief` (§13g approved)
- Title: "First-launch walkthrough"
- localStorage: `demo-shown-login`

### #3 · SyncMailMoneyDrop (route)
- Trigger: `state === 'hook'` (default).
- Two-panel behaviour: existing founder-hook.mp4 stays in the
  coach bubble (left side · same click-to-unmute contract),
  demo overlay in the fixed bottom-right corner. Both click to
  unmute independently.
- MP4: `/demos/03-money-moment.mp4` (1.15 MB, on disk)
- Poster: `kade-earn-mode` (§13g approved)
- Title: "The full money moment"
- localStorage: `demo-shown-sync-mail`

### #4 · WalletDetail (route)
- Trigger: `state === 'fresh-install'` only. Once user hits
  `populated`, overlay never re-mounts (real streak data
  supersedes the demo).
- MP4: `/demos/04-wallet-payouts.mp4` (362 KB, on disk)
- Poster: `kade-success` (§13g approved)
- Title: "Wallet & payouts tour"
- localStorage: `demo-shown-wallet`

## #1 BuildHero · UNBLOCKED 2026-07-04 (option b)

Daniel confirmed `CreateClips.tsx` IS the canonical Build tab
hero (LearnTab.tsx:33 → `where: 'Build tab · hero'` maps here).
`ClippingEngine.tsx` is the processing engine, not the entry
point. Wire-in landed in CreateClips.tsx per option (b).

## Brand-kit §13 compliance

- **§13c Whop lockup** — N/A on overlays (no paywall/affiliate
  chrome).
- **§13d Halo bleed** — overlay uses 16px resting only (no
  pulse), avoids nagging the eye when parked bottom-right.
- **§13e App-native viewport** — 360×220 fixed positioning fits
  bottom-right of the 1040×680 min viewport with 24px margin ·
  doesn't push route content · no horizontal scroll induced.
- **§13g Kade posters** — all 4 used (cutting-clips,
  reading-brief, earn-mode, success). All from approved 24.

## Iron gates

- **IG-005 workspace UI** untouched. Overlays are additive (fixed
  positioning + parent-flow inline for sync-mail's two-panel
  variant) and don't modify workspace layout.
- No `src-tauri/` changes.
- No changes to activation.ts, F5 scanner, or any Layer 2/3
  primitives.

## Voice check

- `bounty` occurrences: 0.

## Regression

- tsc --noEmit · green
- vitest run · 26 passed / 3 files
- All 3 wire-in host routes still compile clean
- Existing route behaviour preserved (overlay is additive only)

## Status

4 of 4 wire-ins delivered. #8b fully closed.

Section B queue remaining:
- Port #8c · contextual overlays 5-7 (cancellation-intercept,
  BrowseOverlay, campaign-builder)
