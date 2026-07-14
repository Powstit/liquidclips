# journey.j010-referral · Affiliate referral share + attribution

## Purpose

A signed-in customer with a claimed handle surfaces the wallet route,
copies their share URL or exposes their QR, hands it off through an
external channel (DM, IRL scan, social share), a prospect clicks the
link or scans the code, arrives at `liquidclips.app/join/<handle>`,
converts, and the resulting attribution lands back in the customer's
wallet ledger + fires the HQ `referral_attribution_recorded` event.

j010 is the M1 (Reach) growth loop AND the M2 (Revenue) attribution
surface for `capability.affiliate-revenue`. Without a canonical owner
+ stable test seams + telemetry topics, a UI reshuffle can silently
break growth attribution — which is exactly what BUG-017 flagged.

## Owning capability

`capability.affiliate-revenue`

## Mission fingerprint

`[M1, M2]`

- **M1 (Reach):** referral share is the customer-driven acquisition loop.
- **M2 (Revenue):** attribution splits monetise every converted click.

## Prerequisites

- User is authenticated (`hasJwt === true` · `useMe.snapshot != null`).
- `WalletDetail.tsx` (Section-pipeline money surface) is mounted.
- Handle is either claimed OR the empty-state affordance is honest
  (AffiliateWidget renders "Set a handle to generate QR" placeholder).
- `me.snapshot.affiliateId` is populated when the user is enrolled in
  the Whop payout rail (`connect_whop_completed`).

## Entry conditions

- `hasJwt`
- `WalletDetail mounted` (via `#/account` outer hash OR Design-OS
  `SimulatorRouter` surface mount, whichever the current app hash
  resolves to).
- `referralUrl` computed from `me.snapshot?.handle`
  (`https://liquidclips.app/join/<handle>`) OR fetched from
  `/me/affiliate.referral_url` by AffiliateWidget.

## Exit conditions (success)

- Wallet ledger reflects the attribution — a new credit row surfaces
  in `summary.recent_ledger` on the next `refetch()` after the
  external conversion.
- HQ receives the `referral_attribution_recorded` event with
  `{affiliate_id, ts}` payload.

## Exit conditions (drift)

- Referral copy click observed (`referral_link_copied`) but
  `referral_attribution_recorded` missing after 60s → surface
  `journey.j010-referral.drift` flag on the HQ money-funnel tile
  (P4-owed correlation join, documented gap below).

## Stations (ordered)

### station.wallet.referral-affordance-mounted

- **Responsible system:** `feature.wallet-referral-block`
  (Section-pipeline)
- **Source code node:**
  `desktop-2/src/routes/wallet-detail/WalletDetail.tsx` ·
  `WalletReferralBlock` component (mounted from the
  `wd-referral-block` slot around WalletDetail.tsx line 881).
- **DOM seams:**
  - `[data-referral-attribution-source][data-source=<affiliateId>]`
    on the wrapper (attribution source marker).
  - `[data-referral-link][data-copy-value=<referralUrl>]` on the copy
    affordance seam.
  - `[data-referral-qr]` on the QR canvas seam.
- **Expected input:** `me.snapshot`, derived `referralUrl` from the
  handle, `affiliateId` from `/me`.
- **Expected customer-visible state:** AffiliateWidget's
  handle + share URL + QR block renders inside the wrapper (real
  data OR honest empty state).
- **Expected event ordering:**
  - `referral_affordance_mounted` (once per mount).
  - `referral_qr_generated` (once `referralUrl` is a non-empty string
    — QR canvas has value to paint).
- **Success signal:** `referral_affordance_mounted` visible in the
  `/telemetry/diagnostic` stdout stream with
  `has_referral_url + has_affiliate_id` payload.
- **Failure outcome:** No mount event → j010 is invisible to HQ →
  Doctor flags `journey.j010-referral.mount-missing`.
- **Telemetry proof:** `referral_affordance_mounted` → HQ money-funnel
  tile row (P4-owed persistence — today logs `[LC-CLIENT-DIAG]`).
- **Regression test:**
  `referral.journey.test.ts::mounts-and-fires-affordance-telemetry`.

### station.wallet.user_action_copy_link

- **Responsible system:** `feature.affiliate-widget-copy-url`
  (design-os primitive, re-mounted on the wallet money surface).
- **Source code node:**
  `desktop-2/src/design-os/earn/AffiliateWidget.tsx` ·
  `copyUrl` handler. Click bubbles through the `[data-referral-link]`
  wrapper's `onClickCapture` in `WalletReferralBlock`.
- **Expected customer-visible state:** "Copied ✓" badge briefly
  replaces the "Copy" button (1.8s).
- **Expected event ordering:**
  - AffiliateWidget-native: `affiliate_link_copied {source:"widget"}`.
  - j010 topic (bridge-emitted from `WalletReferralBlock`
    `onClickCapture`): `referral_link_copied {referralUrl, ts}`.
- **Success signal:** clipboard contains `referralUrl`.
- **Failure outcome:** `navigator.clipboard.writeText` rejects (Safari
  / permissions denied) — AffiliateWidget swallows the throw and no
  "Copied ✓" badge appears. No j010 `referral_link_copied` fires
  (click-capture depends on the visible copy affordance being tapped).
- **Telemetry proof:** `referral_link_copied` (j010 topic) + native
  `affiliate_link_copied` (AU-B-6 money-funnel topic).
- **Regression test:**
  `referral.journey.test.ts::copy-link-fires-telemetry` +
  `data-referral-link-present-and-copies-referralurl`.

### station.wallet.user_action_generate_qr

- **Responsible system:** `feature.affiliate-widget-qr`
  (design-os primitive).
- **Source code node:**
  `desktop-2/src/design-os/earn/AffiliateWidget.tsx` · `<QRCodeSVG>`
  render + `downloadQr` handler. Wrapped by `[data-referral-qr]`.
- **Expected customer-visible state:** QR canvas paints as soon as
  `shareUrl` is a non-empty string; "Copy QR" + "Download QR" become
  enabled.
- **Expected event ordering:**
  - j010 topic: `referral_qr_generated {ts}` on first paint.
  - AffiliateWidget-native: `referral_qr_downloaded` when the
    Download QR button is clicked (already wired · pre-existing).
- **Success signal:** QR SVG mounted with `imageSettings` invader
  overlay; PNG download blob resolves.
- **Failure outcome:** No handle → `lc-affiliate-widget-qr-placeholder`
  renders ("Set a handle to generate QR"). No `referral_qr_generated`
  fires — honest empty state.
- **Telemetry proof:** `referral_qr_generated` (j010) + native
  `referral_qr_downloaded` (AU-B-6).
- **Regression test:**
  `referral.journey.test.ts::qr-render-fires-telemetry`.

### station.outbound_share_action

- **Responsible system:** Out-of-band. The customer pastes the URL /
  attaches the QR PNG to a DM, tweet, IG story, etc. Not directly
  observable from the app.
- **Source code node:** N/A (native OS share sheet is deliberately
  out of scope — we don't own the messaging surface).
- **Expected event ordering:** None — the app is a bystander to this
  station.
- **Success signal:** External click observed at
  `attribution_receiver_backend` within the referral-window
  (currently 30d per Whop policy).
- **Failure outcome:** External share happens but the URL is broken
  (typo / stale handle) — the /join redirect surfaces a 404 and no
  attribution ever lands. Journey drifts.

### station.external_click_returns_to_app

- **Responsible system:** `feature.affiliate-redirect` +
  `feature.whop-membership-webhook`.
- **Source code node:**
  `junior-backend/app/routes/affiliate.py` + Whop-native
  `membership_valid` webhook (out-of-repo).
- **Expected input:** Prospect hits `liquidclips.app/join/<handle>`,
  Whop attributes the click, prospect converts to paid membership.
- **Expected event ordering:** None client-side (external).
- **Success signal:** Whop webhook fires
  `membership_valid → affiliate_id resolves to owning customer`.
- **Failure outcome:** Prospect drops off before conversion — the
  click is recorded by Whop but does not produce an attribution
  entry. This is normal funnel drop-off, not journey drift.

### station.attribution_receiver_backend

- **Responsible system:** `feature.affiliate-attribution-writer`.
- **Source code node:**
  `junior-backend/app/routes/whop_payments_proxy.py` +
  `junior-backend/app/routes/affiliate.py` (attribution write path
  post-webhook · already wired pre-BUG-017).
- **Expected event ordering:**
  - Backend emit (P4-owed persistence — see gap flag below):
    `referral_attribution_recorded {affiliate_id, ts}`.
- **Success signal:** New `wallet_ledger` row written with
  `source = 'whop_affiliate'` visible to the owning user on
  `GET /me/wallet/summary`.
- **Failure outcome:** Webhook received but the affiliate lookup
  returns null (handle deleted / rotated) → no ledger row →
  attribution lost.
- **Telemetry proof:** `referral_attribution_recorded` (backend emit
  · today: **stdout-only** via `[LC-CLIENT-DIAG]` analogue on the
  backend log line — see persistence gap).

### station.wallet_ledger_refresh

- **Responsible system:** `feature.wallet-summary` +
  `useWalletLedger`.
- **Source code node:**
  `desktop-2/src/lib/wallet.ts` · `useWalletLedger.refetch()`.
- **Expected input:** User opens Wallet (or presses withdraw / Whop
  activation completes), `refetch()` runs against
  `GET /me/wallet/summary`.
- **Expected event ordering:** `wallet_state_viewed` re-fires when
  the fresh `dataState` transitions (e.g. `fresh_install → paid_normal`).
- **Success signal:** New credit row visible in the "Recent drops"
  card.
- **Failure outcome:** `summary.recent_ledger` is stale (webhook
  race) — usually resolved on the next `refetch()`; documented in
  BUG-004 / BUG-014 sibling context.
- **Telemetry proof:** `wallet_state_viewed` (pre-existing) +
  `withdraw_succeeded` on the eventual payout.

### station.hq_referral_recorded_event

- **Responsible system:** `feature.hq-money-funnel-tile`.
- **Source code node:**
  `junior-backend/app/routes/admin_money_funnel.py` +
  `account-app/src/components/admin/MoneyFunnelTab.tsx`.
- **Expected input:** `referral_attribution_recorded` topic surfaces
  on the money-funnel event stream.
- **Expected event ordering:** N/A (HQ is the terminal consumer).
- **Success signal:** HQ tile increments the "Referrals attributed"
  count for the current day.
- **Failure outcome:** Topic missing → Money Funnel row silent →
  Doctor flags `journey.j010-referral.attribution-missing`.
- **Telemetry proof:** j010 exit event visible on HQ.

## Expected telemetry per station

| Topic | Where fired | Payload | Persistence today |
|---|---|---|---|
| `referral_affordance_mounted` | `WalletReferralBlock` mount effect | `{has_referral_url, has_affiliate_id, ts}` | stdout-only via `/telemetry/diagnostic` |
| `referral_link_copied` | `onClickCapture` bridge in `WalletReferralBlock` | `{referralUrl, ts}` | stdout-only |
| `referral_qr_generated` | `WalletReferralBlock` shareUrl effect | `{ts}` | stdout-only |
| `referral_qr_scan_detected` | (best-effort · not wired · we cannot observe an in-flight scan client-side) | `{ts}` | **NOT wired · P4-owed** |
| `referral_attribution_recorded` | Backend attribution writer (Whop membership_valid webhook path) | `{affiliate_id, ts}` | stdout-only (see persistence gap) |
| `affiliate_link_copied` (native · pre-existing) | AffiliateWidget `copyUrl` | `{source:"widget"}` | stdout-only |
| `referral_qr_downloaded` (native · pre-existing) | AffiliateWidget `downloadQr` | `{}` | stdout-only |

### `expected_telemetry_persistence: stdout-only (P4-owed)`

The `/telemetry/diagnostic` sink at
`junior-backend/app/routes/telemetry_ingest.py::post_diagnostic`
prints every event to stdout with the `[LC-CLIENT-DIAG]` prefix.
Railway logs are the current storage layer — there is NO database
persistence table for these events yet. Adding one for
`referral_attribution_recorded` would require a schema migration
(`referral_attribution_events` or extending `wallet_ledger` metadata)
which is OUT OF SCOPE for BUG-017 per Train A3 stop conditions
(schema migration = HQ persistence P4 owed).

**Documented gap:** `referral_attribution_recorded` is emitted
client-side by the wallet on `activation:complete` / `refetch` as a
best-effort correlation signal, but the authoritative backend emit
is deferred until the persistence migration lands. Doctor should
flag `gap:j010-attribution-persistence` on the HQ money-funnel tile
until then.

## Acceptance test IDs

- `desktop-2/src/routes/wallet-detail/referral.journey.test.ts`
  - `mounts-and-fires-affordance-telemetry`
  - `copy-link-fires-telemetry`
  - `qr-render-fires-telemetry`
  - `data-referral-link-present-and-copies-referralurl`

## Current status

AMBER

- Client-side seams + telemetry wired (BUG-017 close).
- Backend `referral_attribution_recorded` persistence deferred
  (documented gap above · P4-owed).
- HQ money-funnel tile does not yet surface the j010 exit event
  (blocked on persistence).

## Last verified

`2026-07-12 · <commit-sha> · Train A3 dispatch`

## Known bugs blocking

- BUG-017 (closes to FIXED_UNPROVEN with this commit · closure
  conditions per `closes_only_when` in `lcos/graph/bugs.json`).
- BUG-004, BUG-014 (sibling ledger-refresh bugs · orthogonal).

## Recovery / degrade path

- Wallet unreachable (network / 5xx) → user sees the "Wallet is
  briefly unreachable" toast; the referral affordance is still
  mounted (AffiliateWidget's own fetches are resilient); j010
  mount telemetry still fires.
- Handle not claimed → AffiliateWidget renders honest empty state
  (`Set a handle to generate QR`); `referral_qr_generated` does not
  fire; `referral_affordance_mounted` still fires with
  `has_referral_url:false`.
- Whop unlinked → Connect Whop CTA renders alongside referral block;
  `referral_link_copied` still works (customer can share the URL
  even before Whop linkage — attribution requires linkage but the
  copy affordance is functional).

## HQ dashboard

- Money Funnel tile → `08_RUNTIME_GRAPH` node
  `runtime.hq.money-funnel.referrals` (P4-owed once persistence
  lands · today the tile is silent on referrals).
- Journey Map tab (`account-app/src/components/admin/JourneyMapTab.tsx`) →
  j010-referral row wires to this file's status.

## Notes

- The referral-block wrapper (`WalletReferralBlock` in
  `WalletDetail.tsx`) is INTENTIONALLY a Section-pipeline component
  (per DECISION-0010) even though it delegates the widget internals
  to a design-os primitive. This keeps the money-surface rule
  (`desktop-2/CLAUDE.md`) honest — WalletDetail owns the money-surface
  ownership contract for the referral affordance.
- Six-state cancellation logic in WalletDetail is Train C2 territory
  — j010-referral MUST NOT touch it. The referral wrapper wraps
  ONLY the AffiliateWidget mount around line 881, never the ledger
  or wallet-summary code above it.
