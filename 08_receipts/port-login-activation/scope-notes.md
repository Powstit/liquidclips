# Scope notes · Port · login-activation

## What ships

- `desktop-2/src/routes/login-activation/LoginActivation.tsx` ·
  11-state React component covering the full D2 v1.1 slug map:
  `idle` · `waiting` · `activating` · `activated` ·
  `activated_degraded` · `failed` · `already_activated` ·
  `inapp_panel_open` · `inapp_fallback` · `manual_paste` ·
  `offline`. Reads the state machine via `useActivation()`;
  never touches internal storage or JWT primitives.
- `desktop-2/src/routes/login-activation/LoginActivation.css` ·
  ports the card frame, HUD brackets, scanline overlay,
  node header + glyph pulse, boot-eyebrow/H1/sub, state pill
  ladder, spinner, in-app panel preview, manual-paste block,
  Kade positioning + per-state motion transforms.

## IG-004 preservation

The port imports from `../../lib/activation`:
- `useActivation()` — read the snapshot
- `beginActivation()` — public entry that mints the challenge
- `activateWithToken(rawToken)` — public entry for manual paste

Zero mutations of internal primitives (`setJwt`, `clearJwt`,
`_resetActivationForTests`). Every state transition originates
either inside `activation.ts` (headless path) or in the UI's
`uiOverride` state (in-app panel / fallback / manual paste /
offline — the four UI-owned slugs). No behaviour of
`activation.ts` is changed by this port.

## 11 states covered

Grep evidence in port-diff.txt shows all 11 slugs land in the
UiState union. Each slug renders a distinct branch under
`<div className="la-state-body">` — nothing collapses into a
generic error state.

## 5-status → 11-slug mapping

| activation.ts status | UI slug (default)     | Extra UI trigger                              |
|----------------------|-----------------------|-----------------------------------------------|
| `idle`               | `idle`                | `already_activated` (saved JWT at mount)      |
| `waiting`            | `waiting`             | `inapp_panel_open` when webview opened        |
| `activating`         | `activating`          | —                                             |
| `activated`          | `activated`           | `activated_degraded` when `snapshot.degraded` |
| `failed`             | `failed`              | —                                             |

UI-owned (no headless status): `inapp_fallback` · `manual_paste`
· `offline` (driven by `navigator.onLine`).

## Wire hooks

- **Sign in with Whop** button calls `beginActivation()` +
  `props.openInAppPanel()` — parent shell injects the Tauri
  `invoke('open_browse_panel', …)` implementation.
- **Activate with code** calls `activateWithToken(manualCode)`
  — this is the same public entry the deep-link listener uses,
  so a manual paste is indistinguishable from a real deep-link
  activation.
- **Continue** CTA calls `props.onContinue()` — parent routes
  to the workspace.
- Online/offline state uses the browser's `online` / `offline`
  events — no Tauri command needed.

## Voice / branding checks

- Banned word `bounty` → zero occurrences.
- Whop pill straddles the top border of the card (same primitive
  as the sync-mail port).
- Brand tokens from `src/brand/brandTheme.css` — three local
  helpers (`--la-cyan-cool`, `--la-fuchsia-rim`, `--la-danger`)
  stay inside the one-fuchsia rule.

## What's NOT in scope

- No changes to `activation.ts` (IG-004 preserved).
- No changes to `authStorage.ts`.
- No changes to any existing `src/design-os/routes/` files.
- No mount into the app router — parent shell wires it when
  Daniel greenlights.
- No Rust bridge changes.

## Snapshot proof

Mockup states captured to `mockup-<state>.png` — 11 PNGs, all
states walked in the approved HTML at 900×900 CSS px @ 2× DPI.
Daniel's G1 walk uses the source at `LoginActivation.tsx` inside
`npm run tauri:dev` — port + mockup share the same voice, HUD,
Whop pill, and state ladder.

## Regression

- tsc --noEmit · green
- vitest run · 26 passed / 3 files (no F5 / F6 tests broken by
  the new route)
