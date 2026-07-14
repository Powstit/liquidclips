# journey.j012-payout · Payout eligibility + withdrawal + settlement

## Purpose

A signed-in customer with an eligible balance clicks Withdraw, the
click-wrap affiliate agreement is honoured or requested, the Whop
payout portal moves money to their connected wallet, the ledger
records a `payout` row, and every dollar amount along the way
matches backend byte-identical.

j012 is the M2 (Revenue) settlement surface. Without INV-004 enforced
strictly + a canonical eligibility computation, the wallet ships the
same class of drift Train A2 flagged in BUG-004 + BUG-014. INV-004
in Train C2 forces every gate through the same `/me/money-rollup`
readout so UI + backend + HQ Money Funnel all say the same "yes /
no you can withdraw" answer.

**Numbering note:** Train C2 dispatch matrix reassigned this file from
`j011-payout` to `j012-payout` to avoid a filename clash with Train B2's
`j011-campaigns-navigation.md`. All references (Doctor · HQ Journey
Map · this file's Acceptance test IDs) point at `j012` from Train C2
forward.

## Owning capability

`capability.wallet-payout`

## Mission fingerprint

`[M2]`

## Prerequisites

- User authenticated (`hasJwt === true`).
- Wallet ledger has one or more credit rows summing to > $0.
- User has signed the Partner & Affiliate Agreement OR is on
  `is_admin_bypass()` allow-list.
- User has connected Whop (`whop_user_id` populated).
- User has completed sub-merchant onboarding
  (`whop_sub_merchant_status == 'onboarded'`).

## Entry conditions

- All four `withdraw_gates.*` are true on `/me/money-rollup`.

## Exit conditions (success)

- Click → `/me/wallet/claim` returns
  `{blocked: false, receipt_sha256, contract_version}`.
- Wallet ledger receives a `payout` row for the released amount.
- `compute_balance()` reflects credits − debits − payouts (may drop
  to zero after full drain).
- Wallet refetches + rollup refetches → `payout_eligible_cents`
  drops to zero for the next tick.
- `withdraw_succeeded {amount_cents}` telemetry fires.

## Exit conditions (drift)

- User clicks Withdraw but INV-004 gates are false → button
  disabled + `withdraw_disabled { reason }` fires.
- Wallet UI shows eligible balance X, backend rollup shows Y →
  Doctor flags `journey.j012-payout.balance-drift`.
- Signature freeze detected (`signature_frozen` blocked reason) →
  wallet flips to `expired-affiliate-agreement` UI state.

## Stations (ordered)

### station.payout.rollup_gates

- **Responsible system:** `feature.money-rollup-gates`.
- **Source code node:**
  `junior-backend/app/routes/money_rollup.py::_compute_money_rollup`
  (withdraw_gates block).
- **Expected input:** DB session + user.
- **Success signal:** `withdraw_gates` returns 4 booleans reflecting
  authoritative state.
- **Failure outcome:** any gate false → `payout_eligible_cents = 0`
  regardless of balance.
- **Regression test:**
  `junior-backend/tests/test_money_rollup_consistency.py::test_inv004_gates_all_false_when_new_user` +
  `test_inv004_gates_flip_true_with_full_setup` +
  `test_inv004_payout_zero_when_one_gate_false`.

### station.payout.ui_gate_enforcement

- **Responsible system:** `feature.wallet-withdraw-cta`.
- **Source code node:**
  `desktop-2/src/routes/wallet-detail/WalletDetail.tsx`
  (`claimDisabled` + `inv004Eligible`).
- **Expected event ordering:** `withdraw_disabled { reason }` fires
  once per reason transition.
- **Success signal:** button disabled unless every gate is true.
- **Regression test:**
  `desktop-2/src/routes/wallet-detail/money-rollup.test.ts::money-rollup-inv004-gate-enforced`.

### station.payout.claim_call

- **Responsible system:** `feature.wallet-claim-endpoint`.
- **Source code node:**
  `junior-backend/app/routes/me_wallet.py::claim_wallet_payout`.
- **Expected input:** license JWT.
- **Expected event ordering:**
  - `withdraw_clicked { available_cents }`
  - either
    - `withdraw_succeeded { amount_cents }` (happy path)
    - `withdraw_failed { reason }` +
      `wallet_claim_failed { reason }` (network / auth / signature)
- **Success signal:** endpoint returns
  `{blocked: false, receipt_sha256: <64hex>, contract_version: <str>}`.
- **Failure outcome:** blocked responses opens the click-wrap
  browse panel (`signature_required`) or flips wallet to expired
  state (`signature_frozen`).

### station.payout.ledger_write

- **Responsible system:** `feature.wallet-ledger-payout-row`.
- **Source code node:**
  `junior-backend/app/wallet.py::record_payout` +
  `junior-backend/app/cron.py::payout_scheduler` (Whop API
  dispatch).
- **Expected input:** due credits queried by
  `due_credits_by_user`.
- **Success signal:** `WalletLedger` row with `type='payout'` and a
  populated `whop_payout_id`.
- **Failure outcome:** Whop API 5xx → scheduler retries on next
  tick, row not written until Whop confirms.

### station.payout.rollup_refresh

- **Responsible system:** `feature.money-rollup-refetch`.
- **Source code node:** `WalletDetail.tsx runClaim` success branch
  calls `refetch()` on wallet ledger + rollup implicit via next
  mount.
- **Success signal:** hero balance updates within one refetch cycle.

## Expected telemetry per station

| Topic | Where fired | Payload | Persistence today |
|---|---|---|---|
| `withdraw_disabled` | WalletDetail claim guard | `{reason}` | stdout via `/telemetry/diagnostic` + LCOS event persistence |
| `withdraw_clicked` | runClaim entry | `{available_cents}` | same |
| `withdraw_succeeded` | runClaim happy | `{amount_cents}` | same |
| `withdraw_failed` | runClaim failure | `{reason}` | same |
| `wallet_claim_failed` | runClaim failure (sibling) | `{reason}` | same |
| `payout_scheduler_tick` (backend) | `cron.py::payout_scheduler` | `{users_processed, payouts_sent}` | Railway logs |

## Acceptance test IDs

- `desktop-2/src/routes/wallet-detail/money-rollup.test.ts`
  - `money-rollup-inv004-gate-enforced`
- `junior-backend/tests/test_money_rollup_consistency.py`
  - `test_rollup_returns_canonical_shape`
  - `test_inv004_gates_all_false_when_new_user`
  - `test_inv004_gates_flip_true_with_full_setup`
  - `test_inv004_payout_zero_when_one_gate_false`
- `junior-backend/tests/test_wallet_ledger.py` (pre-existing)
  - `test_record_payout_writes_row`
  - `test_compute_balance_sums_credits_minus_debits_minus_payouts`
- `desktop-2/src/lib/wallet.claim.test.ts` (pre-existing) — claim
  helpers pinned.

## Current status

AMBER

- Backend gates implemented + tested via TestClient.
- Frontend gate enforced + telemetry categorises failures.
- Doctor Full live-DB payout walk deferred to Barrier 3.
- Whop payout API dispatch is env-gated (`CARROT_WHOP_LIVE`);
  live-fire proof deferred until the beta cohort walk.

## Last verified

`2026-07-12 · <commit-sha> · Train C2 dispatch`

## Known bugs blocking

- BUG-004 · BUG-014 (Train A2 · FIXED_UNPROVEN) — sibling ledger
  refresh drift. INV-004 does not fix them directly but the
  canonical rollup surfaces the drift immediately if it recurs.

## Recovery / degrade path

- Signature missing → `signature_required` blocked reason → wallet
  opens click-wrap in browse panel · re-runs `/claim` on
  `affiliate_agreement_signed` postMessage.
- Signature frozen → `signature_frozen` blocked reason → wallet
  flips to `expired-affiliate-agreement` UI state.
- Whop API failure → `withdraw_failed{reason:'network'}` +
  scheduler retries next tick.
- Rollup unreachable → withdraw button disabled with
  `rollup_loading` reason. Refetch on retry.

## HQ dashboard

- Money Funnel · Withdraw funnel tile →
  `runtime.hq.money-funnel.withdraw`.
- Wallet-Payout drift tile (P4-owed) → will surface any UI ↔
  backend discrepancy on `/admin/money-rollup/{user_id}` mirror
  read.

## Notes

- Fees + minimums are locked constants in
  `app.whop_payments.MIN_WITHDRAWAL_USD` +
  `LC_PROTOCOL_FEE_PCT`. Both are read by `me_wallet.py` and
  surfaced on the wallet fine-print. Not fixtures.
- The `/me/wallet/claim` endpoint's signature gate is the entry
  point for the chargeback lane (j013-cancellation state 6).
