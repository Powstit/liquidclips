# journey.j013-cancellation · Subscription cancellation lifecycle

## Purpose

A signed-in customer opens the cancellation intercept surface. The
modal renders one of six canonical lifecycle states (derived from
authoritative backend fields · no fixture · no local override) and
surfaces the correct CTA — retention keep, scheduled-cancel
reactivate, terminal reactivate, or support-only dispute lane —
based on whether the sub is active, canceled + in grace, canceled
past cutoff, refunded, or under chargeback.

j013 owns the "what happens when a customer wants to cancel or
already has" answer. Task #110 · L5 · 6-state cancellation sweep.

## Owning capability

`capability.cancellation-lifecycle`

## Mission fingerprint

`[M2]` (Revenue · retention loop + support surface).

## Prerequisites

- User authenticated (`hasJwt === true`).
- `CancellationIntercept.tsx` mounted (via Settings → Plan →
  Cancel · or direct nav for support cases).
- `useMe()` returned a snapshot including
  `subscriptionStatus` + `paidUntil`.
- `useMoneyRollup()` returned withdraw_gates including
  `affiliate_agreement_signed`.

## Entry conditions

- `hasJwt`
- `CancellationIntercept mounted`
- `deriveCancelLifecycleState()` produced one of the six canonical
  keys.

## Exit conditions (success)

- Customer sees the correct state UI.
- Correct CTA visible + enabled per
  `cancelCtaAvailability(state)`.
- `cancellation_lifecycle_state_viewed` telemetry fires with the
  derived key.
- If retention CTA is clicked → `cancellation_save_clicked` + wallet
  flywheel preserved.
- If terminal reactivate CTA clicked → user is routed to Whop
  subscription reactivation.

## Exit conditions (drift)

- User with `subscription_status='canceled'` + past cutoff renders
  `cancel-attempt` bucket → Doctor flags
  `journey.j013-cancellation.state-drift`.
- Chargeback state renders the standard retention CTA rather than
  support link → INV-004 gate regression.

## Stations (ordered)

### station.cancellation.mount

- **Responsible system:** `feature.cancellation-intercept`.
- **Source code node:**
  `desktop-2/src/routes/cancellation-intercept/CancellationIntercept.tsx`.
- **Expected event ordering:**
  - `cancellation_intercept_viewed { first_view, state, lifecycle_state }`
    (once per mount).
  - `cancellation_intercept_state_viewed { state, lifecycle_state, first_view_of_state }`.
- **Success signal:** modal renders with a resolved
  `data-cancel-lifecycle-state` DOM attribute.
- **Regression test:**
  `desktop-2/src/routes/settings/cancellation.6-state.test.ts` (all
  test blocks assert derivation + CTA availability).

### station.cancellation.derivation

- **Responsible system:** `feature.cancellation-6state-derivation`.
- **Source code node:**
  `CancellationIntercept.tsx::deriveCancelLifecycleState`.
- **Expected input:**
  `{subscriptionStatus, paidUntil, agreementSigned, nowMs?}`.
- **Expected event ordering:**
  - Priority: chargeback > refunded > canceled (bucketed by cutoff)
    > active > never-subscribed.
- **Success signal:** returns one of the six canonical keys.
- **Failure outcome:** unmapped `subscription_status` value →
  falls back to `never-subscribed` (safest UI · offers signup CTA).

The six canonical states:

| # | Key | Derivation | Presentation bucket | Primary CTA |
|---|---|---|---|---|
| 1 | `never-subscribed` | any status not caught below + trial + expired-with-no-history | cancel-attempt | Start subscribing |
| 2 | `active` | `subscription_status == 'active'` | cancel-attempt | Keep · Cancel anyway |
| 3 | `cancelling-scheduled` | `subscription_status` in `canceled/cancelled` + `paid_until` future | paused-then-back | Reactivate |
| 4 | `cancelled-past-cutoff` | `subscription_status` in `canceled/cancelled` + `paid_until` past OR null | already-cancelled | Reactivate + withdraw balance |
| 5 | `refunded` | `subscription_status == 'refunded'` | already-cancelled | Contact support · resolve refund |
| 6 | `chargeback` | `agreementSigned === false` (frozen after payment.disputed) | already-cancelled | Contact support · resolve dispute |

### station.cancellation.cta_availability

- **Responsible system:** `feature.cancellation-cta-availability`.
- **Source code node:**
  `CancellationIntercept.tsx::cancelCtaAvailability`.
- **Expected input:** lifecycle state.
- **Expected output:** `{keepEnabled, quietEnabled, supportOnly}`.
- **Invariant:** `supportOnly && keepEnabled` never both true.
- **Regression test:**
  `cancellation.6-state.test.ts::CTA availability · surface guarantees`.

### station.cancellation.retention_cta

- **Responsible system:** `feature.cancellation-save-cta`.
- **Source code node:** `CancellationIntercept.tsx::onKeep`.
- **Expected event ordering:**
  - `cancellation_save_clicked { cta_id: 'keep', cta_label, state }`
- **Success signal:** state transitions to `paused-then-back` on
  `cancel-attempt`; parent handler fired.

### station.cancellation.confirm_cancel

- **Responsible system:** `feature.cancellation-confirm`.
- **Source code node:** `CancellationIntercept.tsx::onQuiet`.
- **Expected event ordering:**
  - `cancellation_intercept_cta_clicked { cta_id: 'quiet' }`
  - on failure: `cancellation_save_failed { reason }`.
- **Success signal:** state transitions to `already-cancelled` only
  after backend confirms (Promise.resolve wrap around parent
  handler).

### station.cancellation.support_lane

- **Responsible system:** `feature.cancellation-support-only`.
- **Source code node:** `CancellationIntercept.tsx` (support-only
  branch that renders the mailto anchor).
- **Expected input:** `ctaAvailability.supportOnly === true`
  (refunded or chargeback state).
- **Success signal:** anchor renders with test-id
  `cancellation-support-link`.

## Expected telemetry per station

| Topic | Where fired | Payload | Persistence today |
|---|---|---|---|
| `cancellation_intercept_viewed` | mount | `{first_view, state, lifecycle_state}` | stdout via `/telemetry/diagnostic` + LCOS events |
| `cancellation_intercept_state_viewed` | on state or lifecycle change | `{state, lifecycle_state, first_view_of_state}` | same |
| `cancellation_lifecycle_state_viewed` | on lifecycle change | `{lifecycle_state, first_view_of_state}` | same |
| `cancellation_save_clicked` | keep-CTA click | `{cta_id, cta_label, state}` | same |
| `cancellation_intercept_cta_clicked` | quiet-CTA click | `{cta_id, cta_label, state}` | same |
| `cancellation_save_failed` | quiet-CTA failure | `{reason}` | same |
| `founder_video_started` | video unmute | `{surface, video_file}` | same |
| `founder_video_finished` | video end / 75% | `{surface, seconds_watched}` | same |

## Acceptance test IDs

- `desktop-2/src/routes/settings/cancellation.6-state.test.ts`
  - `state 1 · never-subscribed`
  - `state 2 · active`
  - `state 3 · cancelling-scheduled`
  - `state 4 · cancelled-past-cutoff`
  - `state 5 · refunded`
  - `state 6 · chargeback`
  - `state transitions · derivation-order invariants`
  - `CTA availability · surface guarantees`

## Current status

AMBER

- Derivation implemented + tested with pure-function coverage per
  state.
- CTA availability rules enforced in the modal.
- 6-state DOM seams (`data-cancel-lifecycle-state`,
  `data-cancel-cta-*`) allow Doctor + Playwright to assert the
  bucket.
- Doctor Full live-DB parity walk (backend state → UI derivation)
  deferred to Barrier 3.

## Last verified

`2026-07-12 · <commit-sha> · Train C2 dispatch`

## Known bugs blocking

None. The pre-existing R2 (2026-07-11) fixture removal already
shipped honest empty state — j013 hardens the state derivation and
adds the support-only lane which was missing.

## Recovery / degrade path

- `me.snapshot` null → derivation returns `never-subscribed` (safe
  fallback, offers signup CTA).
- Rollup unreachable → `agreementSigned` reads null → chargeback
  gate does NOT trip (pessimism only on hard `false` from
  authoritative rollup).
- Loading state → skeleton renders in modal · CTAs disabled.

## HQ dashboard

- Cancellation Funnel tile →
  `runtime.hq.money-funnel.cancellation`.
- Journey Map tab → j013 row wires to this file's status.
- New HQ Chargeback / Refund panels (P4-owed) consume the same
  telemetry categorised by `lifecycle_state`.

## Notes

- The three legacy visual buckets (`cancel-attempt` ·
  `paused-then-back` · `already-cancelled`) are preserved. They
  now map 1:1 from the 6 lifecycle states via
  `toPresentationBucket()`.
- The R2 fixture-drift audit is enforced by the pre-existing
  cancellation modal test-ids (`cancellation-intercept-loss-table`
  · `cancellation-intercept-zero-state`).
- Fixture-scan: `$99.99` and `$50` are the only allowed money
  literals in the cancellation modal — brand-locked pricing per
  §13a. Every user-specific number
  (clipper count · MRR · balance · next payout) comes from real
  hooks.
