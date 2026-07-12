# journey.j009-affiliate · Affiliate revenue surface

## Purpose

A signed-in customer with a claimed handle sees their canonical
affiliate MRR + eligible referral count + payout eligibility on the
wallet money surface AND on the account-app affiliate dashboard, and
those values match backend byte-identical. j009 owns the
"how much am I earning as an affiliate?" answer for the whole
product. Backed by the canonical money-rollup (Train C2).

j009 is the M2 (Revenue) affiliate answer. Without a canonical MRR
computation, the wallet's "Your MRR" tile, the account-app
`/affiliate/me` block, and the backend `eligible_referral_count()`
service can silently disagree. j009 fixes that by wiring every read
to `/me/money-rollup`.

## Owning capability

`capability.affiliate-revenue`

## Mission fingerprint

`[M2]`

## Prerequisites

- User is authenticated + has a claimed handle.
- Whop affiliate has been provisioned
  (`user.whop_affiliate_id` populated).
- At least one referred user exists with
  `subscription_status == 'active'` and `first_paid_at` older than
  the 7-day good-standing threshold.

## Entry conditions

- `hasJwt`
- `moneyRollup.rollup !== null` (or non-null after loading)

## Exit conditions (success)

- Wallet MRR card renders `affiliate_mrr_cents` value formatted
  as `$X/mo`.
- `/me/affiliate` response's `qualification.paid_referrals_count`
  equals the count used in `eligible_referral_count()` in
  `_compute_money_rollup`.
- HQ mirror at `/admin/money-rollup/{user_id}` returns the same
  affiliate MRR byte-identical.

## Exit conditions (drift)

- Wallet renders MRR X, HQ Money Funnel renders MRR Y → Doctor
  flags `journey.j009-affiliate.mrr-drift`.
- Withdraw button enabled but `payout_ready === false` → INV-004
  regression.

## Stations (ordered)

### station.affiliate.enrollment

- **Responsible system:** `feature.whop-affiliate-provisioning`.
- **Source code node:**
  `junior-backend/app/routes/affiliate.py::_fetch_whop_affiliate`
  and cache write at `build_affiliate_me_response`.
- **Expected input:** Whop API call returning affiliate record.
- **Expected customer-visible state:** `Connect Whop` CTA hides
  once `whop_user_id` populates on `/me`.
- **Success signal:** `user.whop_affiliate_id` non-null.
- **Failure outcome:** Whop 5xx / transient → affiliate block
  degrades to `connected: false` (per `AffiliateBlock` model),
  wallet displays honest empty state.

### station.affiliate.qualification

- **Responsible system:**
  `feature.affiliate-qualification-service`.
- **Source code node:**
  `junior-backend/app/services/affiliate_commission.py::eligible_referral_count`.
- **Expected input:** referrer user + optional `now`.
- **Success signal:** returns non-zero for a referrer with at least
  one paid referral past the 7-day hold.
- **Failure outcome:** returns 0 → wallet MRR renders as zero /
  hides the card.

### station.affiliate.mrr_read

- **Responsible system:** `feature.money-rollup-mrr`.
- **Source code node:**
  `junior-backend/app/routes/money_rollup.py::_compute_money_rollup`
  (affiliate MRR block).
- **Expected input:** `_user` + DB session.
- **Expected event ordering:** N/A (read-only).
- **Success signal:** `affiliate_mrr_cents` equals
  `eligible_referral_count × BASE_AFFILIATE_MRR_CENTS_PER_REFERRAL`
  (4999 cents).
- **Regression test:**
  `desktop-2/src/routes/affiliate/affiliate.journey.test.ts::affiliate-mrr-reads-canonical-rollup`.

### station.affiliate.wallet_mrr_display

- **Responsible system:** `feature.wallet-mrr-metric`.
- **Source code node:**
  `desktop-2/src/routes/wallet-detail/WalletDetail.tsx` (`mrrCents`
  derivation).
- **Expected input:** `moneyRollup.rollup.affiliate_mrr_cents > 0`.
- **Expected customer-visible state:** "Your MRR" tile in the
  4-metric row renders `fmtUsdCents(mrrCents)`.
- **Failure outcome:** rollup null / MRR zero → tile hides · honest
  empty state · no fabricated `$0.00`.
- **Regression test:**
  `desktop-2/src/routes/wallet-detail/money-rollup.test.ts::money-rollup-hook-wired`.

### station.affiliate.payout_eligibility

- **Responsible system:** `feature.withdraw-inv004-gate`.
- **Source code node:**
  `WalletDetail.tsx inv004Eligible` + backend
  `money_rollup._compute_money_rollup` gate block.
- **Expected event ordering:** `withdraw_disabled { reason }` when
  any gate is false.
- **Success signal:** withdraw button enabled + rollup
  `payout_eligible_cents === wallet_balance_cents`.

### station.affiliate.attribution_write

- **Responsible system:** `feature.affiliate-attribution-recorder`.
- **Source code node:**
  `junior-backend/app/routes/affiliate.py::record_attribution`.
- **Expected input:** `{referred_user_id, affiliate_id, ts_ms?}` +
  x-internal-secret header.
- **Expected event ordering:**
  - `referral_attribution_recorded { referred_user_id, affiliate_id, ts }`
    persisted as an LCOS event (idempotent by ts_ms + payload hash).
- **Success signal:** endpoint returns
  `{accepted: true, duplicate: false, event_id: <int>}`.
- **Failure outcome:**
  - Unknown `referred_user_id` → 404.
  - Missing / mismatched internal secret → 401.
- **Regression test:**
  `desktop-2/src/routes/affiliate/affiliate.journey.test.ts::affiliate-attribution-endpoint-shape` +
  `junior-backend/tests/test_money_rollup_consistency.py::test_attribution_endpoint_writes_lcos_event` +
  `test_attribution_endpoint_is_idempotent`.

### station.affiliate.hq_mirror

- **Responsible system:** `feature.hq-money-rollup-mirror`.
- **Source code node:**
  `junior-backend/app/routes/money_rollup.py::admin_money_rollup`.
- **Expected input:** internal secret + target `user_id`.
- **Success signal:** returns the SAME shape as `/me/money-rollup`
  for the target user, byte-identical.
- **Regression test:**
  `test_money_rollup_consistency.py::test_hq_mirror_returns_same_shape_as_customer_endpoint` +
  `test_rollup_ui_hq_direct_are_byte_identical`.

## Expected telemetry per station

| Topic | Where fired | Payload | Persistence today |
|---|---|---|---|
| `withdraw_disabled` | wallet claim guard | `{reason}` including `inv004:*` codes | stdout via `/telemetry/diagnostic` + LCOS events |
| `withdraw_succeeded` | wallet claim happy | `{amount_cents}` | same |
| `referral_attribution_recorded` | backend attribution recorder (`/affiliate/attribution/record`) | `{referred_user_id, affiliate_id, ts}` | LCOS event table (persisted · queryable via `/admin/lcos-events`) |

## Acceptance test IDs

- `desktop-2/src/routes/affiliate/affiliate.journey.test.ts`
  - `affiliate-mrr-reads-canonical-rollup`
  - `affiliate-payout-eligibility-gated`
  - `affiliate-widget-mounted-on-wallet`
  - `affiliate-attribution-endpoint-shape`
- `junior-backend/tests/test_money_rollup_consistency.py`
  - `test_attribution_endpoint_writes_lcos_event`
  - `test_attribution_endpoint_is_idempotent`
  - `test_attribution_endpoint_404_on_missing_user`
  - `test_attribution_endpoint_rejects_missing_internal_secret`
  - `test_rollup_ui_hq_direct_are_byte_identical`

## Current status

AMBER

- Backend rollup + attribution recorder implemented in Train C2.
- Frontend wallet consumes canonical rollup.
- Doctor Full live-DB parity walk deferred to Barrier 3.
- HQ Money Rollup Mirror panel P4-owed (backend endpoint ready ·
  frontend tile pending B3 successor sprint).

## Last verified

`2026-07-12 · <commit-sha> · Train C2 dispatch`

## Known bugs blocking

- BUG-017 (referral affordance) — orthogonal, FIXED_UNPROVEN.
- No new bugs opened by j009 authoring; drift will surface via
  Doctor Full during Barrier 3 gates.

## Recovery / degrade path

- Whop 5xx → affiliate block degrades to `connected: false`, wallet
  hides MRR tile, no fabricated MRR.
- Rollup unreachable → wallet renders "briefly out of reach" state,
  MRR tile hides.
- Attribution endpoint 5xx → LCOS event fails to persist ·
  operator-side retry via the LCOS ingest replay path.

## HQ dashboard

- Money Funnel tile → `runtime.hq.money-funnel.mrr`.
- Money Rollup Mirror (P4-owed) → new tile driven by
  `/admin/money-rollup/{user_id}` · byte-identical parity check
  against wallet UI seams.

## Notes

- The affiliate/referral share primitives live in
  `desktop-2/src/design-os/earn/AffiliateWidget.tsx` and are
  mounted on the wallet money surface via `WalletReferralBlock`
  (A3 territory — j010).
- j009 owns the MRR + payout eligibility answer; j010 owns the
  share affordance + attribution client-side. The two journeys
  meet at the backend `referral_attribution_recorded` topic.
- `BASE_AFFILIATE_MRR_CENTS_PER_REFERRAL = 4999 cents` — not a
  fixture, this is the LC×Whop economics constant. If §13a locked
  pricing changes, update
  `services/affiliate_commission.py::AFFILIATE_MRR_SHARE_PCT` and
  the rollup constant follows.
