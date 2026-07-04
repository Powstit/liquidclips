# Scope notes · Port · cancellation-intercept

## Section B port #6 · retention flow

Source: `05_html-mockups/approved/cancellation-intercept.html`.
Target: `desktop-2/src/routes/cancellation-intercept/`.

Fires when user clicks "Cancel subscription" in Settings → Plan.
Save-offer modal + coach video + Kade avatar swap.

## 3 states covered (D2 v1.1)

| # | State                | Kade pose       | Behaviour                                              |
|---|----------------------|-----------------|--------------------------------------------------------|
| 1 | `cancel-attempt`     | `kade-hover`    | Red eyebrow · loss table · founder coach video         |
| 2 | `paused-then-back`   | `kade-success`  | Fuchsia eyebrow · "flywheel saved" · no loss table     |
| 3 | `already-cancelled`  | `kade-idle`     | Neutral eyebrow · reactivate CTA · withdraw balance    |

State transitions wired to CTAs (parent overrides via props):
- Keep from state 1 → transitions to state 2
- Cancel-anyway from state 1 → transitions to state 3
- Other buttons call `props.onKeep` / `props.onQuiet` for parent
  shell routing

## Brand-kit §13 compliance

§13a Pricing swap: mockup used $100 · port uses $99.99. Rendered
$100 occurrences: 0. $99.99 occurrences: 9. $50/mo per-clipper
math preserved (15 × $50 = $742.50/mo loss surface).

§13b Voice: bounty occurrences: 0. Copy uses "clippers", "flywheel",
"drops", "custom-commission".

§13c Whop lockup: exact SVG at
`/brand/whop/whop_logo_lockup_white.svg` (no plain-text fallback).

§13d Halo bleed math: resting 16px · peak 28px · clearance 40px.
Modal has padding-top 48px; Whop pill at top: 0 with
translate(-50%, -50%) means its center sits on the modal border.
Peak 28px halo = 42px effective bleed · fits inside the 48px pad ·
never clips. Scrim label is 20px from scrim top (22px+ clearance
from pill peak).

§13g Kade poses per state · all from approved 24:
- kade-hover · state 1 · "wait, don't leave"
- kade-success · state 2 · they stayed
- kade-idle · state 3 · neutral post-cancel

Kade avatar sits 72×72 top-right of the modal (pointer-events:
none · doesn't intercept CTA clicks).

## Coach video

`/brand/founder/founder-hook.mp4` (Daniel's 33 sec transcript ·
already in `public/brand/founder/` from sync-mail port).

## Panel-design-lens

Scan units: 7 on state 1 (loss table adds one · Whop pill +
Kade + eyebrow + h1 + sub + loss table + coach + CTA row = 8
counting scrim label, but scrim label is settings chrome not the
modal panel · panel-level = 7). States 2/3 = 6 (no loss table).

One primary CTA per state (fuchsia Keep/Back/Reactivate). Quiet
secondary CTA (Cancel-anyway/See wallet/Withdraw).

## Wire hooks

- props.onKeep · parent shell handles Keep subscription call
- props.onQuiet · parent handles Cancel-anyway OR wallet routing
- No direct backend fetch · pure UI + delegated actions

## Iron gates

- IG-005 workspace UI untouched · new route only
- No src-tauri/ changes
- No changes to Settings route or plan-management state

## Regression

- tsc --noEmit · green
- vitest run · 26 passed / 3 files
- Brand-kit §13 compliance verified in port-diff.txt

## Daniel's walk

1. cd desktop-2 && npm run tauri:dev
2. Mount the route (dev scrubber top-left · 3 buttons)
3. State 1 · Cancel-attempt: red eyebrow · loss table shows
   $742.50/mo they'd walk away from · Kade hover top-right
4. Click "Keep my $99.99 · keep earning" → state 2 flips
5. State 2 · Paused: fuchsia eyebrow · "$99.99/mo stays active" ·
   Kade success top-right
6. Manually flip to state 3 via scrubber: neutral eyebrow ·
   "$99.99 lapsed" · Reactivate CTA · Kade idle top-right
7. signoff port-cancellation-intercept when satisfied.
