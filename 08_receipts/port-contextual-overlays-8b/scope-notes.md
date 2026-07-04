# Scope notes · Port · Contextual overlays #8b

## Section B port #8b · shared DemoOverlay + 3 of 4 wire-ins

Partial delivery: 3 of 4 target routes wired. #1 BuildHero is
BLOCKED pending route location clarification.

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

## Wire-ins landed (3 of 4)

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

## #1 BuildHero · BLOCKED

**Status:** cannot ship. The referenced route file
`desktop-2/src/routes/build/BuildHero.tsx` does not exist in
the codebase. `find` returns no matches. The closest existing
build/create surface is
`desktop-2/src/design-os/routes/CreateClips.tsx` and
`desktop-2/src/design-os/routes/ClippingEngine.tsx`.

**What I need from Daniel to unblock:**

- **(a)** Point me at the actual route file that should host the
  01-clipping.mp4 overlay if I missed it (search for BuildHero
  returned zero hits), OR
- **(b)** Authorize inserting the overlay into
  `desktop-2/src/design-os/routes/CreateClips.tsx` (the closest
  existing build/create surface), OR
- **(c)** Authorize creating a new minimal `BuildHero.tsx`
  wrapper route that hosts the overlay only, OR
- **(d)** De-scope #1 · defer until Section B Port #9 or a
  build-tab-specific port lands.

Recommendation: (b) if `CreateClips.tsx` is Daniel's canonical
build-tab surface. Cleanest wire-in, no new route needed.

The other 3 wire-ins are functional and independent of this
decision.

## Brand-kit §13 compliance

- **§13c Whop lockup** — N/A on overlays (no paywall/affiliate
  chrome).
- **§13d Halo bleed** — overlay uses 16px resting only (no
  pulse), avoids nagging the eye when parked bottom-right.
- **§13e App-native viewport** — 360×220 fixed positioning fits
  bottom-right of the 1040×680 min viewport with 24px margin ·
  doesn't push route content · no horizontal scroll induced.
- **§13g Kade posters** — 3 of 4 used (reading-brief, earn-mode,
  success). All from approved 24. `cutting-clips` reserved for
  the BuildHero wire-in when it unblocks.

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

3 of 4 wire-ins delivered · #1 BuildHero remains BLOCKED
pending Daniel's clarification.

Section B queue after this halt + unblock:
- Port #8b · #1 BuildHero wire-in (once unblocked)
- Port #8c · contextual overlays 5-7 (cancellation-intercept,
  BrowseOverlay, campaign-builder)
