# journey.j008-wallet · Wallet money surface + canonical rollup

## Purpose

An authenticated customer opens the Wallet surface, sees the ONE
canonical set of money numbers (balance · pending · lifetime · MRR ·
referral total · payout-eligible), and either withdraws the eligible
amount or reads why they can't (INV-004 gates). The wallet is the
canonical money surface — every visible dollar value on this surface
reads from `GET /me/money-rollup` (Train C2).

j008 is the M2 (Revenue) primary surface and the M1 (Reach) share
hub, since the referral affordance mounts here (owned by j010).
Without a canonical rollup, UI + HQ + backend can silently disagree
about how much money the user has, what they can withdraw, and why.
That drift shipped BUG-004 + BUG-014 previously; the rollup + INV-004
gates eliminate the class.

## Owning capability

`capability.wallet-money-surface`

## Mission fingerprint

`[M2]` (Revenue · payout eligibility + affiliate MRR).

## Prerequisites

- User is authenticated (`hasJwt === true`).
- `WalletDetail.tsx` mounted (via `#/account` outer hash OR
  Design-OS SimulatorRouter surface mount).
- Backend `/me/money-rollup` reachable + returns a canonical
  `MoneyRollup` shape (see
  `junior-backend/app/routes/money_rollup.py`).

## Entry conditions

- `hasJwt`
- `WalletDetail mounted`
- `useMoneyRollup()` hook has fetched at least once
  (loading state acceptable → renders skeleton).

## Exit conditions (success)

- Customer sees canonical numbers matching backend byte-identical.
- `withdraw_disabled` telemetry is silent OR includes a specific
  `inv004:*` reason code.
- On successful claim, `withdraw_succeeded` fires + rollup refetches.

## Exit conditions (drift)

- Rollup returns malformed shape → wallet renders "briefly
  unreachable" state, `wallet_claim_failed{reason:'network'|'shape'}`
  fires.
- INV-004 gate flip after successful sign-in but rollup not
  refetched → withdraw stays disabled. Fixed by
  `moneyRollup.refetch()` on `activation:complete`.

## Stations (ordered)

### station.wallet.hydrate

- **Responsible system:** `feature.money-rollup-hook`
- **Source code node:** `desktop-2/src/lib/moneyRollup.ts`
  · `useMoneyRollup()`; called from
  `desktop-2/src/routes/wallet-detail/WalletDetail.tsx`.
- **Expected input:** license JWT via `getJwt()`.
- **Expected customer-visible state:** wallet skeleton renders while
  `moneyRollup.loading === true`; hero balance flips to
  `wallet_balance_cents` value once loaded.
- **Expected event ordering:**
  - `wallet_viewed` (once per mount)
  - `wallet_state_viewed` (once per data-state transition)
- **Success signal:** `data-money-rollup-loaded="true"` on the root
  `.wd-root` element.
- **Failure outcome:** `errorReason` populated · full-screen error
  state renders.
- **Regression test:**
  `desktop-2/src/routes/wallet-detail/money-rollup.test.ts::money-rollup-hook-wired`.

### station.wallet.rollup_seams_mirror_backend

- **Responsible system:** `feature.money-rollup-mirror-seams`.
- **Source code node:** `WalletDetail.tsx` root `<div>` — carries
  `data-money-rollup-*` attributes for balance / MRR / referral total
  / payout-eligible / lifetime / as-of-ts.
- **Expected input:** `moneyRollup.rollup` populated.
- **Expected event ordering:** N/A (seam-only).
- **Success signal:** every `data-money-rollup-*-cents` attribute
  equals the backend `MoneyRollup` field byte-identical.
- **Failure outcome:** stale seam · Doctor flags
  `journey.j008-wallet.mirror-drift`.
- **Telemetry proof:** none client-side — the assertion is a Doctor
  live-DB diff.
- **Regression test:**
  `money-rollup.test.ts::money-rollup-seams-mirror-backend` +
  `junior-backend/tests/test_money_rollup_consistency.py::test_rollup_ui_hq_direct_are_byte_identical`.

### station.wallet.mrr_metric

- **Responsible system:** `feature.affiliate-mrr-metric`.
- **Source code node:** `WalletDetail.tsx` `mrrCents` derivation
  around the 4-metric row.
- **Expected input:**
  `moneyRollup.rollup.affiliate_mrr_cents > 0`.
- **Expected customer-visible state:** "Your MRR" metric card
  renders `fmtUsdCents(mrrCents)`. When zero, cell hides (honest
  empty state).
- **Success signal:** MRR value matches
  `eligible_referral_count × BASE_AFFILIATE_MRR_CENTS_PER_REFERRAL`
  from the backend rollup.
- **Failure outcome:** MRR reads 0 despite eligible referrals →
  investigate `eligible_referral_count` service.
- **Regression test:**
  `desktop-2/src/routes/affiliate/affiliate.journey.test.ts::affiliate-mrr-reads-canonical-rollup`.

### station.wallet.inv004_eligibility

- **Responsible system:** `feature.withdraw-inv004-gate`.
- **Source code node:** `WalletDetail.tsx` `inv004Eligible`
  derivation + `claimDisabled` guard.
- **Expected input:** `moneyRollup.rollup.withdraw_gates` with the
  four boolean fields.
- **Expected customer-visible state:** withdraw button disabled with
  audit seams (`data-inv004-eligible` + `data-gate-*`).
- **Expected event ordering:**
  - `withdraw_disabled { reason }` — fires once per reason
    transition. Reason codes:
    - `inv004:agreement_unsigned`
    - `inv004:whop_unlinked`
    - `inv004:payout_not_ready`
    - `balance_below_minimum`
    - `ui_state:<state>`
    - `rollup_loading`
- **Success signal:** withdraw button enabled AND
  `data-inv004-eligible="true"` when every gate is true.
- **Failure outcome:** any gate false → button disabled → HQ Money
  Funnel bucketises the failure by reason code.
- **Regression test:**
  `money-rollup.test.ts::money-rollup-inv004-gate-enforced` +
  `test_money_rollup_consistency.py::test_inv004_gates_all_false_when_new_user` +
  `test_inv004_gates_flip_true_with_full_setup` +
  `test_inv004_payout_zero_when_one_gate_false`.

### station.wallet.claim

- **Responsible system:** `feature.wallet-claim-endpoint`.
- **Source code node:** `WalletDetail.tsx runClaim` +
  `junior-backend/app/routes/me_wallet.py::claim_wallet_payout`.
- **Expected input:** `inv004Eligible === true` + user tap.
- **Expected event ordering:**
  - `withdraw_clicked { available_cents }`
  - either `withdraw_succeeded { amount_cents }` OR
    `withdraw_failed { reason }` +
    `wallet_claim_failed { reason }`
- **Success signal:** toast "Payout released" + rollup refetches.
- **Failure outcome:** `blocked_reason.code === 'signature_frozen'`
  → chargeback lane (see j013-cancellation).
- **Regression test:**
  `desktop-2/src/lib/wallet.claim.test.ts` (pre-existing) +
  `money-rollup.test.ts::money-rollup-inv004-gate-enforced`.

### station.wallet.rollup_refetch_on_activation

- **Responsible system:** `feature.money-rollup-refetch-on-oauth`.
- **Source code node:** `WalletDetail.tsx useEvent('activation:complete')`.
- **Expected input:** Whop OAuth completion event.
- **Expected event ordering:**
  - `connect_whop_completed { source }`
  - `moneyRollup.refetch()` fires (implicit)
- **Success signal:** `whop_connected` gate flips true within one
  refetch cycle.
- **Regression test:**
  `money-rollup.test.ts::money-rollup-hook-wired` asserts the wire
  is in place.

## Expected telemetry per station

| Topic | Where fired | Payload | Persistence today |
|---|---|---|---|
| `wallet_viewed` | WalletDetail mount | `{state, data_state, state_override}` | stdout via `/telemetry/diagnostic` + LCOS event persistence |
| `wallet_state_viewed` | WalletDetail on data-state transition | `{state, first_view_of_state, state_override}` | same |
| `withdraw_disabled` | claim-guard useEffect | `{reason}` | same |
| `withdraw_clicked` | runClaim entry | `{available_cents}` | same |
| `withdraw_succeeded` | runClaim happy path | `{amount_cents}` | same |
| `withdraw_failed` | runClaim failure | `{reason}` | same |
| `wallet_claim_failed` | runClaim failure sibling emit | `{reason}` | same |
| `connect_whop_completed` | activation:complete handler | `{source:'wallet_detail'}` | same |

## Acceptance test IDs

- `desktop-2/src/routes/wallet-detail/money-rollup.test.ts`
  - `money-rollup-hook-wired`
  - `money-rollup-inv004-gate-enforced`
  - `money-rollup-seams-mirror-backend`
  - `money-rollup-no-fixture-money-literals`
- `junior-backend/tests/test_money_rollup_consistency.py`
  - `test_rollup_returns_canonical_shape`
  - `test_rollup_reflects_credit_from_wallet_ledger`
  - `test_rollup_ui_hq_direct_are_byte_identical`
  - `test_inv004_gates_all_false_when_new_user`
  - `test_inv004_gates_flip_true_with_full_setup`
  - `test_inv004_payout_zero_when_one_gate_false`
  - `test_hq_mirror_returns_same_shape_as_customer_endpoint`

## Current status

AMBER — implementation lands with tests. AMBER not GREEN because
Doctor-Full live-DB parity walk is deferred to Barrier 3 (integration
lead) per Train C dispatch matrix.

## Last verified

`2026-07-12 · <commit-sha> · Train C2 dispatch`

## Known bugs blocking

None. BUG-004 + BUG-014 (wallet ledger refresh) remain
FIXED_UNPROVEN from Train A2. Class-elimination targets BC-002 +
BC-005 are advanced by j008 (fixture drift + divergent stores both
eliminated on the wallet surface).

## Recovery / degrade path

- Rollup 401/403 → wallet renders `unauthorized` state with sign-in
  CTA.
- Rollup network fail / shape drift → wallet renders `error` state
  with retry button.
- Withdraw endpoint 5xx → toast "Wallet briefly unreachable" +
  `wallet_claim_failed{reason:'network'}` telemetry.

## HQ dashboard

- Money Funnel tile → `08_RUNTIME_GRAPH` node
  `runtime.hq.money-funnel.wallet-viewed`.
- Journey Map tab
  (`account-app/src/components/admin/JourneyMapTab.tsx`) → j008
  row wires to this file's status.
- New HQ Money Rollup Mirror panel (P4-owed) will consume
  `/admin/money-rollup/{user_id}` for byte-identical parity display.

## Notes

- Fixture-scan proof: `WalletDetail.tsx` no longer contains any
  numeric dollar/cents literal that could be user-specific. Brand-
  locked pricing constants (`$99.99` subscription · `$50` per-
  referral share · `$50` min withdraw) are the sole allowed money
  literals and are enumerated in
  `money-rollup.test.ts::money-rollup-no-fixture-money-literals`.
- The referral block within `WalletDetail.tsx` is A3 territory —
  j010-referral owns those seams. j008 owns only the summary +
  MRR + claim + rollup mirror.
