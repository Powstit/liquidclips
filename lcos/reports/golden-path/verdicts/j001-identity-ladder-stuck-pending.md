LCOS DOCTOR (LITE) · 2026-07-12 · source_sha 3b094b21 · doc_freshness ok
Journey: j001-fresh-user-otp-identity + j014-resume + j013-restart
Step: 01-post-mint-hydration · 01-resume-identity · 02-after-reload
Result: WEAK-PASS (test passed on "not Guest" but revealed a stuck ladder)

Q1 · Which golden paths blocked: identity-ladder rung 1 (handle) + rung 2 (LC-ID) + rung 3 (email-local) never resolve in the Vite preview window; the ladder stays on rung 4 ("Signing in…") for the entire 5–15s observation window even though the JWT is seeded, the backend is up on :8000, /desktop/connect returned a valid 30-day JWT, and /me is reachable when called directly.
Q2 · Which business capabilities degraded: capability.identity-trust (M3) — the customer would see "Signing in…" indefinitely; the "Complete profile" rung-5 CTA (the actionable ladder gap-closure) never renders.
Q3 · Which canonical states affected: state.current-user.identity-copy · state.current-user.identity-kind · state.current-user.identity-state (data-identity-kind = "pending" — NOT a member of the documented ladder set {handle, lc-id, email-local, signing-in, complete-profile} defined in useMe.ts:65-83).
Q4 · Which journeys fail: j001 · j014 · j013 (all three simulatable identity journeys) — same underlying stuck-hydration signal.
Q5 · Which telemetry should have detected: telemetry.me_snapshot_hydrated (emitted from useMe.ts:127-140 on source transition to real-http). In this walk that event never fired into __LCOS_TELEMETRY__ — but that could be probe-wrap timing (probe replaced lcDiag AFTER useMe.ts imported the original ref). Gap flag: gap:telemetry-cannot-distinguish-fetch-never-fired-from-fetch-fired-but-wrapper-race.
Q6 · Which tests should have failed: no existing regression test asserts that after JWT seeding + reload, identity-kind transitions off "pending" within a bounded time. Documented ladder set in TopHud.identity-ladder.test.ts checks source-file constants, NOT runtime rendered attributes.
Q7 · Which sibling bugs by root cause: BUG-002 (Guest·Admin drift · closed via Wave 1 identity ladder). This finding is a NEW manifestation of the same class — the ladder was designed to close BUG-002 for authenticated users, but the Vite-preview code path shows a durable "pending" state that the class-elimination pattern doesn't fully close.
Q8 · Permanent architectural fix: BC-001 canonical-writer pattern already applied to identity-claim (service.identity_claim.claim_handle). Needed extension: enforce INV-011 transition proof on `me.source` — the transition from source="unknown" → source="real-http" MUST emit `me_snapshot_hydrated` OR fire a bounded-time `me_hydration_stalled` on the same telemetry topic. Doctor Lite refuses ladder closure without both.

Bug class: BC-002 (multi-source-of-truth) — likely candidate; needs verification.
Root cause (proposed · confidence MEDIUM): TopHud.tsx line 292-303 derives `identityCopy` from `identityState` (JWT+tier+Whop axis), while `identityLadder` (me.snapshot axis) is exposed as a SEPARATE `data-identity-kind` on other DOM elements. Two axes projected as one attribute name pair — INV-010 (single selector per axis per component) risk.
Canonical owner: state.current-user (registered in 06_CANONICAL_STATE_REGISTRY.md).
Business consequence: Trust=HIGH (customer sees perpetual "Signing in…" or the marketing pitch "Start free · 10 clips" while already signed in) · Support=MEDIUM · Conversion=NONE · Revenue=NONE.
Confidence: MEDIUM (probe timing could account for empty telemetry buffer; direct backend calls prove the JWT and /me contract, but the useMe hook execution + repaint could not be independently verified in this walk).

Could this have been detected automatically?
  - By existing tests: no · TopHud.identity-ladder.test.ts checks source strings, not runtime attributes.
  - By telemetry: partially · me_snapshot_hydrated exists but the walk could not observe it (probe-wrap race + Vite dev bundle).
  - By an invariant scanner: no · INV-010 needs a runtime dom-attribute scanner (currently AST-only).
  - By Doctor Lite (this run): PARTIALLY · the walk surfaced the stuck ladder + the identity-kind = "pending" value that is not in the documented set; Doctor Lite refused deeper root-cause with cited MEDIUM confidence.

Ledger action:
  - proposed BUG-XXX (not filed) · "Identity ladder rung 4 ('Signing in…') persists past the me-hydration window in Vite preview; data-identity-kind = 'pending' not in documented ladder set"
  - proposed test: playwright assertion — after JWT seed + reload, identity-kind must transition to one of {handle, lc-id, email-local, complete-profile} within 8s.
