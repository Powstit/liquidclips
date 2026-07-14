# L5 · Agency six-state cancellation sweep · implementation plan

**Base**: `codex/post-rc1-launch` @ `509b91ab`
**Priority**: highest post-P4 work item per `POST_RC1_EXECUTION_PLAN.md` § 3.
**Owner**: Codex (autonomous, but any UI/copy change on money surface reads Daniel first).
**Date**: 2026-07-13

Prove the six subscription lifecycle states render honestly for a real non-admin persona: **active · trial · cancelled but still entitled (grace) · expired · payment failed · no subscription**.

---

## Current billing-state model

`src/lib/billing/types.ts` defines `BillingState`:

```ts
export type BillingState =
  | "free"               // no paid plan
  | "checkout_started"   // redirected to Whop checkout
  | "checkout_failed"    // returned without an active sub
  | "active"             // sub confirmed
  | "past_due"           // payment failed; grace period
  | "cancelled";         // cancelled, tier remains until period end
```

Daniel's six states map to the model like this:

| Daniel state | Model state | Additional flag needed |
|--------------|-------------|------------------------|
| active | `active` | none |
| trial | `active` | new `trialEndsAt: string | null` |
| cancelled but still entitled | `cancelled` | existing `periodEnd` in future |
| expired | `cancelled` (or new `expired`) | `periodEnd` in past |
| payment failed | `past_due` | existing `retryAt` |
| no subscription | `free` | none |

**Design choice**: extend `BillingState` with `"expired"` as a distinct terminal state — `"cancelled"` retains the "period not yet elapsed, entitlement still holds" meaning. Trial stays inside `"active"` with the `trialEndsAt` timestamp on the snapshot.

## Deliverables (single small PR)

1. **Types**: extend `BillingState` union → add `"expired"`. Add `trialEndsAt: string | null` and `periodEnd: string | null` to the snapshot shape.
2. **Adapter**: `clerkAdapter.ts` (or mock) resolves to the new states honestly from `/me/billing` payload.
3. **Consumer** (`useTierCaps`, `useUpgradeCta`): each of the six states routes to a deterministic UI outcome (see § UI matrix below).
4. **Harness**: `tests/e2e/_auth-harness.ts` gains six seeder helpers `seedActive`, `seedTrial`, `seedCancelledEntitled`, `seedExpired`, `seedPaymentFailed`, `seedNoSubscription` — each returns a **non-admin persona** so no admin-only surface can auto-approve.
5. **Spec**: `tests/e2e/cancellation-six-states.spec.ts` — one test per state × asserting:
   - correct entitlement gate
   - correct upgrade-CTA copy
   - correct toast / dialog copy where applicable
   - screenshot artifact per state
6. **KNOWN_ISSUES_AND_DEBT.md**: update the "Account + billing" row.
7. **PR description**: include rollback (revert commit; `BillingState` union stays additive so consumers that don't handle `"expired"` fall through to `"cancelled"` display path safely — no consumer crashes).

## UI matrix (deterministic per state)

| State | Entitlement | TopHud pill | Upgrade CTA | Toast copy on click | Money-surface access |
|-------|-------------|-------------|-------------|---------------------|----------------------|
| active | full | "Agency · Active" | hidden | — | full |
| trial | full while `trialEndsAt > now` | "Agency · Trial ends {date}" | "Continue with Agency · $99.99/mo" | none | full |
| cancelled + entitled | full while `periodEnd > now` | "Agency · Cancels {date}" | "Reactivate Agency" | "Reactivation saved" | full |
| expired | none | "Agency access ended" | "Reactivate Agency" | none | read-only + upgrade nudge |
| payment failed | grace-period-length | "Agency · Payment failed" | "Update payment method" | opens billing management | full while grace |
| no subscription | free tier caps only | "Free Clipper" | "Upgrade to Agency" | opens Whop checkout | free-tier only |

All copy strings must be pulled from a single `src/lib/billing/copy.ts` module so future copy changes are one-file edits and one-file diff-reviews.

## Non-negotiable rules honoured

- No pricing change (LOCKED 2026-07-06 · $0/$99.99).
- No entitlement change without Daniel greenlight — the matrix above encodes the CURRENT product intent, and any deviation requires his sign-off.
- No `test.retries`, no assertion weakening.
- All six state harnesses use **non-admin persona** so no admin surface can bypass gate.
- Copy strings match the money-surface rule (`desktop-2/CLAUDE.md`) — the wallet surface has an approved HTML mockup at `docs/mockups/approved/`; every state must render its copy in that mockup shell.

## Risk classification

- Risk: **medium** (money surface).
- Reversibility: **full** (union type is additive; consumer fall-throughs are safe; harness helpers are test-only).
- Rollback: single revert commit; production runtime remains on `active` / `cancelled` / `past_due` handling. New `expired` state falls back to `cancelled` display in older bundles.

## Gate order for this work

1. targeted spec runs: the six-state spec on `PW_PORT=1420` — must be green in isolation.
2. `tsc -b` clean.
3. vitest clean (nothing new needed unless copy module gets a unit test).
4. shell contracts.
5. targeted rerun of `settings-cockpit.spec.ts` (adjacent money surface).
6. full D1 sweep — required before merge to `main`.

## Ownership boundary

Codex writes the code. Any change to the **entitlement matrix values** (e.g. "grace-period-length for payment_failed") escalates to Daniel because that's product intent. Copy strings that Codex proposes go into a small copy-review checklist for Daniel to greenlight in one pass.

## Next action

Land the changes as a single commit on `codex/post-rc1-launch` labelled `feat(billing): six subscription lifecycle states`. Open PR to `main`. Wait for targeted + D1 green. Rebase against `main` if drift.
