# Scope notes · Port · sync-mail-money-drop

## What ships

- `desktop-2/src/routes/sync-mail-money-drop/SyncMailMoneyDrop.tsx`
  · 6-state React component. `hook`, `connecting-gmail`,
  `roster-populating`, `approve-send`, `back-to-app`,
  `notification-drop`. Live-wires Layer 2 F5Scanner on the
  "Link my email" tap and Layer 3's `renderWarmPeer` template for
  the outgoing bodies. Injectable OAuth driver / http fetch /
  batchLookup so QA can walk without live Google.
- `desktop-2/src/routes/sync-mail-money-drop/SyncMailMoneyDrop.css`
  · Ports every visual primitive from
  `05_html-mockups/approved/sync-mail-money-drop.html` v6:
  Whop pill, backdrop, modal grid, hook copy, connect button,
  provider strip, roster with animated row-in, ticker with
  scroll animation, wallet block + stats, coach bubble with
  autoplay video, app-home window with rail + wallet chip +
  banner + clip tiles + notification drop. All colors read
  from `--color-*` tokens in `src/brand/brandTheme.css` —
  three local shades (`--smmd-paper-slate`,
  `--smmd-paper-hover`, `--smmd-fuchsia-rim`) match the
  mockup's ladder shades and stay inside the one-fuchsia rule.
- `desktop-2/public/brand/founder/founder-hook.mp4` (3.6 MB ·
  Daniel's `IMG_4621.MOV` cut).
- `desktop-2/public/brand/whop/whop_logo_lockup_white.svg`.
- `desktop-2/scripts/port-smmd-snapshot.mjs` · snapshot-proof
  harness (screens the approved mockup at all 6 states for
  side-by-side comparison).

## Pricing lock (Daniel 2026-07-04)

- $100/mo per referral (was $50 in the mockup — port supersedes).
- Break-even = 1 sub (was 2 in the mockup).
- Skip-link "give up $2,000/mo potential" (was $2,500 in the
  mockup · derived from 20 × $100).
- Ticker amounts scale off the same $100 base
  (`$300/mo`, `$400/mo`, `$600/mo`, `$900/mo`, `$1,100/mo`).

## Voice check

- Banned word `bounty` → zero occurrences (grep proof in
  port-diff.txt).
- Replacement vocabulary in the copy: `skill-share`,
  `share this with`, `paid post` (per
  `feedback_voice_no_bounty_use_skill`).

## Wire markers (F5 + F6)

- `F5Scanner` used in `onConnect()` to run OAuth → contact scan
  → roster build. Progress emits transition the UI to
  `roster-populating` before `approve-send`.
- `renderWarmPeer` used in `onSend()` to precompute warm-peer
  bodies for the first 3 selected recipients (console.debug so
  DevTools proves the template is wired without spamming logs).
- No direct call to Layer 3 `BroadcastQueue.run()` yet — the
  actual sends happen inside a Tauri webview which needs
  `browse.rs` + `webview_eval` (both live from Layer 3). Daniel
  runs `npm run tauri dev` and walks the flow; the queue picks
  up on the tap. This is the "back-to-app" transition + demo
  notification-drop that follows.

## Daniel's G1 walk

1. `cd desktop-2 && npm run tauri:dev`
2. Navigate to the port route (dev scrubber lives top-left
   when `import.meta.env.DEV` is true).
3. Click "Link my email" → OAuth (real client_id from
   `desktop-2/.env.local`) → contacts populate → roster shows.
4. Tap send → modal dismisses, back to app-home, wait ~1.8s
   for the notification-drop.
5. Type `signoff G1` when satisfied.

## Snapshot proof

Mockup states captured to `mockup-<state>.png` (6 PNGs, 767 KB
to 1 MB each). Side-by-side compare against the running port
in Daniel's walk. tsc + vitest still green (26/26 tests, 3
files).

## Iron gates

- IG-005 (workspace UI) untouched — this is a new route, not a
  workspace redesign.
- No `iron gate` sentinels added or removed anywhere in the port.

## What's NOT in scope

- No changes to existing `src/design-os/routes/` files.
- No mount into the app router — Daniel will slot the route
  where it belongs when the walk is satisfying (a 3-line edit).
- No Rust bridge changes (Layer 3's `webview_eval` covers this).
