# Wave 1 · Post-Merge Impact Report

**Branch merged:** `wave-1/identity-ladder` @ `b34f28e5`
**Merge commit:** `cc6784c7` on `integration/cold-entry-mode-b`
**Auth-hardening commits landed alongside (main-repo cleanups):** `c2421921` (auth hardening + BC-003 elimination) · `db9e95a4` (ship-lens Phase-2 frozen audit)
**Cluster:** cluster-1.identity-ladder
**Bugs transitioned:** BUG-002 · BUG-003 · BUG-011 · BUG-013 → all `FIXED_UNPROVEN`
**Author:** Wave 1 implementer agent + main-repo curation this session
**Time:** 2026-07-12T08:35Z
**Template:** `lcos/reports/IMPACT_REPORT_TEMPLATE.md` (with §15-17 per DECISION-0010 + 0011)

---

## 1. Files changed (post-merge summary · 22 files across the merge + preamble commits)

Delta over `4cb70fb0`:
- Merge `cc6784c7` (Wave 1 branch content · summary of what the wave landed)
- `c2421921` (auth-hardening preamble on integration)
- `db9e95a4` (ship-lens audit preamble on integration)

Full file listing tracked in the merge commit; the auth-hardening files were:
- `junior-backend/app/routes/desktop_auth.py` (Block A + atomic-consume)
- `junior-backend/tests/test_desktop_auth_hardening.py` (new · 9 gates)
- `desktop-2/docs/ship-lens-review.json` (Phase-2 audit frozen)

## 2. Canonical owner changes

**Before Wave 1:**
- `state.handle` writer set: `POST /me/handle` handler (in `handle.py`) · `POST /me/lc-id/claim` did not exist
- `state.lc-id` writer set: undefined (column present, no endpoint)
- `state.current-user` reader set: `TopHud` via `useMe` + `handleFromEmail` derivation

**After Wave 1:**
- `state.handle` writer set: **`services.identity_claim.claim_handle` only.** Both routes (`POST /me/lc-id/claim` primary + `POST /me/handle` deprecated alias) delegate. `AffiliateWidget` migrated to primary.
- `state.lc-id` writer set: `services.identity_claim.claim_handle` (creates row on claim) · reader set: `MeResponse.lc_id` → `MeSnapshot.lcId`
- `state.current-user` reader set: `hook.useMe.identityLadder` selector (single canonical) · `TopHud` + `SplashLeaderboard` both read it

**Duplicate writers removed:** `POST /me/handle` no longer contains independent write logic (delegates to canonical service).

**Duplicate writers preserved (with justification):** `POST /me/handle` alias kept for AffiliateWidget migration window; retirement scheduled Wave 2. Emits `X-Deprecation` header + warn log per call. NOT synchronisation — same underlying writer.

> Wave contract rule check: no synchronisation between two writers exists. One canonical writer, two thin transports.

## 3. Chain-link updates

| Layer | Delta |
|---|---|
| Mission fingerprint | M1 GREEN-unproven (was AMBER) · M3 for identity axis GREEN-unproven (was DEGRADED) |
| Capability | `capability.identity-trust` FIXED_UNPROVEN (was RED) |
| Feature | `feature.session-lifecycle`, `feature.lc-id`, `feature.handle` implemented in code; contracts still owed (P6 gap) |
| Journey | `j001-fresh-user-otp-identity` claim-ceremony now exists in code; station chain unauthored (P6 gap) |
| Station | `station.identity.claim-handle` + `station.identity.confirm-lc-id` implemented; registry unauthored (P6 gap) |
| Canonical state | `state.handle` writer count → 1 (confidence 1.00) · `state.lc-id` confidence 1.00 · `state.current-user` axes +2 |

## 4. Journeys affected

| Journey | Before | After (predicted) | Verification method |
|---|---|---|---|
| j001-fresh-user-otp-identity | RED | GREEN-unproven | live walk on promoted bundle (owed) |
| j002-returning-user | AMBER (Guest during hydration) | GREEN-unproven | live walk |
| j003-crew-onboarding | AMBER (no claim sheet) | GREEN-unproven | live walk |
| j004-connect-whop | RED (not Wave 1 target) | unchanged | Wave 2 |

## 5. Golden paths affected

Golden-paths registry not yet authored (P4 gap). Journey-level rollups above stand in.

## 6. Business capabilities affected

- `capability.identity-trust` · RED → FIXED_UNPROVEN (M3 lift)
- `capability.creator-onboarding` · Crew flow gained ClaimHandleSheet mount (M1 lift)
- `capability.affiliate-revenue` · AffiliateWidget migrated to canonical endpoint (no regression, no lift)

## 7. Telemetry

**Topics added (5):**
| Topic | Payload | Consumer | Persistence |
|---|---|---|---|
| `me_snapshot_hydrated` | `{ source, hasLcId, hasHandle }` | `useMe.ts` | stdout only · HQ persistence deferred |
| `handle_claimed` | `{ lc_id, handle, ts_ms }` | `ClaimHandleSheet` | stdout only |
| `claim_sheet_opened` | `{ mountReason }` | `ClaimHandleSheet` | stdout only |
| `complete_profile_cta_clicked` | `{ source: top-hud \| splash-leaderboard }` | `TopHud` + `SplashLeaderboard` | stdout only |
| `handle_write` (backend) | `{ source, lc_id, handle }` | `identity_claim` service | stdout only |

**Topics deleted:** none.

## 8. Regression tests

**Added:**
- `desktop-2/src/design-os/components/TopHud.identity-ladder.test.ts` · 11 assertions · protects `hook.useMe.identityLadder` + TopHud render
- `desktop-2/src/design-os/state/useMe.lc-id.test.ts` · 10 assertions
- `desktop-2/src/design-os/onboarding/handle-claim.flow.test.ts` · 13 assertions
- `desktop-2/src/overlays/invaders/SplashLeaderboard.test.ts` · 3 mirror assertions
- `junior-backend/tests/test_me_lc_id_claim.py` · 15 assertions
- `junior-backend/tests/test_identity_claim_service.py` · 6 divergence-proof assertions
- `junior-backend/tests/test_desktop_auth_hardening.py` · 9 gate assertions (BC-003 elimination)

**Modified:**
- `TopHud.pill.test.ts` · updated to lock new ladder shape (was locked to prior ternary)
- `TopHud.identity.test.ts` · agency copy assertion updated

**Deleted:** none.

## 9. Risk assessment

- **Risk level:** LOW (all gates green · no shell touch · single canonical writer · rollback complexity LOW)
- **Blast radius:** identity path + auth verify path · no downstream module was silently affected
- **Shell impact:** none (DECISION-0003 intact)
- **Ship-lens P0/P1 predicted:** 0 (verified · pass with 0 P0/P1 findings · 2 P2 residuals: nameless-strip edge case, SideNav Guest fallback)
- **Rollback complexity:** LOW (single-revert of merge commit; auth hardening + ship-lens JSON are independent preamble commits)

## 10. Rollback plan

**Pre-merge SHA (integration):** `db9e95a4`
**Rollback command:** `git revert -m 1 cc6784c7` (revert the merge · keeps auth-hardening + ship-lens commits intact)
**Data-migration reverse:** none required (Wave 1 did not add columns to `users`; the `lc_id` + `handle` columns were pre-existing)
**Telemetry cleanup on rollback:** 5 new topics stop emitting naturally (no HQ persistence yet · no consumers to notify)
**Verification after rollback:** run `pnpm test` + `pytest` · verify TopHud reverts to prior ladder · verify `/me/lc-id/claim` returns 404

## 11. Bug status transitions

| Bug ID | Before | After | Blocks CLOSED on |
|---|---|---|---|
| BUG-002 | OPEN | FIXED_UNPROVEN | Doctor Full + live journey walk + HQ event persistence |
| BUG-003 | OPEN | FIXED_UNPROVEN | Doctor Full + live claim ceremony walk |
| BUG-011 | OPEN | FIXED_UNPROVEN | Doctor Full observes `data-identity-copy` literal in live DOM |
| BUG-013 | OPEN | FIXED_UNPROVEN | Doctor Full observes greeting personalises across time-of-day matrix |

**Zero CLOSED transitions this merge.** Only Doctor Full may CLOSED per DECISION-0008.

## 12. Live customer walkthrough steps

Owed to Daniel or Doctor Full. Ten steps documented in `02-gap-closure.md` §12. Not executed this session.

## 13. Doctor Lite verdict

Doctor Lite (per DECISION-0008) declines to certify Wave 1 as CLOSED. Its verdict on the merge:

```
LCOS DOCTOR (LITE) · 2026-07-12T08:35Z · source_sha cc6784c7 · doc_freshness ok
Query: does Wave 1 satisfy every closes_only_when clause for BUG-002 · BUG-003 · BUG-011 · BUG-013
Verdict: escalate-to-doctor-full
Confidence: HIGH on test coverage (dynamic + regression + backend + frontend all green) ·
            MEDIUM on live-customer verification (walk owed on promoted bundle) ·
            LOW-until-Doctor-Full on HQ telemetry persistence (stdout only)

Gaps flagged:
  - gap:live-customer-walk-owed
  - gap:hq-telemetry-persistence-not-built (P4 later)
  - gap:journey-station-chains-not-authored (P6)
  - gap:doctor-full-not-built (P8) · required to move any bug to CLOSED

Predicted status transitions on merge (correctly executed): FIXED_UNPROVEN for all four.
NEVER predicted CLOSED (per DECISION-0004 + 0008).
```

## 14. Reviewer sign-off

- **Ship-lens:** PASS · 0 P0/P1 · 2 P2 residuals (documented, scheduled)
- **Human reviewer:** Daniel (awaited on Wave 2 eligibility)
- **Rollback rehearsed:** no (documented only)
- **Merged:** yes @ `cc6784c7`
- **Post-merge Doctor Lite re-run:**
  - graph freshness restored (this file + 3 companions in `lcos/graph/`)
  - no orphan nodes introduced (identity pipeline fully edged)
  - no new invariant violations (INV-006 · 007 · 008 · 010 · 011 all lifted for Wave-1 scope)
  - bug status transitions accepted (4 to `FIXED_UNPROVEN`, 0 to `CLOSED`)

## 15. Bug class + class-elimination progress (DECISION-0011)

| Bug ID | Bug class | Class-elimination pattern applied | Instances eliminated | Class status | Deferred ticket |
|---|---|---|---|---|---|
| BUG-002 | BC-005 + BC-001 | one canonical selector per identity axis (hook.useMe) · priority ladder in hook | 1 (identity ladder) | class-elimination-in-progress | — |
| BUG-003 | BC-002 | one canonical writer for state.handle via services.identity_claim.claim_handle | 1 (identity claim endpoint) | class-elimination-in-progress · legacy retirement scheduled | Wave 2 · retire `POST /me/handle` |
| BUG-011 | BC-005 | data-identity-copy + data-identity-kind attributes at every rung render site | QA-observability shim only | class-elimination-in-progress | — |
| BUG-013 | BC-005 | derivedGreeting useMemo · derived-presentation pattern honouring INV-007 | 1 (greeting selector) | class-elimination-in-progress | — |

Also landed under the same integration branch (not part of the Wave 1 branch but part of this merge sequence):
| Auth hardening | BC-003 | Test-only OTP fixture (no LC_DEV_AUTH_BYPASS) + atomic Session-transaction consume | 1 (desktop_auth.py bypass audit) | class-elimination-in-progress · application audit owed | P4 audit sweep |

## 16. Eight-question auto-answers per DECISION-0010

**BUG-002:**
1. Golden paths blocked: `gap:golden-paths-registry-not-authored`
2. Business capabilities degraded: capability.identity-trust (RED → FIXED_UNPROVEN)
3. Canonical states affected: state.current-user, state.handle, state.lc-id, state.authenticated
4. Journeys that fail: j001, j002, j003 (RED/AMBER → GREEN-unproven)
5. Telemetry that should have detected: `me_snapshot_hydrated` (didn't exist)
6. Tests that should have failed: `TopHud.identity-ladder.test.ts::signed-in-never-guest` (didn't exist)
7. Sibling bugs: BUG-003, BUG-011, BUG-013
8. Permanent architectural fix: BC-005 + BC-001 elimination pattern per §15

**BUG-003, BUG-011, BUG-013:** see bugs.json Wave-1 retrofit (schema_version 1.2.0).

## 17. Provenance record

| File | Origin | Reviewed? | Verdict |
|---|---|---|---|
| `junior-backend/app/routes/desktop_auth.py` (Block A + atomic-consume) | investigated 2026-07-12 · original blocks were uncommitted at `07:42` today, no author attribution, on no branch. Blocks B/C/D violated hard-rule list · Block A matched codebase pattern. | yes · full block-by-block classification in prior audit | Block A kept · B/C/D deleted · atomic-consume added as root-cause fix |
| `junior-backend/tests/test_desktop_auth_hardening.py` | new · authored 2026-07-12 · Claude session | yes · 370/370 pytest green | keep |
| `desktop-2/docs/ship-lens-review.json` | reviewed commit `8d62af6c` verified reachable from integration (38 commits behind HEAD) · Phase-2 finalization audit tied to specific released state | yes · verified frozen scope | keep as-is · do not regenerate against HEAD |
| Wave 1 branch content | worktree agent + gap-closure agent 2026-07-11 → 07-12 · both sessions traced | yes · Wave 1 gap-closure Impact Report `02-gap-closure.md` | keep · merged |

No unknown-provenance files remain in the merge.

---

## Wave 2 eligibility

Per DECISION-0009 barrier requirements:

| Gate | Status |
|---|---|
| Wave 1 landed on `integration/cold-entry-mode-b` | ✅ `cc6784c7` |
| 4 LCOS graphs regenerated | ✅ `dependency.md` · `impact.md` · `repair-priority.md` · `bug-summary.md` |
| Post-merge Impact Report written | ✅ this file |
| Ledger schema evolution locked | ✅ `09_BUG_LEDGER.md` + `bugs.json` @ schema 1.2.0 |
| INV-006..011 locked | ✅ `00B_BUSINESS_INVARIANTS.md` |
| Constitution updated | ✅ `01_CONSTITUTION.md` (dev harness boundary + observability floor) |
| Doctor Lite bug-query contract locked | ✅ `13_DOCTOR/DOCTOR_LITE.md` |
| Impact Report template gained §15-17 | ✅ `IMPACT_REPORT_TEMPLATE.md` |
| Wave Lifecycle gained steps 3.5 + 4.5 | ✅ `WAVE_LIFECYCLE.md` |
| Bug Class Registry citations locked to INV IDs | ✅ `12_BUG_CLASSES.md` |
| Daniel greenlight for Wave 2 dispatch | ⏸ **STOP** |

**STOP before Wave 2 dispatch.** No push. No tag. No deploy. No runtime promotion. No shell rebuild.

Wave 2 rank 1 (per `repair-priority.md`): Cluster 2 · Whop CTA visibility (BUG-004 · BUG-014).
Wave 2 piggyback: Cluster 3 · Tier propagation sweep (BUG-008).

Awaiting your call.
