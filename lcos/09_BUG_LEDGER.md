# 09 · Bug Ledger

**No bug exists only in conversation.** Every bug lives here.

DECISION-0004 · Anthropic never closes a bug. Only proof closes a bug.

---

## Business consequence scale (locked · 2026-07-12)

For each dimension, use only these five weights:

### Revenue
| Weight | Meaning |
|---|---|
| NONE | no commercial impact |
| LOW | minor friction, no blocked transaction |
| MEDIUM | reduces conversion or delays activation |
| HIGH | blocks a money journey for some users |
| CRITICAL | blocks core revenue or creates incorrect financial activity |

### Trust
| Weight | Meaning |
|---|---|
| NONE | invisible to customer |
| LOW | cosmetic inconsistency |
| MEDIUM | confusing or looks unfinished |
| HIGH | customer sees contradictory or false state |
| CRITICAL | fake money, fake success, security or identity failure |

### Support
| Weight | Meaning |
|---|---|
| NONE | no likely support impact |
| LOW | isolated question |
| MEDIUM | repeatable tickets |
| HIGH | common customer journey requires manual intervention |
| CRITICAL | support cannot recover the user safely |

### Conversion
| Weight | Meaning |
|---|---|
| NONE | unrelated |
| LOW | slight friction |
| MEDIUM | meaningful drop-off risk |
| HIGH | blocks onboarding/activation/upgrade |
| CRITICAL | prevents the primary customer outcome |

---

## Composite severity (locked)

**P0** — any of:
- security / privacy risk
- false financial action
- production fixture submission
- core golden path blocked
- authenticated identity fundamentally wrong
- data corruption or unrecoverable customer state

**P1** — any of:
- major visible journey broken
- money or activation journey blocked with workaround
- inconsistent canonical state causing repeated customer errors
- HQ blind to a critical failure

**P2** — any of:
- degraded but recoverable
- cosmetic truth drift
- missing telemetry where the customer journey still works
- stale or low-risk internal inconsistency

**Severity is NOT inflated because a capability is marked critical.** Severity combines: customer reach × journey blockage × business consequence × recoverability × confidence.

---

## Status ladder (locked)

- `OPEN` — root cause suspected, no fix landed
- `IN_PROGRESS` — fix branch open, not merged
- `FIXED_UNPROVEN` — code merged + tested, but at least one of {runtime bundle promoted, live customer journey proven, HQ telemetry match, customer UI verified} not done
- `CLOSED` — every closes-only-when assertion is green. Doctor verified. Human confirmed.

---

## Row schema (every field required · no exceptions)

```
BUG-XXX · <one-line symptom>

Category:                       <1..6>
Owner system:                   <capability.id>
Mission:                        [M1..M4]

Customer symptom:               <what the user sees>
Status:                         <OPEN | IN_PROGRESS | FIXED_UNPROVEN | CLOSED>
Fixed-unproven notes:           <what's shipped vs what's not proven>

Technical root cause:           <mechanism>  · confidence <0..1>
Business root cause:            <product decision or missing piece>  · confidence <0..1>

Bug class:                      <BC-XXX from lcos/12_BUG_CLASSES.md>          # DECISION-0011
Class-elimination pattern:      <canonical fix from BC entry · or 'symptom-only + deferred ticket'>

Affected capabilities:          [...]
Affected journeys:              [...]
Affected stations:              [...]

Golden paths blocked:           [golden-path.id, ...] or 'gap:golden-paths-registry-not-authored'  # DECISION-0010 · Q1
Telemetry that should have detected: [topic, ...] or 'gap:telemetry-topic-missing'                 # DECISION-0010 · Q5

Canonical source of truth:      <state.id | endpoint.id>

Files & lines:                  [file:line, ...]

Business consequence:
  Revenue     <NONE|LOW|MEDIUM|HIGH|CRITICAL>
  Trust       <NONE|LOW|MEDIUM|HIGH|CRITICAL>
  Support     <NONE|LOW|MEDIUM|HIGH|CRITICAL>
  Conversion  <NONE|LOW|MEDIUM|HIGH|CRITICAL>
Confidence business consequence: <0..1>

Composite severity:             <P0 | P1 | P2>

Sibling bugs by root cause:     [BUG-YYY, ...]         # DECISION-0010 · Q7 (same bug_class + same canonical state OR same cluster)
Related bug ids:                [BUG-YYY, ...]         # any other relationship (dependency, sequencing)
Decision ids:                   [DECISION-XXXX, ...]
Invariant ids:                  [INV-XXX, ...]

Shell impact:                   <none | runtime | native>
Introduced or discovered at commit: <sha | 'pre-thread'>
Last verified commit:           <sha>
Recurrence count:               <n>

Permanent architectural fix:    <cite class-elimination pattern from 12_BUG_CLASSES.md + specifics>   # DECISION-0010 · Q8
Regression test:                <test.id or 'to-be-authored'>
Tests that should have failed:  [test.id, ...] or 'gap:test-not-authored'                             # DECISION-0010 · Q6
Closes only when:               [assertion, ...]
Latest evidence:                <what we know today>

Transition proofs (INV-011):
  Telemetry event(s):           [topic, ...] or 'gap'
  Regression coverage:          [test.id, ...] or 'gap'
  Journey step(s):              [journey.station, ...] or 'gap'
  Owning station:               <station.id> or 'gap'

Next action:                    <one sentence>
Dependencies:                   [BUG-YYY, ...]
Assigned branch:                <branch | unassigned>
Assigned wave:                  <1 | 2 | 3 | 4 | 5 | 6 | later>
```

### Schema evolution notes (2026-07-12)

- **Added:** `Bug class`, `Class-elimination pattern`, `Golden paths blocked`, `Telemetry that should have detected`, `Sibling bugs by root cause`, `Tests that should have failed`, `Transition proofs (INV-011)`, `Permanent architectural fix` (replaces older "Permanent fix (proposed)" · same slot, stricter framing).
- **Rule:** Doctor Lite refuses to answer a bug query if any of these fields is empty AND not marked `gap:*`. Cited gaps are honest; empty fields are not.
- **Retrofit scope:** Wave-1 rows (BUG-002 · BUG-003 · BUG-011 · BUG-013) filled fully by the 2026-07-12 post-merge sweep. Rows outside Wave 1 remain marked `audit-owed` per new-field until the P4 audit sweep. Doctor Lite may not draft plans against `audit-owed` rows without flagging them.

---

## Groupings

**Category 1 · Identity and trust:** BUG-002, BUG-003, BUG-011, BUG-013 (4)
**Category 2 · Monetisation and Whop:** BUG-004, BUG-008, BUG-014 (3)
**Category 3 · Runtime and updates:** BUG-006, BUG-007, BUG-009, BUG-012 (4)
**Category 4 · Navigation and performance:** BUG-010 (1)
**Category 5 · Observability and HQ:** BUG-001, BUG-005 (2)
**Category 6 · Product truth and fixtures:** — (empty · covered by category 2 for tier fallbacks, category 5 for notification drift)

---

# Category 1 · Identity and trust

## BUG-002 · Authenticated user shows "Guest · Admin" in avatar

- **Category:** 1 · Identity and trust
- **Owner system:** `capability.identity-trust`
- **Mission:** M3 (Trust)

**Customer symptom:** Signed-in admin's TopHud avatar renders `GUEST` name over `ADMIN` tier at the same time. `Good evening ✦` greeting reads to any auth state.

**Status:** FIXED_UNPROVEN
**Assigned branch (wave-1 dispatch):** `wave-1/identity-ladder`
**Fixed-unproven notes:** Wave 1 (2026-07-12) landed the identity ladder — `handle → lc_id → 'Signing in…' → null` — in `TopHud.tsx` (greeting eyebrow + greeting name slot + avatar name slot) AND `SplashLeaderboard.tsx` (YouCallout). Neither surface renders the literal `"Guest"` for a JWT-holding user anymore. `data-identity-copy` + `data-identity-kind` attributes expose the exact copy for QA. Regression + new test suites green. UNPROVEN because: (a) no live customer walk of `j001` post-OTP has been executed on the promoted bundle; (b) HQ has not yet observed the `me_snapshot_hydrated` topic land against a real session; (c) ship-lens live walk is deferred to Section 12 of the final Impact Report per wave contract. **Wave 1 gap-closure (2026-07-12) extended the ladder to a deterministic 5-rung shape (handle → lc_id → email-local → 'Signing in…' → 'Complete profile') and made the rung-5 CTA actionable via `identity:open-claim-sheet` bus event + shell-level `ClaimHandleSheetHost`. Backend live-walk on local SQLite verified: canonical `handle_write source=lc-id-claim` fires once per claim; the pre-existing `POST /me/handle` no longer contains independent write logic — it delegates to `app.services.identity_claim.claim_handle`.**

**Technical root cause:** `TopHud.tsx:205-211` — `handleFromEmail` returns null when `me.snapshot?.email` is null; render falls to hardcoded `"Guest"` string. Meanwhile `useTierCaps().platformRole === "admin"` populated from session cache, so tier chip shows `Admin` on the same tick. Two hooks, two hydration timings, one visible strip.  · confidence 0.95

**Business root cause:** No identity ladder was ever specified. Product decision to have LC-ID as public identifier (schema present) never landed in UI. No "Signing in…" transitional state. No first-run handle claim.  · confidence 0.90

**Affected capabilities:** `capability.identity-trust`, `capability.affiliate-revenue`
**Affected journeys:** `j001-fresh-user-otp-identity`, `j002-returning-user`, `j004-connect-whop`
**Affected stations:** `station.tophud.identity-pill`, `station.tophud.avatar-name`

**Canonical source of truth:** `state.current-user` (owner `hook.useMe`) + `state.authenticated` (owner `hook.useAuth`)

**Files & lines:**
- `desktop-2/src/design-os/components/TopHud.tsx:205, 377, 560`
- `desktop-2/src/design-os/state/useMe.ts:80-92`
- `junior-backend/app/models.py:258` (lc_id column present · unread)

**Business consequence:**
- Revenue: MEDIUM
- Trust: HIGH
- Support: HIGH
- Conversion: LOW
Confidence business consequence: 0.75

**Composite severity:** P0 (authenticated identity fundamentally wrong)

**Related bug ids:** BUG-003, BUG-011, BUG-013
**Sibling bugs by root cause:** BUG-003, BUG-011, BUG-013 (all Cluster 1 · shared root cause: identity ladder had no canonical source)
**Decision ids:** DECISION-0002, DECISION-0010, DECISION-0011
**Invariant ids:** INV-001, INV-006, INV-007, INV-010, INV-011

**Bug class:** BC-005 (UI reading divergent stores) + BC-001 (multi-writer state · `handleFromEmail` derived value competed with `useMe.snapshot.email` timing)
**Class-elimination pattern:** Reduce to one canonical selector per identity axis; priority ladder lives inside `hook.useMe`, never in consumers. Applied in wave-1 merge `cc6784c7`.

**Golden paths blocked:**
- gap:golden-paths-registry-not-authored (P4 owed)
- Journey-level: `j001-fresh-user-otp-identity` RED before Wave 1 · GREEN-unproven after (blocked on Doctor Full)

**Telemetry that should have detected:** `me_snapshot_hydrated` (topic did not exist pre-Wave-1 · added as part of the fix, which is itself why the bug was invisible in HQ)

**Tests that should have failed:**
- `TopHud.identity-ladder.test.ts::signed-in-never-guest` (didn't exist pre-Wave-1)
- `TopHud.identity-ladder.test.ts::rung 4 · jwt-present-me-loading` (didn't exist pre-Wave-1)

**Shell impact:** none
**Introduced or discovered at commit:** pre-thread (visible on `2.2.36-state-drift-fixed` = `e4ff1060`)
**Last verified commit:** e4ff1060 (still reproducing)
**Recurrence count:** 1

**Permanent architectural fix:** Class-elimination pattern for BC-005 · one canonical selector per identity axis (`hook.useMe`). 5-rung ladder locked in the hook: `handle → LC-ID → email local-part → "Signing in…" → "Complete profile"` (rung 5 is actionable · opens ClaimHandleSheet via `identity:open-claim-sheet` bus event). Never `"Guest"` when `hasJwt` is true. Never blank when authenticated. Backend: `MeResponse` returns `lc_id` + `handle` via canonical `services.identity_claim.claim_handle`. Frontend: `MeSnapshot` extends with `lcId` + `handle`. TopHud + SplashLeaderboard read the same selector. Loading state renders "Signing in…" while `me.source === "pending"` AND `hasJwt`.

**Transition proofs (INV-011):**
- Telemetry event: `me_snapshot_hydrated`
- Regression coverage: `TopHud.identity-ladder.test.ts` (5 assertions) · `SplashLeaderboard.test.ts` (3 mirror assertions)
- Journey step: `gap:j001-station-chain-not-authored` (P6 owed)
- Owning station: `gap:station.tophud.identity-pill` not yet in registry (P6 owed)

**Regression test:** `TopHud.identity-ladder.test.ts::signed-in-never-guest` (to-be-authored)

**Closes only when:**
1. `test.passes:TopHud.identity-ladder.test.ts::signed-in-never-guest`
2. `test.passes:TopHud.identity-ladder.test.ts::signing-in-during-hydration`
3. `test.passes:TopHud.identity-ladder.test.ts::rung 5 · jwt-present-hydrated-empty` (gap-closure)
4. `test.passes:SplashLeaderboard.test.ts::rung 5 · hydrated-empty` (gap-closure)
5. Doctor observes: on `j001` post-OTP, avatar text ∈ {`@handle`, `LC-XXXX`, email local-part, `Signing in…`, `Complete profile`} — never `"Guest"`
6. HQ telemetry: `me_snapshot_hydrated` fires within 2s of `auth:signed-in` in live run
7. HQ telemetry: `complete_profile_cta_clicked` observed when rung-5 CTA rendered (gap-closure)

**Latest evidence:** Daniel's screenshot 2026-07-11 15:38 · `GUEST · ADMIN` visible in avatar with menu open · `Good evening ✦` greeting static.

**Next action:** Wave 1 Agent 1 (Identity/account truth) — implement backend `lc_id` + `handle` fields, frontend ladder, first-run claim UI.

**Dependencies:** BUG-003 (handle/LC-ID must exist first for the ladder to have anything to render)
**Assigned branch:** unassigned
**Assigned wave:** 1

---

## BUG-003 · No handle claim path · no LC-ID visible surface

- **Category:** 1 · Identity and trust
- **Owner system:** `capability.identity-trust`
- **Mission:** M1, M3

**Customer symptom:** User has no first-run way to claim a public handle. LC-ID exists in the database but is invisible everywhere in the app. Support cannot reference "your LC-ID is …".

**Status:** FIXED_UNPROVEN
**Assigned branch (wave-1 dispatch):** `wave-1/identity-ladder`
**Fixed-unproven notes:** Wave 1 (2026-07-12) landed: (a) backend `MeResponse.lc_id` + `MeResponse.handle` projection in `junior-backend/app/routes/me.py`; (b) `POST /me/lc-id/claim` endpoint with `^[a-z0-9_]{3,20}$` regex + reserved-word list + case-insensitive uniqueness (200/409/422/401 covered by 15 backend tests); (c) `MeSnapshot.lcId` + `MeSnapshot.handle` in `desktop-2/src/design-os/state/useMe.ts` with `me_snapshot_hydrated` telemetry; (d) new `ClaimHandleSheet.tsx` first-run modal reading `useMe()`; (e) `CrewOnboarding.tsx` mounts the sheet on completion when `handle == null && lcId != null`. UNPROVEN because: (i) no live customer walk has invoked the claim flow end-to-end on the promoted bundle; (ii) HQ has not yet observed a real `handle_claimed` telemetry event; (iii) the "later nudge for un-claimed users" is out of scope for Wave 1. **Wave 1 gap-closure (2026-07-12): extracted `app.services.identity_claim.claim_handle` as the single canonical `users.handle` writer; both `POST /me/lc-id/claim` and legacy `POST /me/handle` now delegate to it. `AffiliateWidget.tsx` migrated to the canonical endpoint. New test `test_identity_claim_service.py` proves no divergence between the two routes and asserts `X-Deprecation` header + backend `handle_write source=<canonical|legacy>` telemetry.**

**Technical root cause:** `users.lc_id VARCHAR(20)` column exists (`models.py:258`) — no endpoint mints or reads it. `PATCH /me/handle` handler exists in `AffiliateWidget.tsx:113` but only reachable via Settings/Wallet → AffiliateWidget. First-run claim prompt doesn't exist. `MeBackendResponse` schema omits `lc_id`.  · confidence 0.95

**Business root cause:** Product decision (schema evidence) to have LC-ID as stable public identifier was made but never landed in UI. Handle claim buried in a secondary surface most users never reach.  · confidence 0.70

**Affected capabilities:** `capability.identity-trust`
**Affected journeys:** `j001-fresh-user-otp-identity`, `j003-crew-onboarding`
**Affected stations:** future `station.identity.claim-handle`, future `station.identity.confirm-lc-id`

**Canonical source of truth:** `state.handle`, `state.lc-id` (both owner `hook.useMe`)

**Files & lines:**
- `junior-backend/app/routes/me.py` (needs lc_id return)
- `junior-backend/app/models.py:258`
- `desktop-2/src/design-os/state/useMe.ts` (needs new fields)
- `desktop-2/src/design-os/earn/AffiliateWidget.tsx:109-113`

**Business consequence:**
- Revenue: MEDIUM
- Trust: HIGH (missing identity anchor causes BUG-002)
- Support: MEDIUM
- Conversion: LOW
Confidence business consequence: 0.65

**Composite severity:** P1 (elevated to P0 if you consider it upstream of BUG-002; kept as P1 because it is a missing feature, not a broken one)

**Related bug ids:** BUG-002, BUG-013
**Sibling bugs by root cause:** BUG-002, BUG-011, BUG-013 (Cluster 1)
**Decision ids:** DECISION-0010, DECISION-0011 (identity is the seed instance of BC-002)
**Invariant ids:** INV-001, INV-006, INV-011

**Bug class:** BC-002 (multi-source-of-truth · handle absent from `MeResponse` while `users.lc_id` column existed and was never surfaced)
**Class-elimination pattern:** Extract single canonical writer `services.identity_claim.claim_handle`; both `POST /me/lc-id/claim` (primary) and `POST /me/handle` (deprecated alias · `X-Deprecation` header + warn log) delegate. AffiliateWidget migrated. Legacy route retirement scheduled for Wave 2.

**Golden paths blocked:** gap:golden-paths-registry-not-authored (P4 owed) · journey-level: `j001-fresh-user-otp-identity` claim-ceremony station was missing entirely before Wave 1.

**Telemetry that should have detected:** `handle_claimed` + `claim_sheet_opened` + backend `handle_write source=<lc-id-claim|legacy-handle-alias>` (all new topics introduced by the Wave 1 fix — this bug was invisible because the observability didn't exist).

**Tests that should have failed:**
- `test_me_lc_id_claim.py` (didn't exist pre-Wave-1)
- `test_identity_claim_service.py::divergence_proof` (didn't exist pre-Wave-1)
- `handle-claim.flow.test.ts::valid-handle-submits` (didn't exist pre-Wave-1)

**Shell impact:** none
**Introduced or discovered at commit:** pre-thread
**Last verified commit:** e4ff1060
**Recurrence count:** 1

**Permanent fix (proposed):** Same branch as BUG-002. Backend: `MeBackendResponse` includes `lc_id` + `handle`. `POST /me/lc-id/claim` mints if null. Frontend: `useMe` adapter reads both. First-run "Claim your handle" bottom-sheet mounts after Crew onboarding (or first Home visit if Crew already done).

**Regression test:** `useMe.lc-id.test.ts` + `handle-claim.flow.test.ts` (to-be-authored)

**Closes only when:**
1. Backend `/me` returns `lc_id` string
2. Frontend `MeSnapshot.lcId` populated in adapter
3. First-run claim UI mounts exactly once on first signed-in Home visit
4. Doctor observes `handle_claimed` telemetry in test run
5. `test.passes:test_identity_claim_service.py::test_canonical_and_legacy_write_same_row` (gap-closure · no divergence between /me/lc-id/claim and /me/handle)
6. `test.passes:test_identity_claim_service.py::test_service_writes_same_row_from_either_source` (gap-closure · direct service parity)
7. HQ telemetry: backend `handle_write source=lc-id-claim` observed on every canonical write (gap-closure)
8. HQ telemetry: `claim_sheet_opened` observed with correct `mountReason` per entry point (gap-closure)

**Latest evidence:** Backend column present (Block 1 migration). No frontend read anywhere in `desktop-2/src`.

**Next action:** Wave 1 Agent 1 — implement in same branch as BUG-002.

**Dependencies:** — (BUG-002 depends on this)
**Assigned branch:** unassigned
**Assigned wave:** 1

---

## BUG-011 · `text-transform: uppercase` obscures identity pill copy verification

- **Category:** 1 · Identity and trust
- **Owner system:** `capability.operational-excellence` (verification-blocker) + `capability.identity-trust` (surface)
- **Mission:** M3

**Customer symptom:** Not customer-visible directly. Engineering/support cannot distinguish `SIGN IN` (pre-R7 copy) from `START FREE · 10 CLIPS` (R7 copy) from screenshots at reasonable resolution.

**Status:** FIXED_UNPROVEN
**Assigned branch (wave-1 dispatch):** `wave-1/identity-ladder`
**Fixed-unproven notes:** Wave 1 (2026-07-12) added `data-identity-copy={identityCopy}` on the identity pill button in `TopHud.tsx` AND `data-identity-copy={identityLadder.copy}` on both greeting-name and avatar-name slots. `SplashLeaderboard.tsx` YouCallout exposes the same attribute on its identity string. QA / ship-lens can now query the literal copy string through the `textTransform:uppercase` CSS. UNPROVEN because: no Playwright or Doctor query has yet been executed against the promoted bundle to confirm the attribute is present in the shipped DOM.

**Technical root cause:** `TopHud.tsx:544` inline `textTransform: "uppercase"`. Bundle grep confirms R7 copy baked, but visual QA cannot verify which literal is rendering.  · confidence 1.00

**Business root cause:** Design choice from Phase 4B-rev shipped unchanged. Not deliberate obfuscation, but destroys visual QA of the exact string that ships.  · confidence 0.80

**Affected capabilities:** `capability.operational-excellence`, `capability.identity-trust`
**Affected journeys:** none directly
**Affected stations:** `station.tophud.identity-pill`

**Canonical source of truth:** `station.tophud.identity-pill` copy

**Files & lines:**
- `desktop-2/src/design-os/components/TopHud.tsx:544`

**Business consequence:**
- Revenue: NONE
- Trust: LOW
- Support: MEDIUM (slows triage of customer reports)
- Conversion: NONE
Confidence business consequence: 0.70

**Composite severity:** P2 (verification friction · doesn't break a customer journey)

**Related bug ids:** BUG-002 (verifying its fix is blocked by this)
**Sibling bugs by root cause:** BUG-002, BUG-003, BUG-013 (Cluster 1)

**Bug class:** BC-005 (QA-side observability failure of the same UI ambiguity that produces BC-005 elsewhere)
**Class-elimination pattern:** Add `data-identity-copy` + `data-identity-kind` attributes on every rung render site in TopHud + SplashLeaderboard. Attributes preserve visual style AND let Doctor / Playwright query the literal copy independent of upper/lower casing.

**Golden paths blocked:** none directly · this bug is a QA-verification blocker, not a customer-facing issue.

**Telemetry that should have detected:** n/a (visual-QA issue · no telemetry appropriate).

**Tests that should have failed:**
- `TopHud.identity-ladder.test.ts::data-identity-copy attribute present` (didn't exist pre-Wave-1)
- `SplashLeaderboard.test.ts::data-identity-copy attribute present` (didn't exist pre-Wave-1)
**Decision ids:** —
**Invariant ids:** —

**Shell impact:** none
**Introduced or discovered at commit:** pre-thread (Phase 4B rev)
**Last verified commit:** e4ff1060
**Recurrence count:** 1

**Permanent fix (proposed):** Either (a) remove `textTransform: "uppercase"`, or (b) add `data-identity-copy="<literal>"` attribute Playwright/Doctor can query. Option b is cheaper and preserves the visual style.

**Regression test:** none required · verification is an attribute lookup

**Closes only when:**
1. `data-identity-copy` attribute present with literal copy string
2. Doctor query returns exact string on inspection
3. Gap-closure: `data-greeting-copy` attribute also present on the greeting eyebrow so QA can query the personalised string directly (locked by `TopHud.identity-ladder.test.ts::data-greeting-copy attribute is exposed`)

**Latest evidence:** Daniel screenshot 2026-07-11 shows pill copy short enough to be either "SIGN IN" or (much longer) "START FREE · 10 CLIPS" — indeterminate.

**Next action:** Roll into Wave 1 Agent 1's TopHud pass · one-line addition.

**Dependencies:** —
**Assigned branch:** unassigned
**Assigned wave:** 1 (piggyback)

---

## BUG-013 · "Good evening ✦" static — never personalized

- **Category:** 1 · Identity and trust
- **Owner system:** `capability.identity-trust`
- **Mission:** M3, M4

**Customer symptom:** TopHud greeting eyebrow always reads `"Good evening ✦"` regardless of time of day or signed-in identity.

**Status:** FIXED_UNPROVEN
**Assigned branch (wave-1 dispatch):** `wave-1/identity-ladder`
**Fixed-unproven notes:** Wave 1 (2026-07-12) added a `derivedGreeting` `useMemo` in `TopHud.tsx` that derives time-of-day from local clock (`morning` / `afternoon` / `evening`) and interpolates `@handle` or `LC-XXXXXX` from the identity ladder. Never inserts `"Guest"` or `"Signing in…"`. The `greetingEyebrow` prop now defaults to `undefined` (test override only) so no caller can smuggle a stale hardcoded greeting. UNPROVEN because: no live walk across 4 time-of-day × 3 auth-state cases has run on the promoted bundle.

**Technical root cause:** `TopHud.tsx:75` sets `greetingEyebrow = "Good evening ✦"` as a static default. No time-of-day derivation. No name interpolation. Renders at `TopHud.tsx:372`.  · confidence 1.00

**Business root cause:** Placeholder copy shipped unchanged from Phase 4B-rev; no product decision to personalize.  · confidence 0.90

**Affected capabilities:** `capability.identity-trust`
**Affected journeys:** `j002-returning-user`
**Affected stations:** `station.tophud.greeting-eyebrow`

**Canonical source of truth:** `state.current-user.handle` (or LC-ID) + local clock

**Files & lines:**
- `desktop-2/src/design-os/components/TopHud.tsx:75, 372`

**Business consequence:**
- Revenue: NONE
- Trust: MEDIUM (impersonal · reinforces BUG-002's "Guest" feel)
- Support: LOW
- Conversion: LOW
Confidence business consequence: 0.60

**Composite severity:** P2

**Related bug ids:** BUG-002, BUG-003
**Sibling bugs by root cause:** BUG-002, BUG-003, BUG-011 (Cluster 1)

**Bug class:** BC-005 (UI reading no source at all is a degenerate form of reading divergent stores · greeting had no canonical selector)
**Class-elimination pattern:** `derivedGreeting` useMemo inside TopHud reads `hook.useMe` selector once and interpolates against the same 5-rung identity ladder. Never inserts `"Guest"` or `"Signing in…"` into the greeting subject; falls to bare `Good {timeOfDay}` when identity is absent.

**Golden paths blocked:** none directly · trust impact only.

**Telemetry that should have detected:** none (greeting personalisation is presentation, no state transition).

**Tests that should have failed:**
- `TopHud.identity-ladder.test.ts::greeting personalises with handle when present` (didn't exist pre-Wave-1)
**Decision ids:** —
**Invariant ids:** —

**Shell impact:** none
**Introduced or discovered at commit:** pre-thread
**Last verified commit:** e4ff1060
**Recurrence count:** 1

**Permanent fix (proposed):** Derive time-of-day from local clock. Interpolate handle/LC-ID. Guest fallback: `Welcome ✦`. Examples: `Good morning ✦ @daniel` / `Good evening ✦ LC-A2K9` / `Welcome ✦`.

**Regression test:** `greeting.personalized.test.ts` (to-be-authored)

**Closes only when:**
1. Test passes across 4 time-of-day × 3 auth-state (unauth / auth-hydrating / signed) cases
2. Gap-closure: greeting personalises with email local-part when handle + lcId both null (rung 3) — locked by `TopHud.identity-ladder.test.ts::greeting personalises with email local-part on rung 3`

**Latest evidence:** Direct grep of `TopHud.tsx:75`.

**Next action:** Piggyback on Wave 1 Agent 1 identity ladder work.

**Dependencies:** BUG-003 (handle/LC-ID must exist first)
**Assigned branch:** unassigned
**Assigned wave:** 1 (piggyback)

---

# Category 2 · Monetisation and Whop

## BUG-004 · "Connect Whop" not visible from all states

- **Category:** 2 · Monetisation and Whop
- **Owner system:** `capability.affiliate-revenue`
- **Mission:** M2 (Revenue)

**Customer symptom:** No permanent visible affordance to Connect Whop. The identity pill shows Whop only when `identityState === "connectWhop"` (JWT + no Whop + non-agency). Admin users, agency users, unauthed users can never see the CTA in chrome. Wallet/Settings CTAs exist but are downstream surfaces.

**Status:** FIXED_UNPROVEN
**Fixed-unproven notes:** Train A2 (2026-07-12) shipped `WhopStatusChip` mounted in TopHud pill strip. Chip reads canonical `useMe().snapshot.whopUserId` + `useAuth().hasJwt` and renders four states (`no-jwt` / `unlinked` / `linking` / `linked`). Click fires shared `connectWhop()` helper. Telemetry topics `whop_status_chip_impression` · `whop_connect_cta_clicked` · `whop_status_transition` land via `lcDiag`. Live customer walkthrough still owed to promote to CLOSED.

**Technical root cause:** `TopHud.tsx:216-231` derives 4-state identityCopy; only one shows Whop. Wallet/Settings CTAs conditionally rendered on `!whopUserId`, providing 3 downstream surfaces but no PERSISTENT status chip.  · confidence 0.90

**Business root cause:** No product decision for a persistent Whop status chip separate from identity pill. Historically the pill was intended as entry point — but it competes for the same slot as sign-in and agency upgrade.  · confidence 0.70

**Affected capabilities:** `capability.affiliate-revenue`
**Affected journeys:** `j004-connect-whop`
**Affected stations:** `station.tophud.identity-pill` (overloaded), missing `station.tophud.whop-status`, `station.home.hero`

**Canonical source of truth:** `state.whop-connection` (owner `hook.useMe.snapshot.whopUserId`)

**Files & lines:**
- `desktop-2/src/design-os/components/TopHud.tsx:206-231`
- `desktop-2/src/design-os/routes/CommandRoom.tsx` (Home hero — could host CTA)
- `desktop-2/src/routes/wallet-detail/WalletDetail.tsx:633-651`
- `desktop-2/src/design-os/routes/Settings.tsx:842`
- `desktop-2/src/design-os/earn/AffiliateWidget.tsx:298`

**Business consequence:**
- Revenue: HIGH (Connect Whop is the MRR gate)
- Trust: LOW
- Support: MEDIUM
- Conversion: HIGH (discovery-to-connect funnel)
Confidence business consequence: 0.80

**Composite severity:** P1 (money journey blocked with workaround via Wallet/Settings)

**Related bug ids:** BUG-014 (Home hero also lacks CTA)
**Decision ids:** —
**Invariant ids:** INV-003 (money CTA telemetry)

**Shell impact:** none
**Introduced or discovered at commit:** pre-thread
**Last verified commit:** e4ff1060
**Recurrence count:** 1

**Permanent fix (proposed):** Add persistent `WhopStatusChip` between version pill and identity pill in TopHud. States: `Not connected · click to link` / `@whop-handle · linked` / `Reconnect required`. Also see BUG-014 for Home hero placement.

**Regression test:** `TopHud.whop-status.test.ts::chip-visible-when-unlinked` (to-be-authored)

**Closes only when:**
1. Chip mounted in TopHud strip
2. Chip click fires `connectWhop()`
3. On successful link → chip flips to `linked` within 1 tick of `activation:complete`
4. Doctor observes `whop_connect_cta_clicked` telemetry from every mount site

**Latest evidence:** Daniel screenshot — admin user with menu open shows no Connect Whop affordance in header.

**Next action:** Wave 2 Agent 2 (Whop/tier truth) — persistent chip + Home hero CTA.

**Dependencies:** —
**Assigned branch:** unassigned
**Assigned wave:** 2

---

## BUG-008 · ExportPanel + OverlayTemplateGallery + ReactionControls default `userTier="free"`

- **Category:** 2 · Monetisation and Whop (tier gating is monetisation)
- **Owner system:** `capability.content-production`
- **Mission:** M2

**Customer symptom:** Export surfaces internally treat every user as `free` tier when no prop passed. Fails closed (safe · watermark applied) but wrong for Pro / Agency users hitting preset gates that aren't covered by `watermarkLockedOverride`.

**Status:** FIXED_UNPROVEN
**Fixed-unproven notes:** Train A2 (2026-07-12) shipped `useCanonicalStudioTier()` in `useTierCaps.ts` — a canonical hook that returns the studio-family Tier (`clipper` → `free`). All three studio components (`ExportPanel` · `OverlayTemplateGallery` · `ReactionControls`) dropped the `userTier?: Tier` prop with the `"free"` default and now read tier internally via this hook. Grep + regression test `ExportPanel.tier-propagation.test.ts` asserts no caller passes a `userTier` prop and no internal default remains. Live walk on an Agency-tier user still owed to promote to CLOSED.

**Technical root cause:** Ship-lens P2-002 · grep-verified. `ExportPanel.tsx:75` `userTier = "free"` default. Line 164 uses it in `TIER_RANK[userTier] < TIER_RANK.pro` for preset gates unrelated to watermark.  · confidence 1.00

**Business root cause:** Pattern of tier-as-prop never fully migrated to hook. State-drift trifecta scope was tight to TopHud + SplashLeaderboard prop deletion.  · confidence 0.90

**Affected capabilities:** `capability.content-production`
**Affected journeys:** `j009-export-single-clip`
**Affected stations:** `station.export.preset-picker`, `station.overlay.template-gallery`, `station.reaction.controls`

**Canonical source of truth:** `state.tier` (owner `hook.useTierCaps`)

**Files & lines:**
- `desktop-2/src/design-os/export/ExportPanel.tsx:75, 164`
- `desktop-2/src/design-os/routes/ExportRoute.tsx:328` (mounts OverlayTemplateGallery)
- `desktop-2/src/design-os/reactions/ReactionControls.tsx` (line TBD)

**Business consequence:**
- Revenue: MEDIUM (agency users see Pro-locked ribbons instead of Agency-unlocked)
- Trust: MEDIUM
- Support: MEDIUM ("why is my export watermarked when I'm Pro")
- Conversion: LOW
Confidence business consequence: 0.80

**Composite severity:** P1

**Related bug ids:** —
**Decision ids:** —
**Invariant ids:** —

**Shell impact:** none
**Introduced or discovered at commit:** pre-thread; flagged by ship-lens on `e4ff1060`
**Last verified commit:** e4ff1060
**Recurrence count:** 1

**Permanent fix (proposed):** Internal `useTierCaps()` in each component. Delete `userTier` prop entirely. Add regression test asserting no `userTier=` prop passed and no internal default outside `useTierCaps`.

**Regression test:** `export-tier-source.test.ts` — greps + asserts (to-be-authored)

**Closes only when:**
1. Grep-assert: no `userTier=` prop passed outside `useTierCaps` internals
2. Grep-assert: no internal `userTier = "free"` default
3. Agency user sees Agency-unlocked ribbons in Export in live walk

**Latest evidence:** Ship-lens P2-002 finding · grep-verified.

**Next action:** Wave 2 Agent 2 — sweep 3 components to internal `useTierCaps()`.

**Dependencies:** —
**Assigned branch:** unassigned
**Assigned wave:** 2

---

## BUG-014 · Home hero lacks Whop CTA when unconnected

- **Category:** 2 · Monetisation and Whop
- **Owner system:** `capability.affiliate-revenue`
- **Mission:** M2

**Customer symptom:** Home shows "Find paid clipping opportunities without leaving the app" hero + 4 fixed tiles. No persistent Connect Whop CTA even when user has no Whop link.

**Status:** FIXED_UNPROVEN
**Fixed-unproven notes:** Train A2 (2026-07-12) mounted `WhopStatusChip mountSite="home-hero"` in `CommandRoom` HomeContent above the tile grid, gated on `!isAgency` (agency mode is out of the Whop-connect funnel). Chip renders the full "Connect Whop to activate paid clips" hero card ONLY in the `unlinked` state (JWT + no whopUserId); returns null for `linked` / `no-jwt` so linked and anonymous users see no visual noise. Telemetry topic `whop_status_chip_impression { state, mount_site: "home-hero" }` fires on render. Live customer walkthrough on an unlinked account still owed to promote to CLOSED.

**Technical root cause:** `CommandRoom.tsx:HomeContent` renders 4 fixed tiles + Earn strip. No conditional CTA on `me.snapshot?.whopUserId`.  · confidence 0.90

**Business root cause:** Product decision to keep Home hero minimal shipped in earlier UI-3 phase; Whop was assumed to be handled by identity pill.  · confidence 0.75

**Affected capabilities:** `capability.affiliate-revenue`
**Affected journeys:** `j004-connect-whop`
**Affected stations:** `station.home.hero`

**Canonical source of truth:** `state.whop-connection`

**Files & lines:**
- `desktop-2/src/design-os/routes/CommandRoom.tsx` (HomeContent function)

**Business consequence:**
- Revenue: HIGH (highest-traffic surface, missing CTA = missing MRR opportunity)
- Trust: LOW
- Support: LOW
- Conversion: HIGH (discovery-to-connect funnel)
Confidence business consequence: 0.80

**Composite severity:** P1

**Related bug ids:** BUG-004
**Decision ids:** —
**Invariant ids:** INV-003

**Shell impact:** none
**Introduced or discovered at commit:** pre-thread
**Last verified commit:** e4ff1060
**Recurrence count:** 1

**Permanent fix (proposed):** Conditional 5th tile OR strip-level CTA when `!me.snapshot?.whopUserId`. Copy suggestion: `Connect Whop · unlock recurring MRR →`.

**Regression test:** `home.whop-cta.test.ts` (to-be-authored)

**Closes only when:**
1. Test passes for both connected + unconnected branches
2. Doctor sees `whop_cta_home_impressions` telemetry within 1 tick of mount when unconnected

**Latest evidence:** Screenshot 2026-07-11 shows Home hero without Whop affordance.

**Next action:** Wave 2 Agent 2 — Home hero conditional CTA in same branch as BUG-004 chip work.

**Dependencies:** BUG-004
**Assigned branch:** unassigned
**Assigned wave:** 2

---

# Category 3 · Runtime and updates

## BUG-006 · Version pill shows shell version when runtime bundle is newer

- **Category:** 3 · Runtime and updates
- **Owner system:** `capability.operational-excellence`
- **Mission:** M3

**Customer symptom:** After promoting a runtime bundle (e.g. `2.2.36-state-drift-fixed`), TopHud version pill still reads `v2.2.36`. Support / dev cannot tell which bundle is actually running from the UI.

**Status:** FIXED_UNPROVEN
**Assigned branch (wave-b1 dispatch):** `wave-b1/runtime-truth`
**Fixed-unproven notes:** Wave B1 · RC1 (2026-07-12) hardened `useRuntimeVersion` on top of the P1-C `invoke("runtime_info")` wire:
  (a) hook subscribes to the `lc:runtime-staged` Tauri event so a mid-session bundle promotion re-reads `runtime_info` and every consumer (TopHud pill, IntroSplash v-tag, DiagnosticsSection stat, Settings copy-diagnostics payload) flips on the same tick — no route remount required.
  (b) new `runtimeVersionSync()` export lets non-React callers (App.tsx boot flowTrace + logDiag, telemetry/bootstrap.ts) consume the same shell-fallback the hook renders at first paint.
  (c) new test suite (`useRuntimeVersion.test.ts`) covers the fallback shape + source discriminator + event subscription + BUG-007 grep guard.
UNPROVEN because BUG-006's Rust `runtime_info` still returns `env!("CARGO_PKG_VERSION")` when `staged_bundle_path()` returns None (no `current.json` OR bundle dir invalid). Doctor-lite live walk on a promoted bundle where staging succeeds is required to prove closure.

Prior partial-fix note (state-drift trifecta P1-C, preserved for provenance):
> Wired `useRuntimeVersion` frontend hook to `invoke("runtime_info")` and consumed `active_version`. But Rust `runtime.rs::runtime_info` returns the shell's compiled version when no valid staged bundle exists. The wire is correct; the source of truth beneath the wire is still shell-tied in the null-staged-bundle case.

**Technical root cause:** Rust command `#[tauri::command] runtime_info` returns compile-time constant when no valid staged bundle. Frontend fallback yields same string. Confidence: 0.85

**Business root cause:** Shell frozen (DECISION-0003). Runtime-aware version reader never implemented in Rust. Confidence: 0.75

**Affected capabilities:** `capability.operational-excellence`
**Affected journeys:** `j014-runtime-update`
**Affected stations:** `station.tophud.version-pill`

**Canonical source of truth:** `state.runtime-version` (owner `hook.useRuntimeVersion` → Tauri `runtime_info`)

**Files & lines:**
- `desktop-2/src-tauri/src/runtime.rs` (READ-ONLY per DECISION-0003)
- `desktop-2/src/lib/useRuntimeVersion.ts:70-90`
- `~/Library/Application Support/Liquid Clips/runtime/current.json`

**Business consequence:**
- Revenue: NONE
- Trust: LOW
- Support: HIGH ("which version are you on" cannot be answered from UI)
- Conversion: NONE
Confidence business consequence: 0.70

**Composite severity:** P1 (HQ blind to actual bundle version during incident triage)

**Related bug ids:** BUG-007, BUG-012
**Decision ids:** DECISION-0003 (shell freeze — blocks direct fix)
**Invariant ids:** —

**Shell impact:** native (Rust change required for ideal fix) · runtime-only workaround possible
**Introduced or discovered at commit:** pre-thread; visible on `e4ff1060`
**Last verified commit:** e4ff1060 (still reproducing on `2.2.36-state-drift-fixed`)
**Recurrence count:** 1

**Permanent fix (proposed):**
- **Native path (blocked by DECISION-0003):** update `runtime.rs::runtime_info` to read `current.json.version` if present.
- **Runtime path (available now):** Frontend `useRuntimeVersion` reads `current.json` via `@tauri-apps/plugin-fs` at boot and displays it. Fall through to shell version only if read fails.

**Regression test:** `TopHud.version-pill.test.ts::displays-runtime-version-when-set` (to-be-authored)

**Closes only when:**
1. Test passes
2. Live: on promoted bundle, pill text == `current.json.version` value within 3s of boot
3. Doctor confirms parity across shell vs runtime version signals

**Latest evidence:** Screenshot 2026-07-11 15:23 — pill shows `v2.2.36` while `current.json.version == "2.2.36-state-drift-fixed"`.

**Next action:** Choose native vs runtime path. Runtime path preferred until shell unlocks.

**Dependencies:** DECISION-0003 decision
**Assigned branch:** unassigned
**Assigned wave:** 3 (or piggyback on Agent 4 nav/perf where telemetry parity matters)

---

## BUG-007 · `__APP_VERSION__` still hardcoded in Settings, IntroSplash, DiagnosticsSection

- **Category:** 3 · Runtime and updates
- **Owner system:** `capability.operational-excellence`
- **Mission:** M3

**Customer symptom:** Same version drift as BUG-006, in three additional surfaces. Diagnostics is the primary "tell us your version" surface.

**Status:** FIXED_UNPROVEN
**Assigned branch (wave-b1 dispatch):** `wave-b1/runtime-truth`
**Fixed-unproven notes:** Wave B1 · RC1 (2026-07-12) swept every named render site (Settings copy-diagnostics payload, DiagnosticsSection `VERSION_PLACEHOLDER`, IntroSplash v-tag) onto `useRuntimeVersion()` + the two non-React callers (App.tsx boot flowTrace + logDiag, telemetry/bootstrap.ts `release`) onto `runtimeVersionSync()`. Grep guard in `useRuntimeVersion.test.ts` verifies the five sweep targets are clean. Only remaining `__APP_VERSION__` reader inside `src/**` is the canonical `useRuntimeVersion.ts`. UNPROVEN because a live customer walk on a promoted bundle hasn't yet been executed; the sweep is code-verified only.

**Technical root cause:** Grep-verified — all three sites rendered `__APP_VERSION__` (build-time constant); now consume the canonical hook. Confidence: 1.00

**Business root cause:** Scope cutoff; cleanup pass not scheduled. Confidence: 0.90

**Affected capabilities:** `capability.operational-excellence`
**Affected journeys:** `j014-runtime-update`
**Affected stations:** `station.settings.version`, `station.introsplash.version`, `station.diagnostics.version`

**Canonical source of truth:** `state.runtime-version` (owner `hook.useRuntimeVersion`)

**Files & lines:**
- `desktop-2/src/design-os/routes/Settings.tsx:539-540`
- `desktop-2/src/routes/introsplash/IntroSplash.tsx:456`
- `desktop-2/src/routes/diagnostics/DiagnosticsSection.tsx:22-23`

**Business consequence:**
- Revenue: NONE
- Trust: LOW
- Support: MEDIUM
- Conversion: NONE
Confidence business consequence: 0.85

**Composite severity:** P2

**Related bug ids:** BUG-006 (cascades — fixing BUG-006's underlying source of truth fixes here too)
**Decision ids:** —
**Invariant ids:** —

**Shell impact:** none (frontend-only)
**Introduced or discovered at commit:** pre-thread; flagged 2026-07-11 by ship-lens
**Last verified commit:** e4ff1060
**Recurrence count:** 1

**Permanent fix (proposed):** Sweep 3 sites to use `useRuntimeVersion()`. Regression test greps for `__APP_VERSION__` outside the hook file.

**Regression test:** `version-consistency.test.ts` — grep-assert 0 hits outside `useRuntimeVersion.ts` (to-be-authored)

**Closes only when:**
1. Test passes
2. All three surfaces display same string as TopHud pill on a promoted bundle

**Latest evidence:** Grep-verified.

**Next action:** Piggyback on BUG-006 branch.

**Dependencies:** BUG-006
**Assigned branch:** unassigned
**Assigned wave:** 3

---

## BUG-009 · UpdateBeacon 404-polls `/runtime/manifest.json`

- **Category:** 3 · Runtime and updates
- **Owner system:** `capability.operational-excellence`
- **Mission:** M3

**Customer symptom:** Not customer-visible. Backend log flooded with `[LC-CLIENT-DIAG] update_beacon_check_failed · reason "bundle endpoint returned 404"` every 5 min from same session for hours. Obscures real signals.

**Status:** FIXED_UNPROVEN
**Assigned branch (wave-b1 dispatch):** `wave-b1/runtime-truth`
**Fixed-unproven notes:** Wave B1 · RC1 (2026-07-12) landed two-sided fix:
  Backend `/runtime/manifest.json` now wraps the SELECT in try/except → any DB-side surface (missing `runtime_manifests` table, missing column, transient SQL error) degrades to 204 instead of 500. The client already treated 204 as "no update available"; the 500 path was the only surface generating the noise.
  Frontend `UpdateBeacon` deduplicates `update_beacon_check_failed` by `(step, reason)` fingerprint — first failure emits, identical follow-ups within the same sad streak stay silent, any successful `runtime_info` / `runtime_check_now` clears the ring so a healed backend restores logging.
  New backend test suite (`test_runtime_manifest_shapes.py`) proves four 204 shapes (empty channel, unknown channel, current_version match, simulated DB failure). New frontend test suite (`UpdateBeacon.test.ts`) proves the dedup ring wiring + healed-state reset.
UNPROVEN because we haven't yet observed a 30-min tail of `/tmp/backend.log` on the healed backend showing zero failure events (ledger closure step 2).

**Technical root cause:** `UpdateBeacon.tsx:runtime_check_now` invoke path surfaces any Rust-side error (including the manifest endpoint returning 500 when `runtime_manifests` isn't migrated). Prior route also lacked exception handling. Confidence: 0.90

**Business root cause:** Updater designed for prod Railway where manifest endpoint is populated. Local dev never had manifest. No graceful degradation. Confidence: 0.75

**Affected capabilities:** `capability.operational-excellence`
**Affected journeys:** `j014-runtime-update`
**Affected stations:** `station.update-beacon.check`

**Canonical source of truth:** `endpoint.get_runtime_manifest` (backend)

**Files & lines:**
- `desktop-2/src/components/UpdateBeacon.tsx:74-249`
- `junior-backend/app/routes/runtime.py:64-90`

**Business consequence:**
- Revenue: NONE
- Trust: NONE
- Support: MEDIUM (log noise blocks diagnosis)
- Conversion: NONE
Confidence business consequence: 0.85

**Composite severity:** P2 (missing telemetry graceful-degradation · does not block customer journey)

**Related bug ids:** —
**Decision ids:** —
**Invariant ids:** —

**Shell impact:** none (backend + frontend only)
**Introduced or discovered at commit:** pre-thread
**Last verified commit:** e4ff1060 (still emitting in local backend log at time of state-drift-fixed promote)
**Recurrence count:** 28+ per 2-hour window

**Permanent fix (proposed):** Backend returns `204 No Content` when no manifest available. Frontend treats `204` as "no update pending" without emitting failure telemetry.

**Regression test:** `runtime-beacon.no-manifest.test.ts` (to-be-authored)

**Closes only when:**
1. Test passes: no `update_beacon_check_failed` emitted when backend returns 204
2. Live: 30-min tail of `/tmp/backend.log` shows zero failure events on fresh backend

**Latest evidence:** `/tmp/backend.log` shows 28 identical failure events over 2h prior to relaunch.

**Next action:** Wave later — small backend + frontend patch.

**Dependencies:** —
**Assigned branch:** unassigned
**Assigned wave:** later

---

## BUG-012 · Runtime bundle hot-swap requires quit+relaunch · Cmd+R doesn't stick

- **Category:** 3 · Runtime and updates
- **Owner system:** `capability.operational-excellence`
- **Mission:** M3

**Customer symptom:** After promoting a runtime bundle, sending Cmd+R to the app window doesn't consistently load the new bundle. Only full app quit + reopen reliably picks it up. Applies to the customer-facing UpdateBeacon reload button too.

**Status:** OPEN (investigated · native fix required · Wave B1 STOP)
**Fixed-unproven notes:** Wave B1 · RC1 (2026-07-12) investigation identified the exact native root cause. **Native Rust patch required · no runtime-only workaround possible.** See `lcos/reports/rc1-sprint/STOP_REPORT_WAVE_B1_BUG_012.md`.

**Technical root cause:** IDENTIFIED (confidence 0.85).
`src-tauri/src/runtime.rs::serve_runtime_uri` (line 515-522) reads a cached `ACTIVE_RUNTIME_ROOT` `OnceLock<RwLock<Option<PathBuf>>>` FIRST, only falling back to `resolve_runtime_root(app)` when the cache is `None`. The cache is populated at boot by `cache_active_root(&app.handle())` in `src-tauri/src/lib.rs:483`.

Boot-time staging path (lib.rs:485-492) DOES refresh the cache after `check_and_stage_runtime` completes. But `runtime_check_now` (runtime.rs:494-496) — the command UpdateBeacon polls every 5 min AND the Settings "Check now" button — calls `check_and_stage_runtime` without a subsequent `cache_active_root(&app)`. So a mid-session staging succeeds (bundle written, `current.json` flipped, `lc:runtime-staged` emitted) but the URI-scheme handler continues serving the OLD path from the stale cache. Cmd+R and `window.location.reload()` both re-navigate to `runtime://app/index.html` — the URI handler runs, reads the stale cache, serves the old index.html + old asset hashes.

Only a full app quit + relaunch triggers `cache_active_root` at boot to update the cache, which is why the observed customer behaviour is "quit+relaunch works, Cmd+R doesn't". Confidence: 0.85

**Native fix (blocked by DECISION-0003 · one line):**
`runtime_check_now` must call `cache_active_root(&app)` after `check_and_stage_runtime` returns. See STOP report §"Proposed native fix".

**Runtime-only workaround: NONE available.** The stale cache lives inside the Rust process. Frontend cannot reach the `ACTIVE_RUNTIME_ROOT` `OnceLock` from JS. Every runtime-side "reload" path terminates at `window.location.reload()` which is the very path the cache poisons.

**Business root cause:** No developer test proves hot-swap. No visible boot signal proves which bundle rendered. Confidence: 0.60

**Affected capabilities:** `capability.operational-excellence`
**Affected journeys:** `j014-runtime-update`
**Affected stations:** `station.update-beacon.reload`

**Canonical source of truth:** Tauri `runtime_info` + `current.json`

**Files & lines:**
- `desktop-2/src-tauri/src/runtime.rs` (READ-ONLY)

**Business consequence:**
- Revenue: NONE
- Trust: LOW
- Support: MEDIUM (users clicking "Reload" beacon may still see old bundle)
- Conversion: LOW
Confidence business consequence: 0.65

**Composite severity:** P1 (blocks the customer-facing runtime update path)

**Related bug ids:** BUG-001 (need boot event to diagnose)
**Decision ids:** DECISION-0003
**Invariant ids:** —

**Shell impact:** native (Rust) potentially · investigation needed
**Introduced or discovered at commit:** pre-thread; observed 2026-07-11 during promote sequence
**Last verified commit:** e4ff1060
**Recurrence count:** 3+ observed during this thread

**Permanent fix (proposed):**
1. First add boot event with runtime_version (BUG-001 fix) so hot-swap is observable.
2. Investigate whether Tauri needs `invoke("webview_reload")` instead of Cmd+R keystroke.
3. If yes, wire UpdateBeacon reload button to the invoke.

**Regression test:** `runtime-hotswap.test.ts` (integration · to-be-authored)

**Closes only when:**
1. Test passes
2. Live: promoting bundle + clicking beacon reload updates version pill within 3s

**Latest evidence:** Multiple Cmd+R attempts during 2026-07-11 promotes required full quit+relaunch to actually load new bundle.

**Next action:** Wave 4 — after BUG-001 boot event lands and gives observable hook.

**Dependencies:** BUG-001
**Assigned branch:** unassigned
**Assigned wave:** 4

---

# Category 4 · Navigation and performance

## BUG-010 · Learn nav item visibility on cold-boot unverified

- **Category:** 4 · Navigation and performance
- **Owner system:** `capability.community-retention`
- **Mission:** M4

**Customer symptom:** Uncertain. Screenshot after cold-boot of `state-drift-fixed` bundle doesn't clearly show Learn between My Journey and Wallet. Bundle grep confirms code is present.

**Status:** OPEN (needs Doctor pass to confirm or dismiss · this may be a false alarm)
**Fixed-unproven notes:** Block 3 wired Learn via `SectionRegistry` + `ConsoleNav.tsx:51`. Bundle strings confirmed baked. Discovery: either (a) rendered fine but screenshot resolution too low, (b) mode gate hiding it, (c) actual regression.

**Technical root cause:** Verification gap. Confidence: 0.40

**Business root cause:** Confidence too low to name until confirmed. Confidence: 0.30

**Affected capabilities:** `capability.community-retention`
**Affected journeys:** `j001-fresh-user-otp-identity` (post-boot nav discovery)
**Affected stations:** `station.consolenav.learn`

**Canonical source of truth:** `SectionRegistry` + `SURFACE_FOR`

**Files & lines:**
- `desktop-2/src/design-os/components/ConsoleNav.tsx:45-51`
- `desktop-2/src/design-os/routing/SimulatorRouter.tsx` (SURFACE_FOR.learn added Block 3)

**Business consequence:**
- Revenue: NONE
- Trust: LOW
- Support: LOW
- Conversion: MEDIUM (if truly missing)
Confidence business consequence: 0.40

**Composite severity:** P2 (P1 if confirmed missing on live walk)

**Related bug ids:** —
**Decision ids:** —
**Invariant ids:** —

**Shell impact:** none
**Introduced or discovered at commit:** Block 3 landing (2026-07-11)
**Last verified commit:** e4ff1060 (uncertain in screenshot)
**Recurrence count:** 1

**Permanent fix (proposed):** Depends on confirmation. If genuinely missing: verify mode gate + render order. If screenshot artifact: dismiss with a regression test to prevent recurrence.

**Regression test:** `ConsoleNav.learn-visible.test.ts` — assert Learn present regardless of mode (to-be-authored)

**Closes only when:**
1. Doctor confirms Learn visible on live cold-boot walkthrough
2. Test passes

**Latest evidence:** Grep confirms bundled. Visual observation inconclusive.

**Next action:** Wave 5 (Journey QA) — first item on the cold-boot walk.

**Dependencies:** —
**Assigned branch:** unassigned
**Assigned wave:** 5

---

# Category 5 · Observability and HQ

## BUG-001 · Campaigns click telemetry not emitting

- **Category:** 5 · Observability and HQ
- **Owner system:** `capability.operational-excellence`
- **Mission:** M3

**Customer symptom:** Not customer-visible. Engineering-visible: opening Campaigns produces zero waterfall events in the log. LCOS-visible: cannot verify Phase 1 instrumentation works.

**Status:** OPEN
**Fixed-unproven notes:** Phase 1 instrumentation (`navPerf.ts`) added 2026-07-11 · commit `f7f2cad7`. Code shipped, tests pass. Runtime never proven end-to-end.

**Technical root cause:** Cold-boot session never emitted `nav_click_performance` after promote. Two possibilities: (a) app was still on stale bundle, (b) lcDiag buffer never flushed for the fresh session. Confidence: 0.70

**Business root cause:** Runtime bundle hot-swap has no observable boot signal. No way to prove which bundle is running end-to-end. This is a symptom of BUG-012 more than a root cause. Confidence: 0.80

**Affected capabilities:** `capability.operational-excellence`
**Affected journeys:** `j014-runtime-update`
**Affected stations:** `station.consolenav.campaigns`

**Canonical source of truth:** `state.runtime-version`

**Files & lines:**
- `desktop-2/src/lib/navPerf.ts`
- `desktop-2/src/lib/diagnosticLogger.ts`
- `desktop-2/src-tauri/src/runtime.rs` (READ-ONLY)

**Business consequence:**
- Revenue: NONE
- Trust: NONE
- Support: MEDIUM (blocks engineering self-diagnosis · specifically blocks Phase 2 optimizer)
- Conversion: NONE
Confidence business consequence: 0.85

**Composite severity:** P1 (HQ blind to a critical dev diagnostic path)

**Related bug ids:** BUG-006, BUG-012
**Decision ids:** —
**Invariant ids:** —

**Shell impact:** runtime (add boot event) · potentially native to investigate reload behavior
**Introduced or discovered at commit:** Discovered 2026-07-11 during Phase 1 verification
**Last verified commit:** e4ff1060 (still not emitting)
**Recurrence count:** 1

**Permanent fix (proposed):** Fire `lcDiag("boot", { runtime_version, source_sha, bundle_index_html_sha256 })` synchronously on first paint. Persist last-seen boot to `sessionStorage` so Doctor can prove which bundle was actually loaded. Investigate Cmd+R vs quit+relaunch parity.

**Regression test:** `navPerf.boot-emit.test.ts` — fresh mount emits `boot` with `runtime_version` within 2s (to-be-authored)

**Closes only when:**
1. `test.passes:navPerf.boot-emit.test.ts`
2. Doctor sees `boot` event with correct `runtime_version` on cold-boot
3. `nav_click_performance` lands in backend log on next Campaigns click

**Latest evidence:** Verifier agent confirmed 2026-07-11: zero waterfall events, only stale `update_beacon_check_failed` from old session.

**Next action:** Wave 4 Agent 4 (Nav/performance) — boot event + Cmd+R investigation.

**Dependencies:** BUG-006, BUG-012 (share the same "which bundle rendered" question)
**Assigned branch:** unassigned
**Assigned wave:** 4

---

## BUG-005 · Notifications badge drifts from empty inbox

- **Category:** 5 · Observability and HQ (badge is observability of state)
- **Owner system:** `capability.community-retention`
- **Mission:** M4

**Customer symptom:** Avatar badge shows unread count that doesn't match InboxSheet content. Screenshot shows "1" badge on a signed-in user with no visible new items.

**Status:** OPEN
**Fixed-unproven notes:** None.

**Technical root cause:** `unreadCount()` in `src/inbox` reduces over `localStorage.lc.inbox.messages.v1` — a local store. Backend `/notifications` endpoint is not called from desktop-2. Server-generated notifications never appear. Confidence: 0.90

**Business root cause:** Server-side notifications never wired to desktop. Local-events-only counter was shipped as scaffolding. Confidence: 0.80

**Affected capabilities:** `capability.community-retention`
**Affected journeys:** none directly
**Affected stations:** `station.tophud.avatar-badge`, `station.inbox.sheet`

**Canonical source of truth:** `state.unread-notifications` (owner currently `hook.useInbox` local · target: backend `/notifications`)

**Files & lines:**
- `desktop-2/src/inbox/*.ts`
- `desktop-2/src/shell/InboxSheet.tsx`
- `desktop-2/src/design-os/components/TopHud.tsx:180`

**Business consequence:**
- Revenue: NONE
- Trust: MEDIUM (lying badge · trust drip)
- Support: MEDIUM ("why does it say 1?")
- Conversion: LOW
Confidence business consequence: 0.75

**Composite severity:** P2 (recoverable · not a blocked journey)

**Related bug ids:** —
**Decision ids:** —
**Invariant ids:** —

**Shell impact:** none (frontend + backend)
**Introduced or discovered at commit:** pre-thread
**Last verified commit:** e4ff1060
**Recurrence count:** 1 observed

**Permanent fix (proposed):** Product call · either (a) wire `/notifications` fetch → mirror into local store on interval, OR (b) accept "session-only" counter with explicit `Local · not synced` chip.

**Regression test:** `inbox.badge-accuracy.test.ts` — asserts badge count == unread items in sheet (to-be-authored)

**Closes only when:**
1. Badge count matches sheet content deterministically across cache clear + reload
2. If backend wire chosen: `/notifications?unread=true` returns matching count on every sample

**Latest evidence:** Screenshot 2026-07-11 shows `1` badge with no visible new items when menu opened.

**Next action:** Product decision needed — a or b.

**Dependencies:** —
**Assigned branch:** unassigned
**Assigned wave:** later

---

# Category 6 · Product truth and fixtures

*(empty · all fixture / product-truth surfaces currently belong to Categories 2 and 5)*

---

# P1 proof · analysis

## BUG-015 · Identity hydration stuck at `kind="pending"` · ladder never advances off `Signing in…`

- **Category:** 1 · Identity and trust
- **Owner system:** `capability.identity-trust`
- **Mission:** M1, M3

**Customer symptom:** After OTP sign-in + reload, TopHud identity strip renders `Signing in…` and never advances to the resolved handle / LC-ID / email-local rung within the 5-15s observation window.

**Status:** FIXED_UNPROVEN
**Fixed-unproven notes:** Train A1 · wave-a1/identity-hydration · 2026-07-12. `IdentityKind` union exported from `useMe.ts`; runtime dev-only drift assertion emits `me_hydration_kind_drift`. 4-transition hydration state machine (`me_hydration_started` · `me_hydration_succeeded` · `me_hydration_stalled` · `me_hydration_failed`) with 8s stall watchdog. `me_snapshot_hydrated` preserved for BUG-002 compat. Regression: `useMe.hydration.test.ts` (5 tests green). Live j001 walk verification + station registry entry still owed before `CLOSED`.

**Technical root cause:** `TopHud.tsx:257` emits `data-identity-kind="pending"` — a runtime value NOT in the documented ladder set at `useMe.ts:65-83` (`{handle, lc-id, email-local, signing-in, complete-profile}`). Either the hook returns a hidden 6th kind or the consumer over-broadens. `__LCOS_TELEMETRY__` buffer stayed empty during the golden-path walk so we cannot yet tell if `/me` fetch fired.  · confidence 0.65 (attribution weakened by empty telemetry)

**Business root cause:** Hydration state machine has no observable transitions. Success emits `me_snapshot_hydrated`; stall / error emit nothing.  · confidence 0.85

**Bug class:** BC-002 (multi-source-of-truth · kind value drifts between hook and consumer)
**Class-elimination pattern:** Extract `IdentityKind` TypeScript union type in `useMe.ts` and export it. Every consumer imports the type. Runtime asserts kind ∈ documented set. Add hydration state machine with 4 transitions (`me_hydration_started` / `me_hydration_succeeded` / `me_hydration_stalled` / `me_hydration_failed`) plus a documented 8s stall timeout.

**Affected capabilities:** `capability.identity-trust`
**Affected journeys:** `j001-fresh-user-otp-identity`, `j014-resume`
**Affected stations:** `station.tophud.identity-pill` (P6 registry owed)

**Golden paths blocked:** `gap:golden-paths-registry-not-authored` (journey-level: j001 GREEN-unproven → likely AMBER · j014 same)

**Telemetry that should have detected:** `me_hydration_started` · `me_hydration_stalled` (topics don't exist — this is why the bug was invisible)

**Canonical source of truth:** `state.current-user` (owner `hook.useMe`)

**Files & lines:**
- `desktop-2/src/design-os/components/TopHud.tsx:257` (emit site)
- `desktop-2/src/design-os/state/useMe.ts:65-83` (documented ladder)
- `desktop-2/src/design-os/state/useMe.ts` (hydration path)

**Business consequence:**
- Revenue: MEDIUM
- Trust: HIGH (visible "Signing in…" persists → user reloads)
- Support: HIGH
- Conversion: MEDIUM
Confidence business consequence: 0.60

**Composite severity:** P0 (customer-visible + regressions Wave 1 identity work)

**Sibling bugs by root cause:** BUG-002, BUG-003 (all identity axis · Cluster 1 lineage)
**Related bug ids:** BUG-002
**Decision ids:** DECISION-0010, DECISION-0011
**Invariant ids:** INV-006, INV-010, INV-011

**Shell impact:** none
**Introduced or discovered at commit:** golden-path walk against `3b094b21` (post-Wave-1 merge · walk artifact `lcos/reports/golden-path/verdicts/j001-identity-ladder-stuck-pending.md`)
**Last verified commit:** 3b094b21 (reproducing in walk)
**Recurrence count:** 1 (first observed)

**Permanent architectural fix:** IdentityKind union type as single canonical set · hydration state machine with 4 telemetry topics · 8s stall timeout emitting `me_hydration_stalled` · runtime assertion in dev builds that kind ∈ union type · regression test walks 3 timing scenarios (pending → resolved · pending → stalled · pending → failed).
**Regression test:** `useMe.hydration.test.ts` (to-be-authored)
**Tests that should have failed:** `TopHud.identity-ladder.test.ts::kind ∈ ladder set` (didn't exist)
**Closes only when:**
1. `test.passes:useMe.hydration.test.ts::start-success-transition`
2. `test.passes:useMe.hydration.test.ts::start-stall-8s-timeout`
3. `test.passes:useMe.hydration.test.ts::start-fetch-error`
4. `test.passes:TopHud.identity-ladder.test.ts::kind must be in IdentityKind union`
5. `doctor.observes:live j001 walk · [data-identity-kind] advances off pending within 5s`
6. `hq.event:me_hydration_started fires within 500ms of auth:signed-in`
7. `hq.event:me_hydration_succeeded fires within 5s of me_hydration_started (happy path)`

**Transition proofs (INV-011):**
- Telemetry event(s): `me_hydration_started`, `me_hydration_succeeded`, `me_hydration_stalled`, `me_hydration_failed`
- Regression coverage: `useMe.hydration.test.ts` (to-be-authored)
- Journey step(s): j001 station chain to be authored (P6 owed)
- Owning station: `gap:station.identity.hydration` not in registry

**Latest evidence:** Golden Path Proof 2026-07-12 · walk file `lcos/reports/golden-path/verdicts/j001-identity-ladder-stuck-pending.md`
**Next action:** Train A1 agent · own `useMe.ts` + `useMe.hydration.test.ts`
**Dependencies:** none
**Assigned branch:** `wave-a1/identity-hydration`
**Assigned wave:** A1

---

## BUG-016 · Auth writer enforcement gap · `cachedHasJwt` doesn't detect raw localStorage writes

- **Category:** 1 · Identity and trust
- **Owner system:** `capability.identity-trust`
- **Mission:** M3

**Customer symptom:** None currently observable — customer path only reaches the JWT store via canonical `setJwt()` bus write. But: any future writer that touches `localStorage.setItem("lc.license.jwt.v1", ...)` without going through `setJwt()` will silently drift `useAuth.cachedHasJwt` — invisible until a component re-reads.

**Status:** FIXED_UNPROVEN
**Fixed-unproven notes:** Train A1 · wave-a1/identity-hydration piggyback · 2026-07-12. Added 2s poll in `src/lib/useAuth.ts` comparing raw `localStorage.getItem(LICENSE_JWT_STORAGE_KEY)` against `cachedHasJwt`. On divergence: emits `auth_state_drift` telemetry, `console.warn` in dev, force-syncs cache, fires `auth:signed-in` / `auth:signed-out` bus event so every subscriber re-syncs. Canonical writer (`setJwt`) untouched. NOTE (path deviation): OWNERSHIP_MATRIX_TRAIN_A.md names the file at `desktop-2/src/design-os/state/useAuth.ts`; the actual canonical location is `desktop-2/src/lib/useAuth.ts` — the referenced path never existed in-tree. Test placed at OWNED path `desktop-2/src/design-os/state/useAuth.drift-detection.test.ts` per matrix; imports traverse `../../lib/useAuth`. Regression: 3 tests green. Prod HQ correlation still owed before `CLOSED`.

**Technical root cause:** `useAuth.ts:80-84` documents that same-tab `localStorage` writes do not fire `storage` events; the bus event `auth:signed-in` is the only in-tab notifier. Raw `localStorage.setItem` bypasses the canonical writer path and stays undetected. Playwright walk detected via seeded raw write.  · confidence 0.95

**Business root cause:** Writer discipline unenforced at runtime; INV-006 (one canonical writer) is enforced by convention, not by code.  · confidence 0.90

**Bug class:** BC-001 (multi-writer state · latent · any code path can become a rogue writer)
**Class-elimination pattern:** Runtime enforcement of INV-006 for `state.authenticated`. Options: (a) `useAuth` internal interval re-reads `localStorage` vs `cachedHasJwt` and emits `auth_state_drift` when they diverge · (b) wrap `localStorage.setItem` with a dev-only Proxy that warns on unauthorized keys · (c) MutationObserver equivalent. Pick (a) — simplest, ships in prod, no wrapper complexity.

**Affected capabilities:** `capability.identity-trust`
**Affected journeys:** `j001-fresh-user-otp-identity`, `j014-resume`
**Affected stations:** none (writer discipline is cross-cutting)

**Golden paths blocked:** none directly (theoretical customer risk)

**Telemetry that should have detected:** `auth_state_drift` (new topic · doesn't exist)

**Canonical source of truth:** `state.authenticated` (owner `hook.useAuth`)

**Files & lines:**
- `desktop-2/src/design-os/state/useAuth.ts:80-84` (documented gap)
- `desktop-2/src/design-os/state/useAuth.ts` (add drift detection)

**Business consequence:**
- Revenue: NONE (currently)
- Trust: LOW (currently) · HIGH (if future writer added)
- Support: LOW
- Conversion: NONE
Confidence business consequence: 0.70

**Composite severity:** P2 (latent · needs proactive protection · not currently customer-visible)

**Sibling bugs by root cause:** BUG-015 (identity axis)
**Related bug ids:** BUG-002
**Decision ids:** DECISION-0010, DECISION-0011
**Invariant ids:** INV-006, INV-011

**Shell impact:** none
**Introduced or discovered at commit:** golden-path walk against `3b094b21`
**Last verified commit:** 3b094b21
**Recurrence count:** 1 (first observed)

**Permanent architectural fix:** BC-001 runtime enforcement · `useAuth` polls `localStorage` every N ms · emits `auth_state_drift` when raw value diverges from `cachedHasJwt` · dev-mode also console.warns. This is Recommendation 1 from the Golden Path Proof extended to the auth axis.
**Regression test:** `useAuth.drift-detection.test.ts` (to-be-authored)
**Tests that should have failed:** none — no test existed
**Closes only when:**
1. `test.passes:useAuth.drift-detection.test.ts::raw-localStorage-write-detected-within-1s`
2. `test.passes:useAuth.drift-detection.test.ts::canonical-setJwt-no-drift-warning`
3. `hq.event:auth_state_drift fires within 2s of a raw write in dev`

**Transition proofs (INV-011):**
- Telemetry event(s): `auth_state_drift`
- Regression coverage: `useAuth.drift-detection.test.ts`
- Journey step(s): j001, j014 (unauthored)
- Owning station: `gap:station.identity.auth-drift-monitor` not in registry

**Latest evidence:** Golden Path Proof · walk verdict `lcos/reports/golden-path/verdicts/j008-wallet-nojwt-with-jwt-present.md`
**Next action:** Train A1 piggyback IF cheap · else defer to later wave
**Dependencies:** none
**Assigned branch:** `wave-a1/identity-hydration` (piggyback with BUG-015 if disjoint at file level)
**Assigned wave:** A1 (piggyback)

---

## BUG-017 · Referral journey · no canonical owner · no test seam

- **Category:** 2 · Monetisation and Whop
- **Owner system:** `capability.affiliate-revenue`
- **Mission:** M2, M1

**Customer symptom:** Referral link + QR are present at `WalletDetail.tsx:873` but have no `[data-referral-link]` / `[data-referral-qr]` / `[data-referral-attribution]` seams. No `04_JOURNEY_BIBLE/j010-referral.md` entry. No telemetry topic for `referral_link_copied` / `referral_qr_scanned` / `referral_attribution_recorded`. Result: the whole referral flow is invisible to Doctor, to HQ, and to regression tests.

**Status:** FIXED_UNPROVEN
**Fixed-unproven notes:** Train A3 (2026-07-12 · branch `wave-a3/referral-journey`) authored `lcos/04_JOURNEY_BIBLE/j010-referral.md` with the seven-station chain, added the `WalletReferralBlock` wrapper to `desktop-2/src/routes/wallet-detail/WalletDetail.tsx` with the three stable DOM seams (`[data-referral-link]`, `[data-referral-qr]`, `[data-referral-attribution-source]`), wired the three j010 telemetry topics (`referral_affordance_mounted`, `referral_link_copied`, `referral_qr_generated`) through the existing `lcDiag()` sink, and shipped the source-contract regression suite at `desktop-2/src/routes/wallet-detail/referral.journey.test.ts` (15 assertions · all green). Backend `referral_attribution_recorded` persistence is DEFERRED as a documented gap (`gap:j010-attribution-persistence` · P4-owed migration) — the topic is authored + client-emitted best-effort, but the Whop webhook backend-side emit + persistence table are out of scope for Train A3 per the RC1 stop conditions on schema migrations. CLOSED requires the four `closes_only_when` gates in `lcos/graph/bugs.json` — the source + test + journey conditions are met; the fourth (live-walk HQ event observation) is owed by Doctor Full.

**Technical root cause:** UI ships without stable selectors or journey coverage. Referral affordance renders but is unreachable by test, unobservable by telemetry, unowned by journey.  · confidence 0.98

**Business root cause:** Referral is the primary M1 (Reach) growth loop and one of the M2 (Revenue) attribution surfaces. It has no invariant guard, no test seam, no owner journey — which means a UI reshuffle can silently break growth attribution.  · confidence 0.85

**Bug class:** BC-004 (business journey with no canonical owner)
**Class-elimination pattern applied:** Authored `lcos/04_JOURNEY_BIBLE/j010-referral.md` with station chain: `wallet.referral-affordance-mounted → user_action_copy_link OR user_action_generate_qr → outbound_share_action → external_click_returns_to_app → attribution_receiver_backend → wallet_ledger_refresh → hq_referral_recorded_event`. Added stable seams: `[data-referral-link]`, `[data-referral-qr]`, `[data-referral-attribution-source]`. Emitted 3 telemetry topics per station (mount + copy + qr).
**Class instances eliminated this commit:** 1 (j010-referral · WalletDetail wallet money surface)
**Class status after commit:** in-progress (BC-004 still has open siblings BUG-004, BUG-014 · j010 closure alone does not close the class)

**Affected capabilities:** `capability.affiliate-revenue`
**Affected journeys:** `j010-referral` (authored · AMBER — persistence gap documented)
**Affected stations:** `station.wallet.referral-affordance-mounted`, `station.wallet.user_action_copy_link`, `station.wallet.user_action_generate_qr`, `station.outbound_share_action`, `station.external_click_returns_to_app`, `station.attribution_receiver_backend`, `station.wallet_ledger_refresh`, `station.hq_referral_recorded_event`

**Golden paths blocked:** referral funnel (unmapped in golden-path registry · P4 owed)

**Telemetry that should have detected:** `referral_link_copied`, `referral_qr_scanned`, `referral_attribution_recorded` (all new topics)

**Canonical source of truth:** `state.affiliate-attribution` (proposed · not yet in registry)

**Files & lines:**
- `desktop-2/src/routes/wallet-detail/WalletDetail.tsx` (referral block · line ~881 · `WalletReferralBlock` wrapper added · original path in the OPEN entry was `desktop-2/src/design-os/wallet/WalletDetail.tsx:873` which was stale · Section-pipeline canonical location is `src/routes/wallet-detail/`)
- `desktop-2/src/routes/wallet-detail/referral.journey.test.ts` (new · source-contract regression suite · 15 assertions)
- `lcos/04_JOURNEY_BIBLE/j010-referral.md` (new · authored per DECISION-0010 station chain)

**Business consequence:**
- Revenue: HIGH (attribution silently drift-vulnerable)
- Trust: MEDIUM
- Support: LOW
- Conversion: HIGH (referral IS the funnel)
Confidence business consequence: 0.80

**Composite severity:** P1

**Sibling bugs by root cause:** BUG-004, BUG-014 (BC-004 umbrella · unowned monetisation journeys)
**Related bug ids:** BUG-004, BUG-014
**Decision ids:** DECISION-0010, DECISION-0011
**Invariant ids:** INV-009, INV-011

**Shell impact:** none
**Introduced or discovered at commit:** golden-path walk against `3b094b21`
**Last verified commit:** Train A3 dispatch commit (this branch tip)
**Recurrence count:** 1

**Documented gaps remaining:**
- `gap:j010-attribution-persistence` — backend `referral_attribution_recorded` topic is authored + emitted best-effort client-side, but the authoritative backend emit + persistence table (`referral_attribution_events` schema) are DEFERRED. P4-owed migration. Doctor should flag on the HQ money-funnel tile until the migration lands.
- `gap:j010-hq-tile` — HQ Money Funnel tile does not yet surface the j010 exit event (blocked on persistence).

**Permanent architectural fix:** BC-004 elimination · author journey file · add stable seams · add 3 telemetry topics · own the flow end-to-end.
**Regression test:** `referral.journey.test.ts` (to-be-authored)
**Tests that should have failed:** none — journey wasn't authored
**Closes only when:**
1. `lcos/04_JOURNEY_BIBLE/j010-referral.md` exists with all station chain rows
2. `test.passes:referral.journey.test.ts::copy-link-fires-telemetry`
3. `test.passes:referral.journey.test.ts::qr-scan-fires-telemetry`
4. `test.passes:referral.journey.test.ts::attribution-recorded-on-backend`
5. `hq.event:referral_link_copied observed on live walk`
6. `hq.event:referral_attribution_recorded observed with valid affiliate_id`
7. Wallet ledger row appears on referral-completion event

**Transition proofs (INV-011):**
- Telemetry event(s): 3 topics listed above
- Regression coverage: `referral.journey.test.ts`
- Journey step(s): j010-referral (to-be-authored)
- Owning station: `station.wallet.referral-affordance` (to-be-authored)

**Latest evidence:** Golden Path Proof · walk verdict `lcos/reports/golden-path/verdicts/j010-referral-affordance-missing-testid.md`
**Next action:** Train A3 agent · own WalletDetail referral block + journey file + tests
**Dependencies:** none
**Assigned branch:** `wave-a3/referral-journey`
**Assigned wave:** A3

---

## Retrofit audit-owed rows (non-Wave-1)

DECISION-0010 + DECISION-0011 introduced new required schema fields (`bug_class`, `golden_paths_blocked`, `telemetry_should_have_detected`, `sibling_bugs_by_root_cause`, `tests_should_have_failed`, `transition_proofs`, `permanent_architectural_fix`). Wave-1 rows above are fully retrofitted. The remaining ten rows are marked `audit-owed` per new field until the P4 audit sweep:

| Bug | Category | Likely bug class (audit-owed to confirm) | Notes |
|---|---|---|---|
| BUG-001 | 5 · Observability | BC-005 or BC-004 (missing observability of a Campaigns click) | Telemetry topic never emitted; needs journey + station registry to Doctor Full |
| BUG-004 | 2 · Monetisation | BC-002 or BC-005 | Whop CTA visibility · owned by state.whop-connection |
| BUG-005 | 5 · Observability | BC-002 | Notifications badge drift · needs product decision (a/b) before class assignment |
| BUG-006 | 3 · Runtime | BC-002 | Version pill vs runtime bundle version · already at BC-002 in the class registry |
| BUG-007 | 3 · Runtime | BC-002 | `__APP_VERSION__` hardcoded in 3 places · same class as BUG-006 · sweep pattern |
| BUG-008 | 2 · Monetisation | BC-002 | Tier default propagation · same class as state-drift trifecta prop deletion |
| BUG-009 | 3 · Runtime | BC-005 or BC-002 | UpdateBeacon 404 poll · backend route missing |
| BUG-010 | 4 · Nav | BC-004 | Learn nav visibility · needs journey coverage first |
| BUG-012 | 3 · Runtime | BC-005 or BC-003 (dev observability shortcut) | Hot-swap requires quit+relaunch · Cmd+R doesn't stick |
| BUG-014 | 2 · Monetisation | BC-002 | Home hero lacks Whop CTA · same class as BUG-004 |

**Rule:** Doctor Lite refuses to answer any bug query against these rows without flagging the `audit-owed` gap explicitly. Retrofit will happen as part of the P4 audit sweep, or when each row's cluster becomes an active wave (whichever comes first).

## 1. Cited file/line existence

At time of ledger draft (commit `26353349`, HEAD `6a162aa8`), all cited files exist. Line numbers correspond to commit `e4ff1060`. Any subsequent movement flagged as drift on next scanner run (P5).

## 2. Duplicate bugs (same root cause)

- **BUG-006 · BUG-007** share root cause "shell/build version leaks into UI where runtime version was intended." BUG-007 is downstream of BUG-006 (same fix cascades).
- **BUG-002 · BUG-013** partially share root cause "identity chrome shows non-personalised copy when personalised copy is available." BUG-013 is a copy issue; BUG-002 is a ladder issue. Kept separate.
- **BUG-004 · BUG-014** are the same "Whop CTA absent from primary chrome" — Home hero (BUG-014) is a specific surface, TopHud chip (BUG-004) is the persistent chrome. Kept separate because fixes touch different components; both go to Wave 2 same branch.

## 3. Bugs already resolved by state-drift commits

**Fully resolved by state-drift trifecta (commit `e4ff1060`):**
- None fully. All 14 remain OPEN.

**Partially addressed (residual work remains · status = OPEN with fixed-unproven notes):**
- **BUG-002 · partial** — prop-default "Guest" leak closed by prop deletion. Null-email "Guest" fallback still present. Ladder unbuilt.
- **BUG-004 · partial** — activation:complete subscriber wired so post-link propagation works. Persistent visibility chip still absent.
- **BUG-006 · partial** — frontend hook wired to `runtime_info`. Rust return value still shell version. No customer-visible change until BUG-012 native investigation.

**Flagged but not touched:**
- BUG-007, BUG-008 (ship-lens P2 findings, no fix branch)

## 4. Bugs that are symptoms of one larger canonical-state issue

- **Identity canonical-state cluster:** BUG-002, BUG-003, BUG-011, BUG-013 all trace to "signed-in identity has no proper source-of-truth ladder + no visible identifier." Fixing BUG-003 unlocks BUG-002 + BUG-013 partial. Wave 1 groups them.
- **Whop visibility cluster:** BUG-004, BUG-014 both = "persistent Whop connect surface is missing." Wave 2 groups them.
- **Runtime version cluster:** BUG-006, BUG-007 both = "shell vs runtime version drift." Wave 3 groups them.
- **Runtime observability cluster:** BUG-001, BUG-012 both = "we can't observe which bundle is actually running." Wave 4 groups them.
- **Tier propagation cluster:** BUG-008 = "prop-based tier default." Single-file Wave 2 sweep.
- **Notification truth:** BUG-005 = "counter has no server source." Wave later, needs product call.
- **Verification gap:** BUG-010 = "did Learn actually render post-Block 3." Wave 5 walkthrough.

## 5. Ranked action list

### Fix now (Wave 1-2 · P0/P1 with clear path)
| Order | Bug | Wave | Rationale |
|---|---|---|---|
| 1 | **BUG-003** | 1 | Upstream of BUG-002 · unlocks ladder + BUG-013 |
| 2 | **BUG-002** | 1 | P0 · authenticated identity fundamentally wrong (target for Definition of Complete) |
| 3 | BUG-011 | 1 (piggyback) | One-line addition · unblocks visual QA of the fix chain |
| 4 | BUG-013 | 1 (piggyback) | Same file · handled while ladder work is open |
| 5 | **BUG-004** | 2 | Money journey · HIGH revenue impact |
| 6 | BUG-014 | 2 | Same branch as BUG-004 |
| 7 | BUG-008 | 2 | Tier propagation sweep · 3 files |

### Prove live (already have partial fix)
| Bug | Note |
|---|---|
| BUG-002 (partial) | Prop-default fix landed. Ladder work still owed. |
| BUG-004 (partial) | activation:complete works. Chip still owed. |
| BUG-006 (partial) | Frontend wired. Native/runtime workaround owed. |

### Defer
| Bug | Wave | Reason |
|---|---|---|
| BUG-001 | 4 | Needs boot event · dependency on BUG-012 |
| BUG-012 | 4 | Native investigation · needs BUG-001 observability |
| BUG-006, BUG-007 | 3 | Runtime version workaround pending shell decision |
| BUG-005 | later | Product decision (a or b) required |
| BUG-009 | later | Log noise · not customer-visible |
| BUG-010 | 5 | Verification only · Doctor pass to confirm |

### Obsolete / close candidates
- None. All 14 remain in scope.

---

# P1 status summary

**Ledger draft:** ✅ 14 rows populated with locked framework + all required fields.
**graph/bugs.json:** ⏳ NOT written this pass. Awaiting Daniel's ✓ on this ledger. On approval, LCOS scanner regenerates `bugs.json` from this file with schema_version 1.0.0.

**Assertions the human must confirm before graph/bugs.json is written:**
1. Business consequence weights (5-per-bug) reflect real product impact.
2. Composite severity assignments are correct (no inflation).
3. Wave assignments match the containment-mode plan.
4. Ranked action list top 4 items = Wave 1 dispatch scope.

**Wave 1 dispatch scope (pending approval):** BUG-002 + BUG-003 + BUG-011 + BUG-013. One implementer branch. Files: `TopHud.tsx`, `useMe.ts`, `models.py`, `me.py`, new backend endpoint `/me/lc-id/claim`. Regression tests: 4. First-run claim UI + identity ladder + data attribute for pill copy.

---

*New bugs append below this line, never above. New IDs are monotonic.*
