# Commit Impact Report · Wave 1 · final (implementation)

**Branch:** `wave-1/identity-ladder`
**Base commit:** `4cb70fb0` (dispatched at `275c5686`)
**Commit SHA:** `<final>` (this commit)
**Author (LCOS wave owner):** `agent · Wave 1 implementer`
**Cluster:** `cluster-1.identity-ladder`
**Bugs targeted:** `[BUG-002, BUG-003, BUG-011, BUG-013]`
**Time:** `2026-07-12T00:00:00Z`

---

### 1. Files changed

| File | Change | Owner (LCOS) | Line-range |
|---|---|---|---|
| `junior-backend/app/routes/me.py` | edit | Wave 1 · identity-ladder | +192 · adds `lc_id` + `handle` to `MeResponse`, `_build_me_response()` helper, `POST /me/lc-id/claim` with `_CLAIM_HANDLE_RE` + `_RESERVED_CLAIM_HANDLES` |
| `desktop-2/src/design-os/state/useMe.ts` | edit | Wave 1 | +63 · `MeSnapshot.lcId` + `MeSnapshot.handle`, adapter snake→camel, `emitHydratedTelemetry()` helper, wired on real-http + session-cache transitions |
| `desktop-2/src/design-os/components/TopHud.tsx` | edit | Wave 1 | +150 -30 · `identityLadder` useMemo, `derivedGreeting` useMemo, `data-identity-copy` + `data-identity-kind` attributes on 3 render sites, `handleFromEmail` removed |
| `desktop-2/src/overlays/invaders/SplashLeaderboard.tsx` | edit | Wave 1 | +82 -20 · mirror ladder derivation, `YouCallout` accepts `identityKind`, `data-identity-copy` on identity string |
| `desktop-2/src/design-os/onboarding/ClaimHandleSheet.tsx` | add | Wave 1 | +335 · first-run modal, self-guards on `lcId !== null && handle === null`, mirrors backend regex + reserved-word list, POSTs `/me/lc-id/claim`, emits `handle_claimed`, optimistic `useMe().reload()` |
| `desktop-2/src/routes/crew-onboarding/CrewOnboarding.tsx` | edit | Wave 1 | +55 -4 · `advanceToHome()` opens the sheet when needed, mounts `<ClaimHandleSheet>` at end of render tree |
| `desktop-2/src/design-os/components/TopHud.pill.test.ts` | edit | Wave 1 | +30 -13 · updated regression to lock ladder shape (was locking the old `"Guest"` fallback) |
| `desktop-2/src/design-os/components/TopHud.identity.test.ts` | edit | Wave 1 | +7 -3 · agency copy assertion updated to `identityLadder.handle` |
| `desktop-2/src/design-os/components/TopHud.identity-ladder.test.ts` | add | Wave 1 | +163 · new — 11 assertions covering priority, `data-identity-copy`, no-Guest, no-Signing-in-in-greeting |
| `desktop-2/src/design-os/state/useMe.lc-id.test.ts` | add | Wave 1 | +132 · new — 10 assertions covering type + adapter + telemetry payload + ordering |
| `desktop-2/src/design-os/onboarding/handle-claim.flow.test.ts` | add | Wave 1 | +171 · new — 13 assertions covering guards + validation mirror + POST + telemetry + 409/422 UX |
| `junior-backend/tests/test_me_lc_id_claim.py` | add | Wave 1 | +275 · new — 15 backend assertions covering 200/409/422/401 + case-insensitive collision + reclaim-own idempotency + normalisation |
| `lcos/09_BUG_LEDGER.md` | edit | Wave 1 | 4 bug rows flipped to `FIXED_UNPROVEN` with wave-specific notes |
| `lcos/graph/bugs.json` | edit | Wave 1 | 4 status transitions + totals updated (in_progress 4 → 0, fixed_unproven 0 → 4) |
| `lcos/reports/impact/wave-1-identity-ladder/01-final.md` | add | Wave 1 | this file |

### 2. Canonical owner change

**Before (base `4cb70fb0`):**
- `state.current-user` · owner `hook.useMe` · writers `[endpoint.GET_me]` (read-only writer surface)
- `state.handle` · owner `hook.useMe` · writers `[endpoint.POST_me_handle (handle.py)]` — one writer, but never surfaced anywhere in the desktop
- `state.lc-id` · owner `hook.useMe` · writers `[endpoint.mint_lc_id (lc_ids.py, Whop webhook side-effect)]` — one writer, invisible in the desktop

**After (this commit):**
- `state.current-user` · owner `hook.useMe` · writers unchanged — the shape now carries `lc_id` + `handle` fields but the writer set is the same
- `state.handle` · owner `hook.useMe` · writers `[endpoint.POST_me_handle (handle.py) · endpoint.POST_me_lc_id_claim (me.py)]` — **two writers of the same column** (see #2a)
- `state.lc-id` · owner `hook.useMe` · writers unchanged — the LC-ID is now READ by the desktop but Wave 1 does not add a mint writer

**Duplicate writers removed:** none.
**Duplicate writers preserved (with justification):**

- `state.handle` has two writers (`/me/handle` legacy + `/me/lc-id/claim` new). This is documented explicitly in the code comment at `junior-backend/app/routes/me.py::/me/lc-id/claim` block and again here. **This is NOT synchronisation** (the wave contract's STOP trigger). Neither endpoint pings the other; neither is aligned by a job / mirror table / scheduled sync. Both write directly to `users.handle` and both use case-insensitive uniqueness against the `LOWER(handle)` unique index. Ownership matrix says one canonical writer per state; Wave 1's commissioned scope adds the new writer and marks the legacy one for reduction in a follow-up wave when `desktop-2/src/design-os/earn/AffiliateWidget.tsx` migrates from `PATCH /me/handle` to `POST /me/lc-id/claim` (out of the file-ownership matrix for Wave 1). Read-side has no drift: both writers write to the same column, both readers read via `GET /me`.

> **Wave contract compliance:** Section 2 shows preservation of a documented duplicate writer with an explicit reduction plan. It does NOT show synchronisation. No STOP trigger. See DECISION-0009.

### 3. Chain-link updates

| Layer | Before | After | Delta |
|---|---|---|---|
| Mission fingerprint | `[M1, M3, M4]` on affected bugs | same | no mission change; identity ladder addresses M3 (Trust) |
| Capability | `capability.identity-trust` | same | one capability continues to own the state; no new capability introduced |
| Feature | `feature.session-lifecycle · feature.lc-id · feature.handle` | `feature.session-lifecycle · feature.lc-id (READ SURFACE ADDED) · feature.handle (CLAIM SURFACE ADDED)` | two features expanded to include desktop-surface reads/claims |
| Journey | `j001, j002, j003, j004` | same | no new journey introduced; existing journeys unblocked pending live walk |
| Station | `station.tophud.identity-pill · station.tophud.avatar-name · station.tophud.greeting-eyebrow · station.identity.claim-handle (missing) · station.identity.confirm-lc-id (missing)` | previous stations retained + `station.identity.claim-handle` shipped as `ClaimHandleSheet` + `station.identity.confirm-lc-id` shipped as the LC-ID anchor inside the sheet | two new stations added by the sheet |
| Canonical state | `state.current-user · state.handle · state.lc-id` | same shape, but `state.handle` gains a new writer (see §2) | duplicate-writer note per §2 |

### 4. Journeys affected

| Journey ID | Before | After (predicted) | Verification method |
|---|---|---|---|
| `j001-fresh-user-otp-identity` | RED (Guest leak · static greeting) | GREEN pending live walk · ladder renders `Signing in…` during hydration then `@handle` / `LC-XXXX` | Section 12 live walk |
| `j002-returning-user` | RED (static greeting · Guest leak) | GREEN pending live walk · personalised `Good {tod}, @handle` | Section 12 live walk |
| `j003-crew-onboarding` | AMBER (no handle claim) | GREEN pending live walk · sheet mounts on completion | Section 12 live walk |
| `j004-connect-whop` | RED (Guest leak) | GREEN pending live walk · ladder resolves regardless of Whop link state | Section 12 live walk |

### 5. Golden paths affected

| Path | Impact |
|---|---|
| Signin → Home | Identity strip now honest across hydration; greeting personalised. |
| Signin → Crew → Home | Handle claim sheet inserts between crew completion and Home; dismissable. |

### 6. Business capabilities affected

| Capability | Impact | Mission fingerprint delta |
|---|---|---|
| `capability.identity-trust` | RED → GREEN pending live walk. Ladder + first-run claim close BUG-002/003/011/013. | none — same M3 anchor. |

### 7. Telemetry

**Topics added or changed:**

| Topic | Payload | Consumer | Persistence |
|---|---|---|---|
| `me_snapshot_hydrated` | `{ source: 'real-http'\|'session-cache', hasLcId: boolean, hasHandle: boolean }` | HQ diagnostic rail | stdout batching (HQ persistence deferred to Wave 5) |
| `handle_claimed` | `{ lc_id: string, handle: string, ts_ms: number }` | HQ diagnostic rail | stdout batching (HQ persistence deferred) |

Both routed through the existing `lcDiag()` → `/telemetry/diagnostic` rail. No new backend endpoints. Payloads intentionally boolean/string-only so no PII (email / whop-id) leaks.

**Topics deleted:** none.

### 8. Regression tests

**Added:**

| Test ID | File | Protects |
|---|---|---|
| `TopHud.identity-ladder.test.ts::11 assertions` | `desktop-2/src/design-os/components/TopHud.identity-ladder.test.ts` | ladder shape, priority, `data-identity-copy` attribute, no-Guest, no-Signing-in-in-greeting; mirrors SplashLeaderboard |
| `useMe.lc-id.test.ts::10 assertions` | `desktop-2/src/design-os/state/useMe.lc-id.test.ts` | MeSnapshot type extension, snake→camel adapter, telemetry payload + ordering |
| `handle-claim.flow.test.ts::13 assertions` | `desktop-2/src/design-os/onboarding/handle-claim.flow.test.ts` | client/server validation mirror, POST body, telemetry, 409/422 UX copy, Escape dismissal |
| `test_me_lc_id_claim.py::15 assertions` | `junior-backend/tests/test_me_lc_id_claim.py` | 200/409/422/401, case-insensitive collision, reclaim-own idempotency, normalisation |

**Modified:**

| Test ID | Reason |
|---|---|
| `TopHud.pill.test.ts` | Old regression asserted `handleFromEmail ? ... : "Guest"` shape — Wave 1 rewrote to lock the ladder shape instead. Old assertion would false-positive as a "regression" once ladder shipped. |
| `TopHud.identity.test.ts` | Agency copy assertion changed from `@${handleFromEmail}` to `@${identityLadder.handle}` per new derivation. |

**Deleted:** none.

### 9. Risk assessment

- **Risk level:** MEDIUM
- **Blast radius:** TopHud + SplashLeaderboard (every route in the app renders TopHud); backend `/me` endpoint (called on boot + on auth events); crew onboarding tail.
- **Shell impact:** NONE. No `src-tauri/`, `Cargo.toml`, `tauri.conf.json`, `package.json`, `python-sidecar/` touched. Verified by pre-commit inspection.
- **Ship-lens P0/P1 predicted:** none. Two P2 findings documented in Wave 1 (see §14).
- **Rollback complexity:** LOW. Pure git revert restores prior behaviour on both frontend and backend. No data migration (the `users.lc_id` + `users.handle` columns already existed at base commit).

### 10. Rollback plan

**Pre-commit hash:** `275c5686` (dispatch bookkeeping) → parent of this commit.
**Rollback command:** `git revert <this-sha>` restores the frontend + backend to the state where BUG-002/003/011/013 are IN_PROGRESS. A second `git revert 275c5686` restores them to OPEN.
**Data-migration reverse:** none. The `lc_id` + `handle` columns existed on `users` before Wave 1 (per `models.py:221, 258`). No alembic migration written by this wave — none was needed.
**Telemetry cleanup on rollback:** the two topics (`me_snapshot_hydrated` + `handle_claimed`) will simply stop firing. HQ consumers are stdout-batching, so no persistence cleanup required.
**Verification after rollback:** `grep -c FIXED_UNPROVEN lcos/graph/bugs.json` returns 0 after revert; frontend + backend tests still green.

### 11. Bug status transitions (post-merge)

| Bug ID | Before | After | Blocks CLOSED on |
|---|---|---|---|
| BUG-002 | IN_PROGRESS | FIXED_UNPROVEN | `test.passes:TopHud.identity-ladder.test.ts::signed-in-never-guest` (green) · live walk of `j001` on promoted bundle · HQ observes `me_snapshot_hydrated` within 2s of `auth:signed-in` |
| BUG-003 | IN_PROGRESS | FIXED_UNPROVEN | backend `/me` returns `lc_id` (green in test) · frontend `MeSnapshot.lcId` populated (green in test) · first-run claim UI mounts on first signed-in Home visit (live walk owed) · HQ observes `handle_claimed` on a real session |
| BUG-011 | IN_PROGRESS | FIXED_UNPROVEN | `data-identity-copy` attribute present on avatar-name, greeting-name, identity-pill (verified via grep in `TopHud.identity-ladder.test.ts`) · Doctor query returns exact string on inspection of the promoted bundle |
| BUG-013 | IN_PROGRESS | FIXED_UNPROVEN | greeting-personalisation grep tests green · 4-tod × 3-auth live walk on promoted bundle owed |

> **Reminder:** No bug flips to CLOSED in this Impact Report. Only Doctor Full may CLOSED · after scanners.

### 12. Live customer walkthrough steps (for FIXED_UNPROVEN → CLOSED prep)

Ordered steps a human tester runs on a freshly-installed bundle:

1. Sign out (if signed in) via the avatar menu → verify WelcomeGate remounts.
2. Fresh sign-in via OTP → observe TopHud immediately after `auth:signed-in`:
   - Expected during hydration (`me.source === "unknown"` while `hasJwt`): `[data-identity-copy="Signing in…"]` on both greeting-name and avatar-name; `[data-identity-kind="pending"]`.
   - Expected after hydration (`real-http`): `[data-identity-copy]` contains either `@<handle>` (if the user has one) or `LC-XXXXXX` (fallback); `[data-identity-kind]` is `"handle"` or `"lc-id"`.
   - Expected NEVER: the literal string `"Guest"` inside `[data-identity-copy]`.
3. Verify the greeting eyebrow reads `Good {morning|afternoon|evening}` and, when a handle/LC-ID is available, extends to `Good {tod}, @handle` or `Good {tod}, LC-XXXXXX`. NEVER `"Good evening ✦"` static.
4. If the customer has no handle claimed, complete the Crew onboarding flow (any exit path — sent invitations / empty state / denied Google). Verify `ClaimHandleSheet` mounts after crew completion.
5. Type a valid handle (e.g. `daniel_`) → click "Claim @daniel_" → verify:
   - TopHud + SplashLeaderboard identity copy flips to `@daniel_` on the SAME React tick as the sheet closes.
   - Greeting eyebrow updates to `Good {tod}, @daniel_`.
6. Type an invalid handle (e.g. `admin`, `hello world`) → verify inline error copy appears and the "Claim" button stays disabled.
7. Type a taken handle (seed another user with `handle="alreadytaken"` server-side) → submit → verify 409 branch shows "Handle already taken · pick another." error copy.
8. Reload the app (Cmd+R or hard refresh) · verify handle persists and TopHud reads it from `session-cache` before the network round-trip completes.
9. Verify HQ telemetry:
   - `me_snapshot_hydrated` should arrive multiple times (once per hydration source transition; expect at least one `source: "real-http"`).
   - `handle_claimed` should arrive exactly once per successful claim, with payload `{ lc_id, handle, ts_ms }`.
10. Sign out → sign in with a DIFFERENT account that already has a handle → verify no `ClaimHandleSheet` appears (guard: `handle !== null`).

### 13. Doctor Lite verdict

Doctor Lite has not been re-run against this commit (Wave 1 implementer is the sub-agent; the parent Doctor Lite invocation is queued for post-review). The wave contract routes Doctor Lite regeneration through a separate pass.

### 14. Reviewer sign-off

- **Ship-lens verdict:** PASS with 2 P2 findings.
  - **P2 (1):** State 3 (hydrated · both `handle` and `lcId` null) renders no name in the avatar strip. Honest but a signed-in user with no ladder data sees a nameless strip and no in-app path to fix it. Accepted per Wave 1 scope — LC-ID mint is a Whop webhook side-effect + `/lc-ids/mint-for-user` endpoint outside this cluster's ownership matrix.
  - **P2 (2):** `ClaimHandleSheet.tsx` submit-button label continues rendering the raw input as `Claim @hello world` while it's invalid. Cosmetic; local error copy overrides the button semantics correctly.
- **Human reviewer:** pending Daniel.
- **Rollback rehearsed:** no (deferred to human review).
- **Merged:** no. Wave contract forbids merge into `integration/cold-entry-mode-b` — the branch stays local for Daniel to review.

---

## Appendix A · Test evidence

- Frontend (vitest run) — **all 308 tests pass** (35 test files), including:
  - `TopHud.identity-ladder.test.ts` · 11/11 green (new)
  - `useMe.lc-id.test.ts` · 10/10 green (new)
  - `handle-claim.flow.test.ts` · 13/13 green (new)
  - `TopHud.pill.test.ts` · 6/6 green (modified)
  - `TopHud.identity.test.ts` · 10/10 green (modified)
  - `useMe.test.ts` · 4/4 green (regression)
  - `useAuth.test.ts` · 6/6 green (regression)
- Backend (pytest tests/) — **all 312 tests pass**, including:
  - `test_me_lc_id_claim.py` · 15/15 green (new)
- TypeScript (tsc --noEmit) — **clean**.

## Appendix B · Ship-lens output (Phase 1 · 2 · 3)

See conversation transcript for full phase output. Summary:

- **Phase 1 (DESIGN):** PASS. Every interactive element on the touched surfaces tags to at least one of O / N / S. Cut list empty.
- **Phase 2 (STATE):** PASS with 2 P2 findings + 1 documented residual duplicate writer. 8 distinct data shapes enumerated; every render path handles every shape either with a fallback or an explicit null-render.
- **Phase 3 (JOURNEY):** PASS. Signed-in user hits Home · Crew onboarding completes with no handle · 401 during claim — walked. No strand.
- **Real-data walk:** DEFERRED to Section 12 per wave contract (ceiling is FIXED_UNPROVEN — the walk-owed state).

## Appendix C · Constraint compliance

- ✅ Base HEAD verified `4cb70fb0` before first commit (dispatch at `275c5686` off that base).
- ✅ Branch `wave-1/identity-ladder` (created via `git checkout -b wave-1/identity-ladder 4cb70fb0`).
- ✅ No forbidden files touched: `src-tauri/**` untouched · `Cargo.toml` untouched · `tauri.conf.json` untouched · `package.json` untouched · `python-sidecar/**` untouched.
- ✅ No new npm deps (verified: `package.json` untouched).
- ✅ No new Python deps (verified: `requirements.txt` untouched — only stdlib `re` + existing FastAPI + SQLAlchemy imports used).
- ✅ No CLOSED transitions. Ceiling FIXED_UNPROVEN.
- ✅ No cross-cluster work. Wave 2/3/4/5 bugs untouched.
- ✅ No push, no tag, no release. Local worktree only.
