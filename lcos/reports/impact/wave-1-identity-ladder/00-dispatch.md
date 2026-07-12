# Commit Impact Report · Wave 1 dispatch

**Branch:** `wave-1/identity-ladder`
**Commit SHA:** `<dispatch>` (bookkeeping only · no code)
**Author (LCOS wave owner):** `agent · Wave 1 implementer`
**Cluster:** `cluster-1.identity-ladder`
**Bugs targeted:** `[BUG-002, BUG-003, BUG-011, BUG-013]`
**Time:** `2026-07-12T00:00:00Z`

---

### 1. Files changed

| File | Change type | Owner (LCOS) | Line-range |
|---|---|---|---|
| `lcos/09_BUG_LEDGER.md` | edit (status) | Doctor Lite | Status lines on BUG-002, BUG-003, BUG-011, BUG-013 |
| `lcos/graph/bugs.json` | edit (status) | Doctor Lite | totals + status field + assigned_branch on 4 bugs |
| `lcos/reports/impact/wave-1-identity-ladder/00-dispatch.md` | add | Wave 1 | this file |

### 2. Canonical owner change

**Before:** `state.current-user · owner hook.useMe · writers: [/me route]`
**After:** unchanged (dispatch only · no code yet)
**Duplicate writers removed:** none this commit
**Duplicate writers preserved (with justification):** none · this is a bookkeeping commit; the real duplicate-writer reduction happens in the implementation commit that follows.

### 3. Chain-link updates

| Layer | Before | After | Delta |
|---|---|---|---|
| Mission fingerprint | `[M3]` | `[M3]` | none · bookkeeping |
| Capability | `capability.identity-trust` | same | none |
| Feature | `feature.session-lifecycle · feature.lc-id · feature.handle` | same | none |
| Journey | `j001, j002, j003, j004` | same | none |
| Station | `station.tophud.*, station.identity.*` | same | none |
| Canonical state | `state.current-user, state.handle, state.lc-id` | same | none |

### 4. Journeys affected

| Journey ID | Before | After (predicted) | Verification |
|---|---|---|---|
| `j001-fresh-user-otp-identity` | RED (Guest leak) | RED (unchanged this commit) | live walk in final commit |
| `j002-returning-user` | RED (static greeting) | RED (unchanged this commit) | live walk in final commit |
| `j003-crew-onboarding` | AMBER (no handle claim) | AMBER (unchanged this commit) | live walk in final commit |
| `j004-connect-whop` | RED (Guest leak) | RED (unchanged this commit) | live walk in final commit |

### 5. Golden paths affected

| Path | Impact |
|---|---|
| Signin → Home | not yet touched |

### 6. Business capabilities affected

| Capability | Impact | Mission fingerprint delta |
|---|---|---|
| `capability.identity-trust` | none this commit | none |

### 7. Telemetry

**Topics added or changed:**

None this commit. `me_snapshot_hydrated` + `handle_claimed` land in the implementation commit.

**Topics deleted:** none

### 8. Regression tests

**Added:** none this commit
**Modified:** none this commit
**Deleted:** none

### 9. Risk assessment

- **Risk level:** LOW (bookkeeping only)
- **Blast radius:** none
- **Shell impact:** none
- **Ship-lens P0/P1 predicted:** none this commit
- **Rollback complexity:** LOW · single `git revert`

### 10. Rollback plan

**Pre-commit hash:** `4cb70fb0`
**Rollback command:** `git revert <this sha>` or `git reset --hard 4cb70fb0`
**Data-migration reverse:** none
**Telemetry cleanup on rollback:** none
**Verification after rollback:** `grep "IN_PROGRESS" lcos/graph/bugs.json` returns 0 matches.

### 11. Bug status transitions (post-merge)

| Bug ID | Before | After | Blocks CLOSED on |
|---|---|---|---|
| BUG-002 | OPEN | IN_PROGRESS | test.passes:TopHud.identity-ladder.test.ts + doctor observes non-Guest post-signin + hq event `me_snapshot_hydrated` (all owed to final commit) |
| BUG-003 | OPEN | IN_PROGRESS | backend `/me` returns lc_id · frontend MeSnapshot.lcId populated · claim UI mounts · doctor observes `handle_claimed` (all owed) |
| BUG-011 | OPEN | IN_PROGRESS | `data-identity-copy` attribute + literal string · doctor query returns exact copy |
| BUG-013 | OPEN | IN_PROGRESS | `greeting.personalized.test.ts` passes across 4 tod × 3 auth states |

> **Reminder:** No CLOSED flip from this wave. Ceiling is FIXED_UNPROVEN.

### 12. Live customer walkthrough steps

Deferred to the final commit's report (see wave contract).

### 13. Doctor Lite verdict

Not run this commit (bookkeeping only).

### 14. Reviewer sign-off

- **Ship-lens:** DEFERRED (final commit only)
- **Human reviewer:** pending Daniel
- **Rollback rehearsed:** no
- **Merged:** no

---

## Wave 1 execution plan (documented on dispatch)

1. Backend: extend `MeResponse` with `lc_id` + `handle`; add `POST /me/lc-id/claim` with reserved-word list + `^[a-z0-9_]{3,20}$` regex.
2. Backend test: `test_me_lc_id_claim.py` — 200 / 409 / 422 / 401.
3. Frontend `useMe.ts`: extend `MeSnapshot` + adapter to expose `lcId` + `handle`. Emit `me_snapshot_hydrated`.
4. Frontend `TopHud.tsx`: replace `handleFromEmail(email) ?? 'Guest'` with `handle → lc_id → (hasJwt && pending ? 'Signing in…' : null-render)`. Add `data-identity-copy`. Personalise greeting.
5. Frontend `SplashLeaderboard.tsx`: same ladder + `data-identity-copy`.
6. NEW `ClaimHandleSheet.tsx`: first-run modal reading `useMe()`, POSTs to `/me/lc-id/claim`.
7. `CrewOnboarding.tsx`: mount sheet on `onDone()` if `snapshot.handle == null`.
8. Frontend tests: `TopHud.identity-ladder.test.ts`, `useMe.lc-id.test.ts`, `handle-claim.flow.test.ts`.
9. Update regression tests `TopHud.pill.test.ts` + `TopHud.identity.test.ts` to lock the new ladder in place.
10. Ship-lens pass.
11. Final commit → flip bugs to FIXED_UNPROVEN.
